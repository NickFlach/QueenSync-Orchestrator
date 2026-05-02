# queensync-canary

External uptime canary for QueenSync. Runs on Fly.io's free tier (one
shared-cpu-1x machine, 256 MB) and pings the QueenSync `/api/health`
endpoint every minute from outside Oracle Cloud's network. On failure it
posts an alert to a configured webhook so an Oracle outage doesn't blind
us.

## Why a separate canary

QueenSync is the operations console for the constellation. If it goes
down, the standard signals (Console UI, Postgres-backed Execution Log,
NATS bridge state) are gone with it. A second observer running on a
different cloud is the lightest possible answer to "is the palace
actually up?".

Fly.io is used because it offers a free tier and a region pool that does
not overlap with Oracle Cloud's failure domains.

## What it does

1. Every `QUEENSYNC_CANARY_INTERVAL_MS` (default 60 s) it issues an
   HTTPS GET against `QUEENSYNC_CANARY_TARGET_URL` (default
   `https://console.ninja-portal.com/api/health`).
2. After `QUEENSYNC_CANARY_FAIL_AFTER` (default 2) consecutive failures
   it POSTs a JSON alert to `QUEENSYNC_CANARY_ALERT_WEBHOOK`.
3. When a future probe succeeds it posts a single recovery alert.
4. Exposes its own `/healthz` on `:$PORT` so Fly's health checks can
   keep the machine alive and operators can `curl` the canary itself.

## Configuration

| Env var                           | Default                                              | Purpose                                                                |
| --------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------- |
| `QUEENSYNC_CANARY_TARGET_URL`     | `https://console.ninja-portal.com/api/health`        | Endpoint to probe                                                      |
| `QUEENSYNC_CANARY_ALERT_WEBHOOK`  | _(empty)_                                            | Slack/Discord/PagerDuty/etc webhook URL — required for alerts          |
| `QUEENSYNC_CANARY_INTERVAL_MS`    | `60000`                                              | Probe interval                                                         |
| `QUEENSYNC_CANARY_TIMEOUT_MS`     | `8000`                                               | Per-probe timeout                                                      |
| `QUEENSYNC_CANARY_FAIL_AFTER`     | `2`                                                  | Consecutive failures before alerting                                   |
| `QUEENSYNC_CANARY_SOURCE`         | `fly-canary`                                         | Identifier for the alerting source — set per region if running >1     |
| `PORT`                            | `8080`                                               | Local health server port                                               |

## Webhook payload shape

```json
{
  "source": "fly-canary",
  "target": "https://console.ninja-portal.com/api/health",
  "ts": "2026-05-02T18:32:11.014Z",
  "kind": "down",            // or "recovery"
  "message": "QueenSync canary detected 2 consecutive failures from fly-canary: HTTP 502",
  "consecutiveFailures": 2,  // present on "down"
  "latencyMs": 184           // present on "recovery"
}
```

Slack-compatible webhooks accept this JSON directly when the channel
allows generic JSON inbound; for Slack incoming webhooks proper, wrap
the alert in a `{ "text": "…" }` formatter (or use a small relay).

## Deploy

```bash
cd artifacts/canary

# 1. Authenticate (one-time)
flyctl auth login

# 2. Create the app from the bundled fly.toml (no immediate deploy).
flyctl launch --no-deploy --copy-config --name queensync-canary

# 3. Set secrets.
flyctl secrets set \
  QUEENSYNC_CANARY_ALERT_WEBHOOK="https://hooks.slack.com/services/XXX/YYY/ZZZ" \
  QUEENSYNC_CANARY_TARGET_URL="https://console.ninja-portal.com/api/health"

# 4. Deploy.
flyctl deploy

# 5. Verify.
flyctl status
flyctl logs
curl https://queensync-canary.fly.dev/healthz
```

To stop or remove:

```bash
flyctl scale count 0
flyctl apps destroy queensync-canary
```

## Local sanity check

```bash
QUEENSYNC_CANARY_TARGET_URL=http://127.0.0.1:8080/api/health \
  node src/index.mjs --once
```

## Cost

A single shared-cpu-1x / 256 MB VM running 24/7 fits inside Fly.io's
free allowance (3 such machines included) at the time of writing. Add
the bandwidth (one ~1 KB request/min) and this stays at $0/mo.
