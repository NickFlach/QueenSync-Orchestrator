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
| `QUEENSYNC_CANARY_TARGET_URL`        | `https://console.ninja-portal.com/api/health` | Endpoint to probe                                                      |
| `QUEENSYNC_CANARY_ALERT_WEBHOOK`     | _(empty)_                                     | Slack/Discord/PagerDuty/etc webhook URL — required for webhook alerts  |
| `QUEENSYNC_CANARY_ALERT_FORMAT`      | `generic`                                     | One of `generic`, `slack`, `discord`, `pagerduty`                      |
| `QUEENSYNC_CANARY_PAGERDUTY_KEY`     | _(empty)_                                     | PagerDuty Events API v2 routing key (required when format=`pagerduty`) |
| `QUEENSYNC_CANARY_ALERT_EMAIL`       | _(empty)_                                     | Comma-separated recipient list for email alerts (via Resend)           |
| `QUEENSYNC_CANARY_ALERT_EMAIL_FROM`  | `canary@queensync.dev`                        | `From:` address for email alerts (must be a verified Resend sender)    |
| `RESEND_API_KEY`                     | _(empty)_                                     | Resend API key — required when `QUEENSYNC_CANARY_ALERT_EMAIL` is set   |
| `QUEENSYNC_CANARY_INTERVAL_MS`       | `60000`                                       | Probe interval                                                         |
| `QUEENSYNC_CANARY_TIMEOUT_MS`        | `8000`                                        | Per-probe timeout                                                      |
| `QUEENSYNC_CANARY_FAIL_AFTER`        | `2`                                           | Consecutive failures before alerting                                   |
| `QUEENSYNC_CANARY_SOURCE`            | `fly-canary`                                  | Identifier for the alerting source — set per region if running >1      |
| `PORT`                               | `8080`                                        | Local health server port                                               |

## Alert formats

Set `QUEENSYNC_CANARY_ALERT_FORMAT` to match the webhook receiver. The
canary shapes the outgoing JSON automatically.

### `generic` (default)

Raw JSON — useful for n8n, Zapier, custom relays, or webhook.site.

```json
{
  "source": "fly-canary",
  "target": "https://console.ninja-portal.com/api/health",
  "ts": "2026-05-02T18:32:11.014Z",
  "kind": "down",
  "message": "QueenSync canary detected 2 consecutive failures from fly-canary: HTTP 502",
  "consecutiveFailures": 2
}
```

```bash
flyctl secrets set \
  QUEENSYNC_CANARY_ALERT_FORMAT=generic \
  QUEENSYNC_CANARY_ALERT_WEBHOOK="https://hooks.example.com/queensync"
```

### `slack`

Targets [Slack incoming webhooks](https://api.slack.com/messaging/webhooks).
Sends `{ "text": "...", "attachments": [...] }` with red/green colour by
kind.

```bash
flyctl secrets set \
  QUEENSYNC_CANARY_ALERT_FORMAT=slack \
  QUEENSYNC_CANARY_ALERT_WEBHOOK="https://hooks.slack.com/services/T000/B000/XXXXXXXX"
```

### `discord`

Targets [Discord webhooks](https://discord.com/developers/docs/resources/webhook#execute-webhook).
Sends `{ "content": "...", "embeds": [...] }`.

```bash
flyctl secrets set \
  QUEENSYNC_CANARY_ALERT_FORMAT=discord \
  QUEENSYNC_CANARY_ALERT_WEBHOOK="https://discord.com/api/webhooks/123456/abcdef"
```

### `pagerduty`

Targets the [PagerDuty Events API v2](https://developer.pagerduty.com/docs/events-api-v2/overview/).
Down alerts `trigger`; recovery alerts `resolve` the same `dedup_key`
(`queensync-canary-<source>`), so the incident closes itself.

```bash
flyctl secrets set \
  QUEENSYNC_CANARY_ALERT_FORMAT=pagerduty \
  QUEENSYNC_CANARY_ALERT_WEBHOOK="https://events.pagerduty.com/v2/enqueue" \
  QUEENSYNC_CANARY_PAGERDUTY_KEY="your-32-char-integration-key"
```

## Email alerts (optional)

Email is delivered through [Resend](https://resend.com). Set both the
recipient list and a Resend API key — the canary will then send an email
alongside whatever webhook is configured.

```bash
flyctl secrets set \
  QUEENSYNC_CANARY_ALERT_EMAIL="ops@example.com,oncall@example.com" \
  QUEENSYNC_CANARY_ALERT_EMAIL_FROM="canary@yourdomain.com" \
  RESEND_API_KEY="re_xxxxxxxxxxxxxxxx"
```

The `From:` address must be a verified sender on your Resend account.
Email and webhook delivery are independent: either, both, or neither
can be configured.

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
