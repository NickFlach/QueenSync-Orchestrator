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
const RAW_WEBHOOK_FORMAT = (
  process.env.QUEENSYNC_CANARY_ALERT_FORMAT ?? "generic"
).toLowerCase();
const ALERT_EMAIL = process.env.QUEENSYNC_CANARY_ALERT_EMAIL ?? "";
const ALERT_EMAIL_FROM =
  process.env.QUEENSYNC_CANARY_ALERT_EMAIL_FROM ?? "canary@queensync.dev";
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const INTERVAL_MS = Number(process.env.QUEENSYNC_CANARY_INTERVAL_MS ?? 60_000);
const TIMEOUT_MS = Number(process.env.QUEENSYNC_CANARY_TIMEOUT_MS ?? 8_000);
const FAIL_AFTER = Number(process.env.QUEENSYNC_CANARY_FAIL_AFTER ?? 2);
const SOURCE = process.env.QUEENSYNC_CANARY_SOURCE ?? "fly-canary";
const HEALTH_PORT = Number(process.env.PORT ?? 8080);

const SUPPORTED_FORMATS = new Set([
  "generic",
  "slack",
  "discord",
  "pagerduty",
]);
let WEBHOOK_FORMAT = RAW_WEBHOOK_FORMAT;
if (!SUPPORTED_FORMATS.has(WEBHOOK_FORMAT)) {
  console.warn(
    `[canary] unknown QUEENSYNC_CANARY_ALERT_FORMAT="${RAW_WEBHOOK_FORMAT}", falling back to "generic"`,
  );
  WEBHOOK_FORMAT = "generic";
}
if (
  WEBHOOK_FORMAT === "pagerduty" &&
  !process.env.QUEENSYNC_CANARY_PAGERDUTY_KEY
) {
  console.warn(
    "[canary] QUEENSYNC_CANARY_ALERT_FORMAT=pagerduty but QUEENSYNC_CANARY_PAGERDUTY_KEY is unset — PagerDuty will reject events",
  );
}

let consecutiveFailures = 0;
let alerting = false;
let lastError = "";
let lastSuccessAt = 0;
let lastCheckAt = 0;

async function probe() {
  const start = Date.now();
  lastCheckAt = start;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(TARGET_URL, {
      signal: ctrl.signal,
      headers: { "User-Agent": `queensync-canary/${SOURCE}` },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const latency = Date.now() - start;
    lastSuccessAt = Date.now();
    if (alerting) {
      await dispatchAlert({
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
      await dispatchAlert({
        kind: "down",
        message: `QueenSync canary detected ${consecutiveFailures} consecutive failures from ${SOURCE}: ${lastError}`,
        consecutiveFailures,
      });
    }
  } finally {
    clearTimeout(timer);
  }
}

async function dispatchAlert(payload) {
  const enriched = {
    source: SOURCE,
    target: TARGET_URL,
    ts: new Date().toISOString(),
    ...payload,
  };
  await Promise.all([postWebhookAlert(enriched), sendEmailAlert(enriched)]);
}

function shapeWebhookBody(alert) {
  const summary = `[QueenSync canary] ${alert.kind.toUpperCase()} — ${alert.message}`;
  switch (WEBHOOK_FORMAT) {
    case "slack":
      // Slack incoming webhooks: https://api.slack.com/messaging/webhooks
      return {
        text: summary,
        attachments: [
          {
            color: alert.kind === "recovery" ? "good" : "danger",
            fields: [
              { title: "Source", value: alert.source, short: true },
              { title: "Target", value: alert.target, short: true },
              { title: "Kind", value: alert.kind, short: true },
              { title: "Timestamp", value: alert.ts, short: true },
              ...(alert.consecutiveFailures != null
                ? [
                    {
                      title: "Consecutive failures",
                      value: String(alert.consecutiveFailures),
                      short: true,
                    },
                  ]
                : []),
              ...(alert.latencyMs != null
                ? [
                    {
                      title: "Latency (ms)",
                      value: String(alert.latencyMs),
                      short: true,
                    },
                  ]
                : []),
            ],
          },
        ],
      };
    case "discord":
      // Discord webhooks: https://discord.com/developers/docs/resources/webhook#execute-webhook
      return {
        content: summary,
        embeds: [
          {
            title: `QueenSync canary — ${alert.kind}`,
            description: alert.message,
            color: alert.kind === "recovery" ? 0x2ecc71 : 0xe74c3c,
            timestamp: alert.ts,
            fields: [
              { name: "Source", value: alert.source, inline: true },
              { name: "Target", value: alert.target, inline: true },
              ...(alert.consecutiveFailures != null
                ? [
                    {
                      name: "Consecutive failures",
                      value: String(alert.consecutiveFailures),
                      inline: true,
                    },
                  ]
                : []),
              ...(alert.latencyMs != null
                ? [
                    {
                      name: "Latency (ms)",
                      value: String(alert.latencyMs),
                      inline: true,
                    },
                  ]
                : []),
            ],
          },
        ],
      };
    case "pagerduty":
      // PagerDuty Events API v2: https://developer.pagerduty.com/docs/events-api-v2/overview/
      // Expects QUEENSYNC_CANARY_ALERT_WEBHOOK to be the integration URL
      // (https://events.pagerduty.com/v2/enqueue) and the routing key in
      // the body. Routing key is taken from QUEENSYNC_CANARY_PAGERDUTY_KEY.
      return {
        routing_key: process.env.QUEENSYNC_CANARY_PAGERDUTY_KEY ?? "",
        event_action: alert.kind === "recovery" ? "resolve" : "trigger",
        dedup_key: `queensync-canary-${alert.source}`,
        payload: {
          summary,
          source: alert.source,
          severity: alert.kind === "recovery" ? "info" : "error",
          timestamp: alert.ts,
          custom_details: alert,
        },
      };
    case "generic":
    default:
      return alert;
  }
}

async function postWebhookAlert(alert) {
  if (!WEBHOOK_URL) {
    console.warn("[canary] no QUEENSYNC_CANARY_ALERT_WEBHOOK set — skipping webhook alert");
    return;
  }
  const body = shapeWebhookBody(alert);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5_000);
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.error(
        `[canary] webhook (${WEBHOOK_FORMAT}) returned HTTP ${res.status}`,
      );
    } else {
      console.log(`[canary] alert posted via ${WEBHOOK_FORMAT} (${alert.kind})`);
    }
  } catch (err) {
    console.error(`[canary] webhook post failed: ${err?.message ?? err}`);
  } finally {
    clearTimeout(timer);
  }
}

async function sendEmailAlert(alert) {
  if (!ALERT_EMAIL) return;
  if (!RESEND_API_KEY) {
    console.warn(
      "[canary] QUEENSYNC_CANARY_ALERT_EMAIL set but RESEND_API_KEY missing — skipping email",
    );
    return;
  }
  const subject = `[QueenSync canary] ${alert.kind.toUpperCase()} — ${alert.source}`;
  const lines = [
    alert.message,
    "",
    `Source:  ${alert.source}`,
    `Target:  ${alert.target}`,
    `Kind:    ${alert.kind}`,
    `Time:    ${alert.ts}`,
  ];
  if (alert.consecutiveFailures != null) {
    lines.push(`Failures: ${alert.consecutiveFailures}`);
  }
  if (alert.latencyMs != null) {
    lines.push(`Latency:  ${alert.latencyMs}ms`);
  }
  const text = lines.join("\n");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5_000);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: ALERT_EMAIL_FROM,
        to: ALERT_EMAIL.split(",").map((s) => s.trim()).filter(Boolean),
        subject,
        text,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        `[canary] resend returned HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
      );
    } else {
      console.log(`[canary] email alert sent (${alert.kind}) → ${ALERT_EMAIL}`);
    }
  } catch (err) {
    console.error(`[canary] email send failed: ${err?.message ?? err}`);
  } finally {
    clearTimeout(timer);
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
            webhookFormat: WEBHOOK_FORMAT,
            emailEnabled: Boolean(ALERT_EMAIL && RESEND_API_KEY),
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
    `[canary] starting — target=${TARGET_URL} interval=${INTERVAL_MS}ms format=${WEBHOOK_FORMAT} once=${once}`,
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
