// QueenSync external canary.
//
// Pings the QueenSync /api/healthz endpoint on a 1-minute schedule from a
// Fly.io free-tier app. On failure (non-2xx, timeout, network error) it
// posts an alert to QUEENSYNC_CANARY_ALERT_WEBHOOK. After the failure
// resolves, a single recovery alert is posted as well so operators can
// close out the incident.
//
// All configuration via env vars — see README.md.

import http from "node:http";

const TARGET_URL =
  process.env.QUEENSYNC_CANARY_TARGET_URL ??
  "https://console.ninja-portal.com/api/health";
const WEBHOOK_URL = process.env.QUEENSYNC_CANARY_ALERT_WEBHOOK ?? "";
const INTERVAL_MS = Number(process.env.QUEENSYNC_CANARY_INTERVAL_MS ?? 60_000);
const TIMEOUT_MS = Number(process.env.QUEENSYNC_CANARY_TIMEOUT_MS ?? 8_000);
const FAIL_AFTER = Number(process.env.QUEENSYNC_CANARY_FAIL_AFTER ?? 2);
const SOURCE = process.env.QUEENSYNC_CANARY_SOURCE ?? "fly-canary";
const HEALTH_PORT = Number(process.env.PORT ?? 8080);

let consecutiveFailures = 0;
let alerting = false;
let lastError = "";
let lastSuccessAt = 0;
let lastCheckAt = 0;

async function probe() {
  const start = Date.now();
  lastCheckAt = start;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(TARGET_URL, {
      signal: ctrl.signal,
      headers: { "User-Agent": `queensync-canary/${SOURCE}` },
    });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const latency = Date.now() - start;
    lastSuccessAt = Date.now();
    if (alerting) {
      await postAlert({
        kind: "recovery",
        message: `QueenSync canary recovered (${latency}ms) after ${consecutiveFailures} failure(s).`,
        latencyMs: latency,
      });
      alerting = false;
    }
    consecutiveFailures = 0;
    lastError = "";
    console.log(`[canary] ok ${latency}ms ${TARGET_URL}`);
  } catch (err) {
    consecutiveFailures += 1;
    lastError = err?.message ?? String(err);
    console.error(
      `[canary] FAIL #${consecutiveFailures} ${TARGET_URL} — ${lastError}`,
    );
    if (consecutiveFailures >= FAIL_AFTER && !alerting) {
      alerting = true;
      await postAlert({
        kind: "down",
        message: `QueenSync canary detected ${consecutiveFailures} consecutive failures from ${SOURCE}: ${lastError}`,
        consecutiveFailures,
      });
    }
  }
}

async function postAlert(payload) {
  if (!WEBHOOK_URL) {
    console.warn("[canary] no QUEENSYNC_CANARY_ALERT_WEBHOOK set — skipping alert");
    return;
  }
  const body = {
    source: SOURCE,
    target: TARGET_URL,
    ts: new Date().toISOString(),
    ...payload,
  };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5_000);
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.error(`[canary] webhook returned HTTP ${res.status}`);
    } else {
      console.log(`[canary] alert posted (${payload.kind})`);
    }
  } catch (err) {
    console.error(`[canary] webhook post failed: ${err?.message ?? err}`);
  }
}

function startHealthServer() {
  http
    .createServer((req, res) => {
      if (req.url === "/" || req.url === "/healthz") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            source: SOURCE,
            target: TARGET_URL,
            consecutiveFailures,
            alerting,
            lastError,
            lastSuccessAt: lastSuccessAt
              ? new Date(lastSuccessAt).toISOString()
              : null,
            lastCheckAt: lastCheckAt
              ? new Date(lastCheckAt).toISOString()
              : null,
          }),
        );
        return;
      }
      res.writeHead(404).end();
    })
    .listen(HEALTH_PORT, () => {
      console.log(`[canary] health server on :${HEALTH_PORT}`);
    });
}

async function main() {
  const once = process.argv.includes("--once");
  console.log(
    `[canary] starting — target=${TARGET_URL} interval=${INTERVAL_MS}ms once=${once}`,
  );
  if (!once) startHealthServer();
  await probe();
  if (once) return;
  setInterval(probe, INTERVAL_MS);
}

main().catch((err) => {
  console.error("[canary] fatal:", err);
  process.exit(1);
});
