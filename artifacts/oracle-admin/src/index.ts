import http from "node:http";
import express, { type NextFunction, type Request, type Response } from "express";
import pino from "pino";
import { verifyHmacBody, TIMESTAMP_HEADER, SIGNATURE_HEADER } from "./hmac";
import { runDispatch, type DispatchPayload } from "./dispatch";
import {
  isCapabilityEnabled,
  isIpAllowed,
  normalizeIp,
  parseCapabilityList,
  parseIpList,
  SlidingWindowRateLimiter,
} from "./security";
import { incrementDispatch, renderJson, renderPrometheus } from "./metrics";

const logger = pino({ level: process.env["LOG_LEVEL"] ?? "info" });

const PORT = Number(process.env["PORT"] ?? 8090);
// Bind loopback by default — HMAC body signing is integrity-only and
// replayable inside the ±5min timestamp window over plain HTTP. Operators
// must front the shim with a TLS-terminating reverse proxy (nginx/caddy) or
// expose it only over a private tunnel (Tailscale/WireGuard). To override
// for a trusted private network, set ORACLE_ADMIN_HOST=0.0.0.0 explicitly.
const HOST = process.env["ORACLE_ADMIN_HOST"] ?? "127.0.0.1";
const SECRET = process.env["QUEENSYNC_ORACLE_ADMIN_HMAC_SECRET"] ?? "";
const ALLOW_UNSIGNED = process.env["ORACLE_ADMIN_ALLOW_UNSIGNED"] === "true";
const REQUIRE_SIG = !ALLOW_UNSIGNED;

// Defence-in-depth knobs (Wave 3 hardening — task #21):
//   ORACLE_ADMIN_ALLOWED_IPS     — comma-separated allowlist; empty = allow-all
//   ORACLE_ADMIN_TRUST_PROXY     — when "true", honour X-Forwarded-For
//   ORACLE_ADMIN_RATE_LIMIT_PER_MIN — per-IP cap on /dispatch (default 5)
//   ORACLE_ADMIN_ENABLED_CAPABILITIES — comma-separated allowlist; unset = all
const ALLOWED_IPS = parseIpList(process.env["ORACLE_ADMIN_ALLOWED_IPS"]);
const TRUST_PROXY = process.env["ORACLE_ADMIN_TRUST_PROXY"] === "true";
const RATE_LIMIT_PER_MIN = (() => {
  const raw = process.env["ORACLE_ADMIN_RATE_LIMIT_PER_MIN"];
  if (raw == null || raw === "") return 5;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    logger.warn(
      { raw },
      "ORACLE_ADMIN_RATE_LIMIT_PER_MIN is not a non-negative number — falling back to 5",
    );
    return 5;
  }
  return Math.floor(n);
})();
const ENABLED_CAPABILITIES = parseCapabilityList(
  process.env["ORACLE_ADMIN_ENABLED_CAPABILITIES"],
);

// Production safety: unsigned mode is a privileged-execution escape hatch
// and must require an explicit development environment. Refuse to start
// unless NODE_ENV is exactly "development" — anything else (production,
// staging, test, or unset) blocks the unsigned path. The shipped systemd
// unit pins NODE_ENV=production for defense in depth.
if (ALLOW_UNSIGNED && process.env["NODE_ENV"] !== "development") {
  logger.fatal(
    { nodeEnv: process.env["NODE_ENV"] ?? "(unset)" },
    "ORACLE_ADMIN_ALLOW_UNSIGNED=true is only permitted when NODE_ENV=development. " +
      "Unset the variable or run with NODE_ENV=development.",
  );
  process.exit(1);
}

if (!SECRET && REQUIRE_SIG) {
  logger.warn(
    "QUEENSYNC_ORACLE_ADMIN_HMAC_SECRET is unset and ORACLE_ADMIN_ALLOW_UNSIGNED!=true. " +
      "All /dispatch requests will be rejected with 503 until you configure the secret.",
  );
}

if (HOST !== "127.0.0.1" && HOST !== "localhost" && HOST !== "::1") {
  logger.warn(
    { host: HOST },
    "ORACLE_ADMIN_HOST is non-loopback — shim is reachable from the network. " +
      "HMAC body signing alone does NOT prevent replay over plain HTTP. " +
      "Ensure traffic to this port is restricted to a trusted private network " +
      "or a TLS-terminating proxy.",
  );
  if (ALLOWED_IPS.size === 0) {
    logger.warn(
      "ORACLE_ADMIN_ALLOWED_IPS is empty while binding non-loopback — every " +
        "source IP can reach /dispatch. Set ORACLE_ADMIN_ALLOWED_IPS to the " +
        "QueenSync deploy IP for defence in depth.",
    );
  }
}

if (RATE_LIMIT_PER_MIN === 0) {
  logger.warn(
    "ORACLE_ADMIN_RATE_LIMIT_PER_MIN=0 — per-IP rate limiting is DISABLED. " +
      "A leaked HMAC secret can be used to thrash the kannaka services.",
  );
}

const dispatchLimiter = new SlidingWindowRateLimiter({
  windowMs: 60_000,
  // max=0 in our limiter means "block everything", which is not what an
  // operator who wrote `=0` meant. Translate 0 → effectively unlimited
  // by skipping the limiter entirely below.
  max: RATE_LIMIT_PER_MIN === 0 ? Number.MAX_SAFE_INTEGER : RATE_LIMIT_PER_MIN,
});

// Periodically reap stale rate-limit buckets so memory doesn't grow on a
// long-lived process that sees many distinct IPs (e.g. during a scan).
const reapTimer = setInterval(() => dispatchLimiter.reap(), 5 * 60_000);
reapTimer.unref();

const app = express();
if (TRUST_PROXY) {
  // The shim is fronted by nginx/caddy on the Oracle host; trust the
  // proxy chain so req.ip reflects the real client. Operators MUST only
  // enable this when there's an actual trusted proxy in front.
  app.set("trust proxy", true);
}

function clientIp(req: Request): string {
  // When trust-proxy is on, express resolves req.ip from XFF for us. When
  // it's off, req.ip is the socket peer (typically 127.0.0.1 behind a
  // proxy, or the real attacker IP on a direct bind).
  const raw = req.ip ?? req.socket.remoteAddress ?? "";
  return normalizeIp(raw);
}

// Global IP allowlist — applied to every route except /healthz so liveness
// probes from systemd / load balancers keep working without needing to be
// added to the allowlist. Runs BEFORE the JSON body parser so we don't
// even spend CPU parsing the body of a blocked-IP request, and well
// before HMAC verification.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === "/healthz") return next();
  const ip = clientIp(req);
  if (!isIpAllowed(ip, ALLOWED_IPS)) {
    logger.warn({ ip, path: req.path }, "rejected: source IP not allowlisted");
    if (req.path === "/dispatch") {
      incrementDispatch("unknown", "rejected_ip");
    }
    res.status(403).json({ error: "source IP not allowlisted" });
    return;
  }
  return next();
});

// Capture the raw body so we can verify the HMAC signature against the exact
// bytes the dispatcher signed. Mounted AFTER the IP allowlist so blocked
// IPs are dropped before any body parsing happens.
app.use(
  express.json({
    limit: "256kb",
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }),
);

app.get("/healthz", (_req, res) => {
  res.json({
    status: "ok",
    signing: SECRET ? "configured" : "missing",
    ipAllowlist: ALLOWED_IPS.size > 0 ? "configured" : "open",
    rateLimitPerMin: RATE_LIMIT_PER_MIN,
    enabledCapabilities:
      ENABLED_CAPABILITIES === null ? "all" : Array.from(ENABLED_CAPABILITIES),
  });
});

app.get("/metrics", (req, res) => {
  // Prefer Prometheus text format unless the client explicitly asks for
  // JSON. Plain `curl` (no Accept) gets text/plain which is also valid.
  const accept = req.header("accept") ?? "";
  if (accept.includes("application/json")) {
    res.json(renderJson());
    return;
  }
  res.type("text/plain; version=0.0.4").send(renderPrometheus());
});

app.post("/dispatch", async (req: Request, res: Response) => {
  const ip = clientIp(req);

  // 1. Per-IP rate limit before we do any expensive work.
  const limit = dispatchLimiter.check(ip || "unknown");
  if (!limit.allowed) {
    logger.warn(
      { ip, retryAfterMs: limit.retryAfterMs, count: limit.count },
      "rejected: rate limit exceeded",
    );
    incrementDispatch("unknown", "rejected_rate");
    res.setHeader("Retry-After", Math.ceil(limit.retryAfterMs / 1000));
    res.status(429).json({ error: "rate limit exceeded" });
    return;
  }

  const ts = req.header(TIMESTAMP_HEADER);
  const sig = req.header(SIGNATURE_HEADER);
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!raw) {
    incrementDispatch("unknown", "rejected_payload");
    res.status(400).json({ error: "missing body" });
    return;
  }
  if (REQUIRE_SIG) {
    if (!SECRET) {
      incrementDispatch("unknown", "rejected_unconfigured");
      res.status(503).json({ error: "shim not configured (missing HMAC secret)" });
      return;
    }
    const v = verifyHmacBody({
      body: raw.toString("utf8"),
      timestamp: ts,
      signature: sig,
      secret: SECRET,
    });
    if (!v.ok) {
      logger.warn({ reason: v.reason, ip }, "rejected unsigned/invalid dispatch");
      incrementDispatch("unknown", "rejected_signature");
      res.status(401).json({ error: `signature rejected: ${v.reason}` });
      return;
    }
  }
  const payload = req.body as DispatchPayload;
  if (!payload || typeof payload !== "object" || !payload.taskId) {
    incrementDispatch("unknown", "rejected_payload");
    res.status(400).json({ error: "invalid payload (missing taskId)" });
    return;
  }
  if (!isCapabilityEnabled(payload.requiredCapability, ENABLED_CAPABILITIES)) {
    logger.warn(
      { capability: payload.requiredCapability, ip, taskId: payload.taskId },
      "rejected: capability disabled on this host",
    );
    incrementDispatch(payload.requiredCapability, "rejected_capability");
    res.status(403).json({
      error: `capability disabled on this host: ${payload.requiredCapability}`,
    });
    return;
  }
  logger.info(
    {
      taskId: payload.taskId,
      capability: payload.requiredCapability,
      callbackUrl: payload.callbackUrl,
      ip,
    },
    "dispatch accepted",
  );
  incrementDispatch(payload.requiredCapability, "accepted");
  // Capture the echoed callback signatures so the shim can post the
  // matching one back to QueenSync without ever needing the callback secret.
  const completedSignature = req.header("x-queensync-completed-signature");
  const failedSignature = req.header("x-queensync-failed-signature");
  // Acknowledge immediately so QueenSync sees the dispatch as accepted, then
  // run the action and post the callback asynchronously.
  res.status(202).json({ status: "accepted", taskId: payload.taskId });
  void runDispatch(payload, logger, {
    headers: { completedSignature, failedSignature },
  }).catch((err) => {
    logger.error({ err, taskId: payload.taskId }, "dispatch run failed");
  });
});

const server = http.createServer(app);
server.listen(PORT, HOST, () => {
  logger.info(
    {
      host: HOST,
      port: PORT,
      signed: Boolean(SECRET),
      ipAllowlistSize: ALLOWED_IPS.size,
      rateLimitPerMin: RATE_LIMIT_PER_MIN,
      enabledCapabilities:
        ENABLED_CAPABILITIES === null
          ? "all"
          : Array.from(ENABLED_CAPABILITIES),
      trustProxy: TRUST_PROXY,
    },
    "oracle-admin shim listening",
  );
});
