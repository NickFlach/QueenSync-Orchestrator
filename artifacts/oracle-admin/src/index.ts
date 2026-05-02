import http from "node:http";
import express, { type Request, type Response } from "express";
import pino from "pino";
import { verifyHmacBody, TIMESTAMP_HEADER, SIGNATURE_HEADER } from "./hmac";
import { runDispatch, type DispatchPayload } from "./dispatch";

const logger = pino({ level: process.env["LOG_LEVEL"] ?? "info" });

const PORT = Number(process.env["PORT"] ?? 8090);
const SECRET = process.env["QUEENSYNC_ORACLE_ADMIN_HMAC_SECRET"] ?? "";
const REQUIRE_SIG = process.env["ORACLE_ADMIN_ALLOW_UNSIGNED"] !== "true";

if (!SECRET && REQUIRE_SIG) {
  logger.warn(
    "QUEENSYNC_ORACLE_ADMIN_HMAC_SECRET is unset and ORACLE_ADMIN_ALLOW_UNSIGNED!=true. " +
      "All /dispatch requests will be rejected with 503 until you configure the secret.",
  );
}

const app = express();

// Capture the raw body so we can verify the HMAC signature against the exact
// bytes the dispatcher signed.
app.use(
  express.json({
    limit: "256kb",
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }),
);

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", signing: SECRET ? "configured" : "missing" });
});

app.post("/dispatch", async (req: Request, res: Response) => {
  const ts = req.header(TIMESTAMP_HEADER);
  const sig = req.header(SIGNATURE_HEADER);
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!raw) {
    res.status(400).json({ error: "missing body" });
    return;
  }
  if (REQUIRE_SIG) {
    if (!SECRET) {
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
      logger.warn({ reason: v.reason }, "rejected unsigned/invalid dispatch");
      res.status(401).json({ error: `signature rejected: ${v.reason}` });
      return;
    }
  }
  const payload = req.body as DispatchPayload;
  if (!payload || typeof payload !== "object" || !payload.taskId) {
    res.status(400).json({ error: "invalid payload (missing taskId)" });
    return;
  }
  logger.info(
    {
      taskId: payload.taskId,
      capability: payload.requiredCapability,
      callbackUrl: payload.callbackUrl,
    },
    "dispatch accepted",
  );
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
server.listen(PORT, () => {
  logger.info({ port: PORT, signed: Boolean(SECRET) }, "oracle-admin shim listening");
});
