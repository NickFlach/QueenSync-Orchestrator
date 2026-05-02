# oracle-admin

Privileged dispatch executor for the Kannaka constellation. Runs on the
bare-metal Oracle host as user `opc`, accepts HMAC-signed POSTs from
QueenSync (`/api/tasks` → capability picker → this shim), executes the
requested action via `sudo systemctl …` or HTTPS calls into Radio /
Observatory, and posts an authenticated callback back to QueenSync.

## Why a shim

QueenSync runs on Replit. Restarting `radio.service` on the Oracle box
needs `sudo`; QueenSync can't and shouldn't have an SSH key into the
production host. The shim is the smallest possible service that bridges
the gap: HMAC authentication on the front door, `NOPASSWD` sudoers with a
strict `Cmnd_Alias` allowlist on the back door.

## Capabilities

The shim handles six capabilities. The capability picker in QueenSync
routes to this arm because `oracle-admin` is the only registered arm with
these capabilities.

| Capability             | Action                                                         |
| ---------------------- | -------------------------------------------------------------- |
| `restart_radio`        | `sudo systemctl restart radio.service`                         |
| `restart_observatory`  | `sudo systemctl restart observatory.service`                   |
| `trigger_oration_now`  | POST `$RADIO_BASE_URL/admin/oration/now`                       |
| `setOverride`          | POST `$OBSERVATORY_BASE_URL/admin/override` (target/value)     |
| `dream_trigger`        | POST `$KANNAKA_DREAM_TRIGGER_URL` or `sudo systemctl start kannaka-dream.service` |
| `kannaka_status`       | GET `$KANNAKA_STATUS_URL` (default `http://127.0.0.1:7777/status`) |

All handlers post a `{status: completed|failed, result|error}` callback
to QueenSync's `/api/tasks/:id/callback`. The expected
`X-QueenSync-Signature` header is echoed from the dispatch headers
(`X-QueenSync-Completed-Signature` / `X-QueenSync-Failed-Signature`) so
the shim never needs to know `QUEENSYNC_CALLBACK_SECRET`.

> **Production note:** `QUEENSYNC_CALLBACK_SECRET` is effectively
> required on the QueenSync side for the end-to-end Restart Radio path
> to succeed. Without it, QueenSync only emits the per-task signature
> headers when the operator falls back to bearer-token callback auth —
> which the shim does not hold. With `QUEENSYNC_CALLBACK_SECRET` set,
> QueenSync writes `X-QueenSync-Completed-Signature` /
> `X-QueenSync-Failed-Signature` on the dispatch and the shim echoes
> them back unchanged on the callback. Set it in the QueenSync
> environment (NOT in the shim's env file) before promoting the
> Restart Radio Quick Action to operators.

## Authentication — HMAC body signing

Inbound dispatches must carry:

- `X-QueenSync-Timestamp: <unix_ms>` — within ±5 minutes of the shim clock.
- `X-QueenSync-Body-Signature: sha256=<hex>` — HMAC-SHA256 over
  `<timestamp>:<exact_request_body>` using
  `QUEENSYNC_ORACLE_ADMIN_HMAC_SECRET`.

Without a valid signature the shim returns `401`. Without a configured
secret it returns `503` (so a misconfigured shim can't accidentally accept
unsigned traffic in production).

## Defence in depth (Wave 3 hardening)

HMAC body signing is the front-door auth, but a leaked secret would
otherwise grant unconditional `sudo systemctl …`. Three independent
layers run in front of HMAC verification:

| Env var                              | Default | Purpose                                                                                                  |
| ------------------------------------ | ------- | -------------------------------------------------------------------------------------------------------- |
| `ORACLE_ADMIN_ALLOWED_IPS`           | _empty_ | Comma-separated source-IP allowlist. Empty = allow-all. On a public bind, set this to the QueenSync IP.  |
| `ORACLE_ADMIN_TRUST_PROXY`           | `false` | When `true`, honour `X-Forwarded-For` so the allowlist / logs see the real client behind nginx/caddy. **Only enable this when the direct shim port is firewalled or bound to loopback** — otherwise an attacker can spoof XFF and bypass the IP allowlist. |
| `ORACLE_ADMIN_RATE_LIMIT_PER_MIN`    | `5`     | Per-source-IP cap on `/dispatch`. Set to `0` to disable (not recommended on a public bind).              |
| `ORACLE_ADMIN_ENABLED_CAPABILITIES`  | _empty_ | Comma-separated capability allowlist. Empty = all six are enabled. Use to disable e.g. `dream_trigger`.  |

Behaviour:

- A request from a non-allowlisted IP is dropped with `403` **before** HMAC
  verification — no CPU is spent verifying a forged signature.
- A leaked HMAC secret can submit at most `ORACLE_ADMIN_RATE_LIMIT_PER_MIN`
  dispatches per minute per source IP; the rest get `429` with a
  `Retry-After` header.
- A capability not in `ORACLE_ADMIN_ENABLED_CAPABILITIES` (when configured)
  is rejected with `403` and never reaches the privileged handler.
- `/healthz` is always reachable (so systemd / load-balancer liveness
  probes don't need to be added to the allowlist).

Recommended values for the public deploy:

```bash
ORACLE_ADMIN_HOST=0.0.0.0                 # behind the TLS reverse proxy
ORACLE_ADMIN_ALLOWED_IPS=<QueenSync IP>   # set after first deploy of QueenSync
ORACLE_ADMIN_TRUST_PROXY=true             # nginx/caddy fronts the shim
ORACLE_ADMIN_RATE_LIMIT_PER_MIN=5
# leave ORACLE_ADMIN_ENABLED_CAPABILITIES unset unless a host should be restricted
```

## Metrics — `GET /metrics`

The shim exposes Prometheus-format counters at `/metrics`. Each
dispatch contributes to `oracle_admin_dispatch_total{capability,status}`
where `status` is one of:

- `accepted` — passed all checks and the handler was scheduled
- `completed` / `failed` — handler outcome
- `rejected_signature` — bad/missing/expired HMAC
- `rejected_ip` — source IP not allowlisted
- `rejected_rate` — per-IP rate limit exceeded (HTTP 429)
- `rejected_capability` — capability disabled on this host (HTTP 403)
- `rejected_payload` — missing body / missing taskId
- `rejected_unconfigured` — shim missing HMAC secret (HTTP 503)

Plus a `oracle_admin_uptime_seconds` gauge. Send `Accept:
application/json` to get the same data as JSON instead of the
Prometheus text exposition.

```bash
curl -fsS http://127.0.0.1:8090/metrics
curl -fsS -H 'Accept: application/json' http://127.0.0.1:8090/metrics
```

## Deployment

```bash
# 1. Build on a CI host or your laptop.
pnpm --filter @workspace/oracle-admin run build

# 2. Ship the bundle to the Oracle host.
rsync -av artifacts/oracle-admin/dist/ opc@oracle.ninja-portal.com:/opt/queensync-oracle-admin/dist/
rsync -av artifacts/oracle-admin/package.json opc@oracle.ninja-portal.com:/opt/queensync-oracle-admin/

# 3. Provision env file (root-owned, mode 0640).
sudo install -o root -g opc -m 0640 .env.example /etc/queensync-oracle-admin.env
sudo $EDITOR /etc/queensync-oracle-admin.env   # set the HMAC secret

# 4. Install the sudoers fragment (narrow allowlist).
sudo install -o root -g root -m 0440 \
  artifacts/oracle-admin/systemd/sudoers.d-queensync-oracle-admin \
  /etc/sudoers.d/queensync-oracle-admin
sudo visudo -c

# 5. Install + enable the systemd unit.
sudo install -o root -g root -m 0644 \
  artifacts/oracle-admin/systemd/queensync-oracle-admin.service \
  /etc/systemd/system/queensync-oracle-admin.service
sudo systemctl daemon-reload
sudo systemctl enable --now queensync-oracle-admin.service

# 6. Verify.
curl -fsS https://oracle-admin.ninja-portal.com/healthz
sudo journalctl -fu queensync-oracle-admin.service
```

### TLS is mandatory for public exposure

The shim itself binds plain HTTP on `127.0.0.1:$PORT` (default 8090). This
is the default in code: `server.listen(PORT, ORACLE_ADMIN_HOST)` where
`ORACLE_ADMIN_HOST` defaults to `127.0.0.1`. Override it to `0.0.0.0` only
when the shim is on a trusted private network (Tailscale, WireGuard,
in-VPC) with the public firewall closed to its port — the shim logs a loud
warning at startup whenever the bind host is non-loopback. HMAC
body signing protects integrity and authenticity, but **HMAC over plain
HTTP is replayable by anyone who can observe traffic within the ±5 minute
timestamp window** — a passive on-path attacker can capture a valid
restart-radio dispatch and replay it. So the shim must be reachable only
through one of:

1. A TLS-terminating reverse proxy on the Oracle host (nginx, caddy, or
   Traefik) with a real cert from Let's Encrypt — this is what
   `https://oracle-admin.ninja-portal.com` resolves to.
2. A private network tunnel (Tailscale / WireGuard / SSH local-forward)
   from the QueenSync host, with the public firewall closed to 8090.

Do **not** open port 8090 directly to the public internet. The seeded
`QUEENSYNC_ORACLE_ADMIN_URL` defaults to `https://…` for this reason; if
you change it to plain `http://`, QueenSync will still dispatch but
you've lost replay protection.

## Local development

```bash
pnpm --filter @workspace/oracle-admin install
ORACLE_ADMIN_ALLOW_UNSIGNED=true \
  PORT=8090 \
  pnpm --filter @workspace/oracle-admin run dev
```

`ORACLE_ADMIN_ALLOW_UNSIGNED=true` skips signature verification — useful
for hitting `curl -X POST localhost:8090/dispatch` from a fixture, but
**never set it on a public host**.

## Tests

```bash
pnpm --filter @workspace/oracle-admin run test
```

Covers HMAC verify (good/bad/expired/missing) and dispatch routing
(handler success path with mocked fetcher).
