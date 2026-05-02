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

## Authentication — HMAC body signing

Inbound dispatches must carry:

- `X-QueenSync-Timestamp: <unix_ms>` — within ±5 minutes of the shim clock.
- `X-QueenSync-Body-Signature: sha256=<hex>` — HMAC-SHA256 over
  `<timestamp>:<exact_request_body>` using
  `QUEENSYNC_ORACLE_ADMIN_HMAC_SECRET`.

Without a valid signature the shim returns `401`. Without a configured
secret it returns `503` (so a misconfigured shim can't accidentally accept
unsigned traffic in production).

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

The shim itself binds plain HTTP on `127.0.0.1:$PORT` (default 8090). HMAC
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
