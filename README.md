# QueenSync — Kannaka Control Plane

QueenSync is the agent orchestration plane and Resonance Control Protocol (RCP)
hub for the Kannaka ecosystem. It exposes a dark "Queen Console" UI plus an
Express + WebSocket API at `/api` and `/ws` from a single deployable artifact.

## What QueenSync is

QueenSync is the **palace** — the place where every Kannaka surface comes to
report, listen, and resolve. Around it:

- **Kannaktopus** is the native staff / execution mesh. Every Kannaktopus arm
  registers with QueenSync as an `arm` and accepts deterministic task payloads.
- **Kannaka Radio** is the signal organ. Inbound transmissions become
  resonance fields tagged for analysis.
- **Kannaka Observatory** is the observation organ. Anomaly + pattern events
  become resonance fields and are routed to whichever arm has the right tags.
- **kannaka-memory** is the identity / memory substrate. The Memory Gate
  curates what gets remembered; future versions push approved events to
  `github.com/NickFlach/kannaka-memory`.
- **RCP (Resonance Control Protocol)** is the "soft" layer: instead of routing
  one task to one arm, an intent is broadcast as a resonance field, every
  eligible arm scores and responds, and the field is resolved by best-of or
  merge.

QueenSync's job is to make all five legible from one console — onboard an arm,
route a task, open a resonance field, watch the memory and execution log
update live.

## v1.0 architecture

```
                       ┌─────────────────────────────┐
                       │        Queen Console        │
                       │  (Vite + React, dark UI)    │
                       │  /  arms  tasks  signals    │
                       │     resonance memory logs   │
                       └──────────────┬──────────────┘
                                      │ HTTP /api  +  WebSocket /ws
                       ┌──────────────▼──────────────┐
                       │     QueenSync API Server    │
                       │      (Express 5 + ws)       │
                       │  router · memory gate · RCP │
                       │  adapters · seed · logger   │
                       └────┬───────────┬───────────┬┘
                            │           │           │
                ┌───────────▼─┐ ┌───────▼──┐ ┌──────▼──────┐
                │  Postgres   │ │  Radio   │ │ Observatory │
                │  (Drizzle)  │ │ adapter  │ │   adapter   │
                │ arms tasks  │ │  ⇄ mock  │ │   ⇄ mock    │
                │ signals mem │ └──────────┘ └─────────────┘
                │ logs reson. │
                └─────────────┘

                         ⇅ outbound dispatch ⇅
                  ┌────────────┬──────────────┬─────────────┐
                  │ Kannaktopus│  OpenClaw    │  External   │
                  │   arms     │  forge       │  webhooks   │
                  │ (local sim)│ (local sim)  │ (HTTP POST) │
                  └────────────┴──────────────┴─────────────┘
                                                    ↑
                                  POST /api/tasks/:id/callback
                                  (HMAC-signed)
```

Single deployable artifact — the API server statically serves the built
frontend so the whole control plane is one URL.

## Repository layout

```
artifacts/
  api-server/       Express 5 + WebSocket backend, Drizzle ORM
  queensync/        React + Vite frontend (Queen Console)
  mockup-sandbox/   Vite preview server for design iteration (not deployed)
  oracle-admin/     Privileged dispatch shim (Wave 3) — Node + Express, runs
                    on the Oracle host as user `opc` via systemd + sudoers.
                    Not a Replit artifact; deployed off-Replit. Accepts
                    HMAC-signed POST /dispatch requests from QueenSync and
                    runs `restart_radio` / `restart_observatory` /
                    `trigger_oration_now` / `setOverride` / `dream_trigger`
                    / `kannaka_status` capabilities.
lib/
  api-spec/         OpenAPI 3.1 source-of-truth + Orval codegen runner
  api-client-react/ Generated TanStack Query hooks
  api-zod/          Generated Zod schemas
  db/               Drizzle PostgreSQL schemas
```

## Quick start

```bash
pnpm install
cp .env.example .env                      # fill DATABASE_URL etc.
pnpm --filter @workspace/db run push      # apply schema (dev only)
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/queensync run dev
```

The Replit workflows (`artifacts/api-server: API Server` and
`artifacts/queensync: web`) wrap the same commands.

## How to deploy to ninja-portal.com

1. **Push to Replit** — the project is a pnpm monorepo; `pnpm run build`
   produces a CJS bundle for the API server and a static build for the
   frontend.
2. **Provision Postgres** — attach a Replit Postgres database. `DATABASE_URL`
   is set automatically.
3. **Set production secrets** in the Replit Secrets pane (NOT in the repo):
   - `QUEENSYNC_BASE_URL=https://ninja-portal.com`
   - `QUEENSYNC_CALLBACK_SECRET=<long random string>` — strongly recommended
     so external arms can be authenticated on callback.
   - `QUEENSYNC_API_KEY=<shared secret>` — only required if you onboard arms
     with `authMethod` set to `api_key`, `bearer`, or `jwt`.
   - `QUEENSYNC_ALLOWED_HOSTS=radio.ninja-portal.com,observatory.ninja-portal.com,170.9.238.136,<…any-arm-host…>`
     to restrict outbound dispatch / connection-test to known hosts. The
     `170.9.238.136` Oracle public IP is the fallback host for the
     observatory before its domain mapping is finalized.
   - `RADIO_BASE_URL` and `OBSERVATORY_BASE_URL` — point at the live endpoints
     (defaults: `https://radio.ninja-portal.com`,
     `https://observatory.ninja-portal.com`). Set
     `QUEENSYNC_FORCE_MOCK=true` to ignore them and serve mock data, useful
     for local development without the constellation. If you need to fall
     back to the raw observatory IP (`http://170.9.238.136:3334`), also set
     `QUEENSYNC_ALLOW_HTTP=true`.
4. **Deploy** via Replit Deployments. Choose a Reserved VM (the API server
   holds long-lived WebSocket connections — Autoscale will cut them).
5. **Custom domain** — in the Deployments panel, add `ninja-portal.com` (and
   any subdomain you want, e.g. `console.ninja-portal.com`). Update DNS as
   instructed. Once the domain is live, set `QUEENSYNC_BASE_URL` to that URL
   and redeploy so callback URLs reflect the public hostname.
6. **Verify** — open `/api/health`, then `/api/summary`. The console should
   load at `/` with `WS · OPEN` in the sidebar.

### Production checklist

- [ ] `DATABASE_URL` provided by Replit Postgres
- [ ] `QUEENSYNC_BASE_URL` set to the public URL (e.g. `https://console.ninja-portal.com`)
- [ ] `QUEENSYNC_SESSION_SECRET` set (≥32 random bytes) — **required in
      production** when `QUEENSYNC_OPERATOR_PASSWORD` is set; the server
      refuses to boot without it.
- [ ] `QUEENSYNC_OPERATOR_TOKEN` **or** (`QUEENSYNC_OPERATOR_USER` +
      `QUEENSYNC_OPERATOR_PASSWORD`) set — the server refuses to boot in
      `NODE_ENV=production` if neither auth method is configured.
- [ ] `QUEENSYNC_CALLBACK_SECRET` set (shared fallback; per-arm secrets
      take precedence — see Wave 5 below)
- [ ] `QUEENSYNC_CREDENTIAL_KEY` set to a 32-byte hex or base64 value
      (`openssl rand -hex 32`) — required to mint and rotate per-arm
      credentials.
- [ ] `QUEENSYNC_API_KEY` set if any arm needs auth headers on dispatch
      and you have not yet onboarded it with a per-arm secret
- [ ] `QUEENSYNC_ALLOWED_HOSTS` populated with the real arm hosts
- [ ] `QUEENSYNC_ALLOW_PRIVATE_HOSTS` left unset (defaults to `false`)
- [ ] `QUEENSYNC_LOG_FILE=/var/data/queensync/audit.log` set (Wave 5 —
      append-only export sink survives redeploys; rotates at
      `QUEENSYNC_LOG_FILE_MAX_BYTES`, default 25 MB)
- [ ] Log shipping configured so rotated `audit.log.<ts>` files do not
      fill the Reserved VM disk — see [Log shipping & retention](#log-shipping--retention)
      below. `QUEENSYNC_LOG_RETENTION_DAYS` (default 30) prunes local
      rotated files even if the upload target is offline.
- [ ] Reserved VM deployment tier selected (for WebSocket persistence)
- [ ] Custom domain `console.ninja-portal.com` attached and DNS validated
- [ ] External canary deployed — see [`artifacts/canary/README.md`](artifacts/canary/README.md)

### Wave 5 — per-arm credentials

Wave 5 (ADR-002) replaces the single shared `QUEENSYNC_API_KEY` /
`QUEENSYNC_CALLBACK_SECRET` with per-arm secrets that can be rotated
independently.

**Storage.** The plaintext per-arm secret is needed both for outbound
dispatch headers (Bearer / `x-api-key`) and for verifying inbound
callback signatures, so it is **encrypted at rest** with AES-256-GCM
(not hashed). The key is `QUEENSYNC_CREDENTIAL_KEY` — 32 bytes provided
as hex or base64. Only the ciphertext and a 4-character display hint
(e.g. `…a1f3`) are persisted on the `arms` row. Rotation invalidates the
previous secret immediately.

**Onboarding.** `POST /api/arms` accepts an optional `secret`. When
omitted and `authMethod != "none"`, the server auto-generates one. The
plaintext is returned **once** in the response as `oneTimeSecret` —
copy it then; the server keeps only the ciphertext.

```bash
curl -X POST https://console.ninja-portal.com/api/arms \
  -H "authorization: Bearer $QUEENSYNC_OPERATOR_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "name": "openclaw-forge-eu",
    "type": "external_webhook",
    "capabilities": ["artifact", "build"],
    "endpointUrl": "https://forge.example.com/queensync/dispatch",
    "authMethod": "bearer"
  }'
# → 201 { ..., "credentialHint": "…a1f3", "oneTimeSecret": "…copy me…" }
```

**Rotation.** `POST /api/arms/{id}/rotate-credential` mints a fresh
secret, persists the new ciphertext, and returns the plaintext once.
Rotate immediately if a secret leaks, on operator handoff, and on a
quarterly cadence at minimum.

```bash
curl -X POST https://console.ninja-portal.com/api/arms/$ARM_ID/rotate-credential \
  -H "authorization: Bearer $QUEENSYNC_OPERATOR_TOKEN"
# → 200 { armId, credentialHint, credentialUpdatedAt, oneTimeSecret, arm }
```

**Fallback.** Until every arm has been re-onboarded with a per-arm
secret, the legacy shared `QUEENSYNC_API_KEY` /
`QUEENSYNC_CALLBACK_SECRET` continue to work. Per-arm wins when both are
present. Once all arms are migrated, you may unset the shared values.

### Log shipping & retention

The `QUEENSYNC_LOG_FILE` sink rotates at 25 MB by renaming the active
file with an ISO timestamp suffix (e.g. `audit.log.2026-05-02T12-34-56-789Z`).
A background shipper (`startLogShipper` in
`artifacts/api-server/src/lib/log-shipper.ts`) wakes every 5 minutes,
scans the directory for rotated files, uploads each one to the
configured destination, and deletes the local copy on success.

Even when no upload target is configured, the shipper still prunes
files older than the retention window — so the Reserved VM disk cannot
fill up if the upload target is offline for an extended period.

**Common knobs**

| Env var                          | Default        | Purpose                                              |
|----------------------------------|----------------|------------------------------------------------------|
| `QUEENSYNC_LOG_SHIP_TARGET`      | _(unset)_      | `s3`, `replit-object-storage`, or `logtail`          |
| `QUEENSYNC_LOG_SHIP_INTERVAL_MS` | `300000`       | How often the shipper wakes (ms)                     |
| `QUEENSYNC_LOG_RETENTION_DAYS`   | `30`           | Local prune window for rotated files                 |

**S3** (`QUEENSYNC_LOG_SHIP_TARGET=s3`)

- `QUEENSYNC_LOG_S3_BUCKET` — required
- `QUEENSYNC_LOG_S3_PREFIX` — defaults to `queensync/audit/`
- Standard AWS credential env vars (`AWS_REGION`, `AWS_ACCESS_KEY_ID`, …)
- Requires `@aws-sdk/client-s3` to be installed in the api-server.

**Replit Object Storage / GCS** (`QUEENSYNC_LOG_SHIP_TARGET=replit-object-storage`)

- `QUEENSYNC_LOG_GCS_BUCKET` — defaults to `DEFAULT_OBJECT_STORAGE_BUCKET_ID`
- `QUEENSYNC_LOG_GCS_PREFIX` — defaults to `queensync/audit/`
- Requires `@google-cloud/storage` to be installed in the api-server.

**Logtail / Better Stack** (`QUEENSYNC_LOG_SHIP_TARGET=logtail`)

- `QUEENSYNC_LOG_LOGTAIL_TOKEN` — required (source token)
- `QUEENSYNC_LOG_LOGTAIL_HOST` — defaults to `https://in.logs.betterstack.com`
- No SDK install needed.

If the target is misconfigured or the SDK is missing, the shipper logs
an error once and falls back to retention-only mode — the API server
still boots and serves traffic.

### Production deploy — Replit Reserved VM

0. **Apply the schema migration.** Wave 5 added `credential_cipher`,
   `credential_hint`, and `credential_updated_at` columns to the `arms`
   table. Before the new build boots, run
   `pnpm --filter @workspace/db run push` against the production
   `DATABASE_URL` (or include it in your release script). The columns
   default to `NULL` so existing rows stay valid; the shared
   `QUEENSYNC_API_KEY` fallback continues to work for any arm that has
   no per-arm secret yet.
1. **Reserved VM, not Autoscale.** The console holds long-lived
   WebSocket connections; Autoscale terminates them.
2. **Domain.** Bind `console.ninja-portal.com` in the Replit Deployments
   panel; set `QUEENSYNC_BASE_URL=https://console.ninja-portal.com` so
   callback URLs reflect the real hostname.
3. **Boot guard.** With `NODE_ENV=production`, the server refuses to
   start unless an auth method is configured. If you set
   `QUEENSYNC_OPERATOR_PASSWORD` you **must** also set
   `QUEENSYNC_SESSION_SECRET`.
4. **First boot.** Hit `/api/health` and check `WS · OPEN` in the
   sidebar at `/`. Confirm `QUEENSYNC_LOG_FILE` is being appended (e.g.
   `tail -f /var/data/queensync/audit.log`).
5. **Canary.** Deploy `artifacts/canary/` to Fly.io so an external
   observer alerts on Oracle outages even when the console itself is
   unreachable.

### Decommissioning `kannaka-staff`

The `kannaka-staff` Replit project served as the original ops crew
host. As of Wave 5 the same arms (`signal_keeper_01`,
`memory_keeper_01`, `auditor_01`, `atelier_01`) are seeded directly into
QueenSync's database (see Kannaka repo mapping below) and dispatched
through QueenSync's router. The standalone project is therefore
redundant.

Decommission checklist:

- [ ] Confirm none of the four ops arms still point `endpointUrl` at the
      old `kannaka-staff` host. Run `SELECT id, name, endpoint_url FROM
      arms WHERE name IN ('signal_keeper_01','memory_keeper_01','auditor_01','atelier_01');`
      in production and re-onboard via `POST /api/arms` if any do.
- [ ] Re-onboard with per-arm secrets (see Wave 5 above) and store the
      returned `oneTimeSecret` in the operator vault.
- [ ] Drain in-flight tasks: `SELECT count(*) FROM tasks WHERE status IN
      ('pending','running');` should be 0 before shutdown.
- [ ] Snapshot the legacy project (Replit project menu → Download as
      zip) and archive to long-term storage.
- [ ] Stop the legacy workflow, then delete the Replit project.
- [ ] Remove DNS records pointing at it.
- [ ] Update `QUEENSYNC_ALLOWED_HOSTS` to drop the legacy hostname.
- [ ] Once the canary has been green for 7 days post-cutover, unset the
      shared `QUEENSYNC_API_KEY` so all arms must use per-arm secrets.

## How to onboard agents

You can onboard from the **UI** or the **API**.

### From the Queen Console

1. Open `/arms` in the Queen Console.
2. Click **Onboard arm**.
3. Fill in:
   - **Name** — human label (e.g. `radio-listener-eu`).
   - **Type** — one of `kannaktopus_arm`, `local_simulated`, `human_configured`,
     `api`, `replit_hosted`, `openclaw`, `external_webhook`, `mcp`.
   - **Capabilities** — comma-separated list, e.g. `compose,build,dream`.
   - **Endpoint URL** (optional) — if set, dispatch sends the task there via
     POST. If empty, the arm runs as a local simulation.
   - **Heartbeat URL** (optional) — used by the Connection Test button.
   - **Auth method** — `none`, `api_key`, `bearer`, or `jwt`.
   - **Resonance tags + sensitivity** — controls which resonance fields the
     arm responds to and how strict the score threshold is.
4. Press **Test connection** to verify the endpoint is reachable (subject to
   the SSRF guard).

### From the API

```bash
curl -X POST https://ninja-portal.com/api/arms \
  -H "content-type: application/json" \
  -d '{
    "name": "openclaw-forge-eu",
    "type": "external_webhook",
    "capabilities": ["artifact", "build"],
    "endpointUrl": "https://forge.example.com/queensync/dispatch",
    "heartbeatUrl": "https://forge.example.com/queensync/health",
    "authMethod": "bearer",
    "resonanceTags": ["artifact", "merge"],
    "resonanceSensitivity": 0.55,
    "description": "OpenClaw artifact forge, EU region"
  }'
```

The arm becomes immediately eligible for capability matching and resonance
scoring.

## How external task callbacks work

When QueenSync dispatches a task to an arm with an `endpointUrl`, the arm
receives a POST containing the task plus a callback URL it must call back
to when it finishes:

```http
POST <arm.endpointUrl>
content-type: application/json
authorization: Bearer <QUEENSYNC_API_KEY>            # if authMethod=bearer/jwt
x-api-key: <QUEENSYNC_API_KEY>                       # if authMethod=api_key
x-queensync-completed-signature: sha256=<expected-on-success>
x-queensync-failed-signature:    sha256=<expected-on-failure>

{
  "taskId": "abc123",
  "armId":  "arm_99",
  "intent": "compose dream lite for batch 42",
  "requiredCapability": "compose",
  "priority": 6,
  "context": { ... },
  "callbackUrl": "https://ninja-portal.com/api/tasks/abc123/callback"
}
```

The arm replies to `callbackUrl`:

```http
POST https://ninja-portal.com/api/tasks/abc123/callback
content-type: application/json
x-queensync-signature: sha256=<echo of completed-signature OR failed-signature>

{ "status": "completed", "result": "…final string output…" }
```

QueenSync verifies the echoed signature with timing-safe comparison. If
`QUEENSYNC_CALLBACK_SECRET` is unset, the server falls back to
`Authorization: Bearer $QUEENSYNC_ADMIN_TOKEN`. If neither is set, callbacks
are accepted with a warning — only safe for local development.

The full type matrix supported by the OpenAPI schema and the Onboarding UI:

| `type`              | Behaviour                                                                |
|---------------------|--------------------------------------------------------------------------|
| `kannaktopus_arm`   | Local simulation (Kannaktopus core)                                      |
| `local_simulated`   | Local simulation                                                         |
| `human_configured`  | Mock callback unless `endpointUrl` set, then external dispatch           |
| `api`               | External dispatch when `endpointUrl` set, otherwise mock callback        |
| `replit_hosted`     | External dispatch when `endpointUrl` set, otherwise mock callback        |
| `openclaw`          | External dispatch when `endpointUrl` set, otherwise mock callback        |
| `external_webhook`  | External dispatch — fails fast if no `endpointUrl`                       |
| `mcp`               | External dispatch when `endpointUrl` set, otherwise mock callback        |

## How RCP works

RCP (Resonance Control Protocol) is the "broadcast and let arms self-select"
loop. A resonance field captures a high-level intent:

```json
{
  "intent": "Investigate spike in observation_event traffic",
  "tags": ["observation", "anomaly", "audit"],
  "priority": 0.7,
  "constraints": { "originSignalId": "sig_123" }
}
```

Every arm with `resonanceMode != "off"` is offered the field and scored:

```
score = tagOverlap × 0.5
      + priorityWeight × 0.3
      + availability × 0.2
```

- `tagOverlap` = `|field.tags ∩ arm.resonanceTags| / |field.tags|`
- `priorityWeight` = `field.priority`
- `availability` = `1` if the arm is `idle`, `0.4` if `busy`, `0` if `removed`

If `score >= 0.5` AND `score >= arm.resonanceSensitivity`, the arm produces a
textual response and a coherence score. Resolution comes in two flavours:

- **best** — pick the response with the highest coherence score
- **merge** — concatenate the top responses and average the scores

Resolution emits `resonance_resolved` over the WebSocket and feeds the result
back into the Memory Gate.

## Kannaka repo mapping

| Kannaka repo / surface           | QueenSync representation                                               |
|----------------------------------|------------------------------------------------------------------------|
| `Kannaktopus` (MCP + HRM gateway)| seeded arm `architect_01` + `/api/observatory/state` bridge + Hologram TV |
| `kannaka-staff` (ops crew)       | seeded arms (`signal_keeper_01`, `memory_keeper_01`, `auditor_01`, `atelier_01`) — cover the producer / archivist / board-op / quartermaster roles defined in ADR-001|
| `openclaw` (artifact forge)      | seeded arm `atelier_01` (type `local_simulated`, capabilities artifact/build/merge)|
| `radio.ninja-portal.com`         | Radio adapter + Hologram TV iframe of `/video/hologram`                |
| `kannaka-memory`                 | local Memory Gate today; future mirror via `lib/memory-adapter.ts` stub|
| `observatory.ninja-portal.com`   | Observatory adapter + live HRM snapshot bridge (`/api/observatory/state`) |

Demo buttons on the overview page exercise these arms end-to-end:

- **Wake Kannaktopus** — issues 3 demo tasks routed through `architect_01` /
  `signal_keeper_01` / `memory_keeper_01`.
- **Dream Lite** — calls `POST /api/memory/dream-lite` (Memory Governance
  v1.0), compresses the last 60m of approved memories into a single
  `dream_lite_compression` event, and marks the originals `compacted`.
- **Resonance Storm** — opens 4 resonance fields, scores responses from every
  arm, and resolves each one via best-of / merge.

## API surface

All routes live under `/api`. Live event stream is on `/ws`.

| Method | Path                                  | Purpose                                  |
|--------|---------------------------------------|------------------------------------------|
| GET    | `/api/health`                         | Liveness probe                           |
| GET    | `/api/summary`                        | Live counts + adapter status             |
| GET    | `/api/arms`                           | List arms                                |
| POST   | `/api/arms`                           | Onboard arm (full type + auth matrix)    |
| GET    | `/api/arms/:id`                       | Arm detail + recent tasks                |
| DELETE | `/api/arms/:id`                       | Remove arm                               |
| POST   | `/api/arms/:id/heartbeat`             | Heartbeat (resets to idle)               |
| POST   | `/api/arms/:id/test-connection`       | SSRF-guarded reachability probe          |
| GET    | `/api/tasks`                          | List tasks                               |
| POST   | `/api/tasks`                          | Create task (router dispatches it)       |
| GET    | `/api/tasks/:id`                      | Task detail                              |
| POST   | `/api/tasks/:id/retry`                | Re-queue a failed task                   |
| POST   | `/api/tasks/:id/callback`             | External arm result callback (HMAC-auth) |
| GET    | `/api/signals`                        | List ingested signals                    |
| POST   | `/api/signals`                        | Inject a signal — always becomes a task  |
| GET    | `/api/memory`                         | Memory Gate decisions (`?includeCompacted=&includeRejected=`) |
| POST   | `/api/memory/evaluate`                | Run Memory Gate over an arbitrary payload |
| POST   | `/api/memory/dream-lite`              | Compress recent approved memories (Dream Lite v1.0) |
| GET    | `/api/logs`                           | Execution log                            |
| GET    | `/api/resonance` `/active`            | List / list active resonance fields      |
| POST   | `/api/resonance`                      | Open a new resonance field               |
| POST   | `/api/resonance/:id/respond`          | Manual response                          |
| POST   | `/api/resonance/:id/resolve`          | Resolve via `best` or `merge`            |
| GET    | `/api/adapters/radio/health` `/signals`  | Radio adapter probe / cached events    |
| POST   | `/api/adapters/radio/pull`            | Pull → signals + tasks + resonance       |
| GET    | `/api/adapters/observatory/health` `/events` | Observatory adapter probe / cached events |
| POST   | `/api/adapters/observatory/pull`      | Pull → signals + tasks + resonance       |
| POST   | `/api/demo/wake-kannaktopus`          | Demo: 3 tasks                            |
| POST   | `/api/demo/dream-lite`                | Demo: Memory Gate over recent events     |
| POST   | `/api/demo/resonance-storm`           | Demo: 4 resonance fields, auto-resolved  |

The OpenAPI source is `lib/api-spec/openapi.yaml`. Regenerate the React/Zod
clients with:

```bash
pnpm --filter @workspace/api-spec run codegen
```

The post-process script `lib/api-spec/fix-index.mjs` resolves an Orval index
collision and must stay in place.

## Signal → task loop

Every signal (manual injection, adapter pull, or programmatic) becomes a
routable task. The capability is taken from `payload.capability` if present,
otherwise inferred from the signal `type`. Resonance-bearing signals also
open a resonance field whose tags follow the v1.0 tag vocabulary so the
field reads the same regardless of whether the signal arrived from the live
adapter or was injected manually:

| Signal type           | Default capability     | Resonance field tags                                |
|-----------------------|------------------------|-----------------------------------------------------|
| `build_request`       | `build`                | —                                                   |
| `radio_transmission`  | `transmit`             | `radio`, `signal`, `analysis` (+ subtype, capability) |
| `openclaw_artifact`   | `artifact`             | —                                                   |
| `memory_anomaly`      | `audit` (+ resonance)  | `observation`, `anomaly`, `audit` (+ capability)    |
| `governance_alert`    | `audit` (+ resonance)  | `observation`, `anomaly`, `audit` (+ capability)    |
| `observation_event`   | `observe` (+ resonance)| `observation`, `anomaly`, `pattern` (+ subtype, capability) |
| `other`               | `build`                | —                                                   |

Adapter pulls (`/adapters/radio/pull`, `/adapters/observatory/pull`) emit one
signal + one task + one resonance field per event so every external pulse is
both routed and openly resonant. Radio pulls inject the
`radio / signal / analysis` base tags plus the per-event subtype
(`radio.now_playing`, `radio.swarm`, `radio.dream`, etc.). Observatory
pulls inject the `observation / anomaly / pattern` base tags plus the
per-event subtype (`observation.consciousness`, `observation.anomaly`,
etc.). Operator-supplied `payload.tags` are merged in alongside the base
tags rather than replacing them.

## Console filters

Every operator-facing list page in the Queen Console has a filter bar that
reads and writes URL query params, so a filtered view (`?status=failed&q=chord`)
can be shared as a link:

| Page              | Filters                                              |
|-------------------|------------------------------------------------------|
| `/tasks`          | status · assigned agent · source · search intent     |
| `/signals`        | type · source · status (received / converted) · search payload |
| `/logs`           | event type · source · search summary                 |
| `/memory`         | status (approved / rejected / compacted) · agent · tag |
| `/resonance`      | status (active / resolved / expired) · tag · search intent |

All filtering happens in the browser against the data already returned by
the existing list endpoints — no API change is required.

## Hologram TV — live constellation view

The `/hologram` route in the Queen Console is a TV-style view that embeds the
two public Kannaka surfaces side-by-side and overlays a live HRM
(Holographic Resonance Medium) stat strip:

- **Radio Hologram** — `https://radio.ninja-portal.com/video/hologram`
  (3D Three.js visual, audio gate, GhostSignals markets)
- **Observatory Constellation** — `https://observatory.ninja-portal.com`
  (3D constellation canvas, HRM panel, consciousness HUD)
- **HRM stats strip** — pulled from `GET /api/observatory/state`, refreshed
  every 5 seconds: consciousness `level`, Φ (`phi`), Ξ (`xi`), `order`,
  active/total agents, current listener count, current track.

The page exposes view-mode buttons (`split` / `hologram` / `observatory`),
an iframe reload button, and a dedicated **Wake Kannaktopus** button that
fires the same `POST /api/demo/wake-kannaktopus` flow used on the Overview
page.

When the wake button is pressed, the API server:

1. Issues the three demo tasks routed through the Kannaktopus / Signal
   Keeper / Memory Keeper arms (unchanged behaviour).
2. If `KANNAKTOPUS_WAKE_URL` is configured, POSTs a `{action:"wake", taskIds,
   ts}` payload to that URL through the SSRF guard. (Optional — useful when
   running an MCP/HTTP gateway in front of Kannaktopus.)
3. Pulls a fresh `/api/observatory/state` snapshot.
4. Broadcasts a `kannaktopus_status` WebSocket event so every connected
   console refreshes its HRM strip immediately.
5. Records the wake + observatory level/phi in the Execution Log.

The bridge is read-only and degrades gracefully: if the observatory is
unreachable or the URL guard blocks the call, the page still renders with a
zeroed snapshot and the iframe overlays continue to play.

## Future MCP compatibility

The Onboarding flow already accepts `type: "mcp"` so an MCP server can be
registered as an arm with an `endpointUrl`. The current dispatcher treats it
as a generic external webhook (HTTP POST + JSON callback); a future revision
will replace the wire format with the MCP `tools/call` JSON-RPC envelope and
reuse the existing capability-matching + callback authentication paths. No
schema or onboarding UI change will be needed to adopt MCP — only the
`dispatchExternal` body shape.

## Memory Gate (Memory Governance v1.0)

The Memory Gate is the policy layer between every agent output / signal /
resonance and the durable memory log. v1.0 turns the Memory Stream into a
real audit trail of what the system remembers, why, and where it came from.

**Importance scoring.** Every evaluation gets a deterministic score in
`[0, 1]` based on content length, type (`decision` / `resonance_event` /
`agent_output`), keyword density (`decision`, `dream`, `anomaly`, etc.), and
whether it links back to a resonance field. The threshold is `0.40`.

**Tag classification + summary + source attribution.** Each event is
classified against a small loose dictionary (`decision`, `dream`, `transmit`,
`audit`, `observe`, …). The gate also stores a short truncated `summary`
and a human-readable `sourceAttribution` string built from the agent's
display name plus task / resonance ids — every row in the Memory Stream
shows where the memory came from at a glance.

**24h SHA1 dedupe.** Identical content (case-insensitive, trimmed) within
the last 24h is rejected as a duplicate.

**Rejection trail.** Below-threshold and duplicate events are *persisted*
with `decision=rejected` / `decision=duplicate` and a human-readable
`reason`, instead of being silently dropped. The Memory page has a "Show
rejected" toggle so operators can audit them.

**Dream Lite compaction.** `POST /api/memory/dream-lite` (and the demo
button on the Overview page) takes a window of recent approved memory
events (default 60m, override via `{ "windowMinutes": N }`), builds a
deterministic top-N tag aggregation + 3-line sample summary, inserts a
single new `dream_lite_compression` memory event, and marks the originals
`compacted=true` with `compactedIntoId` set to the compression event. The
Memory Stream hides compacted rows by default; toggle "Show compacted" to
see what each compression replaced (children render grouped under the
parent compression row).

**kannaka-memory absorb bridge (v2 Wave 4 — supersedes Draft #9).** The
no-op `pushToKannakaMemory` HTTP stub is gone. Approved memory events
become HRM-eligible only when an operator clicks **Absorb to HRM** in the
Memory Gate UI; that publishes the event on `KANNAKA.absorb` (via the
shared NATS client from Wave 2) with an idempotency key derived from the
existing 24h dedupe `contentHash`. kannaka-memory's swarm-worker (per
`kannaka-memory` ADR-0026 Phase 6) consumes the subject, dedupes on the
key, absorbs into the HRM, and acks on `KANNAKA.absorb.ack`. The ack
handler in `nats-bridge.ts` updates `memory_events.absorb_state` to
`absorbed` (with `absorbed_at`) or `failed` (with `last_absorb_error`).

The Memory Gate page splits the per-event action into two buttons:
**Approve (local)** parks the event with `absorb_state="not_required"`
and never publishes; **Absorb to HRM** publishes and marks the event
`pending`. Failed absorbs (NATS down or HRM nack) flip back to a
**Retry Absorb** action — the row carries the failure reason.

**Inbound exemplars.** HRM-side exemplar candidates arrive on
`KANNAKA.exemplars` and land in QueenSync as `decision="pending"`,
`inbound_exemplar=true` rows. The Memory Gate "Inbound HRM exemplars"
section lets the operator **Re-absorb (strengthen)** — which republishes
on `KANNAKA.absorb` — or **Reject (prune)** which marks the row rejected
locally with no publish. Strengthened/pruned/pending counters are
served by `GET /api/memory/exemplars/stats`.

**Dream Lite (HRM dispatch).** The Memory Gate's Dream Lite button
dispatches a real task with `requiredCapability=dream` so an
onboarded `kannaka-prime` arm picks it up; the response includes the task
id so the UI can subscribe to its progress (a real cycle can take 5+
minutes on a bloated medium). When no `dream`-capable arm is registered,
the route falls back to the in-process compaction so the local audit
trail still records the operator's intent.

**Trace this event.** `GET /api/memory/:id/trace` walks the chain
signal → resonance → arm response → memory candidate → absorb log → HRM
ack and powers the per-row "Trace" dialog in the Memory Gate UI.

The repo for the canonical substrate:
[github.com/NickFlach/kannaka-memory](https://github.com/NickFlach/kannaka-memory).

## Environment variables

See `.env.example` for the complete list. Highlights:

- `DATABASE_URL` — required (Replit provides automatically)
- `QUEENSYNC_BASE_URL` — public URL used in callback URLs
- `QUEENSYNC_API_KEY` — outbound auth secret for arms
- `QUEENSYNC_CALLBACK_SECRET` — HMAC secret for inbound callbacks (recommended)
- `QUEENSYNC_ADMIN_TOKEN` — fallback bearer token for callbacks
- `QUEENSYNC_ALLOWED_HOSTS` — explicit outbound allowlist (overrides default
  private-host blocklist)
- `QUEENSYNC_ALLOW_PRIVATE_HOSTS` — set to `true` only for local dev
- `RADIO_BASE_URL`, `OBSERVATORY_BASE_URL` — adapter targets (default to
  `https://radio.ninja-portal.com` and `https://observatory.ninja-portal.com`).
  `OBSERVATORY_BASE_URL` is also the source for the Hologram TV HRM bridge.
- `QUEENSYNC_FORCE_MOCK` — when `true`, both adapters serve mock data
  regardless of the live endpoints. Useful for local dev. Health surfaces
  this as `mode=forced_mock` and a "QUEENSYNC_FORCE_MOCK" badge in the UI.
- `QUEENSYNC_FLOOR_POLL_MS` — interval (ms) for the radio floor-reactions
  poller. Defaults to `1000` so listener 🪶 reactions appear in the Signal
  Feed within ~1s. Set `QUEENSYNC_DISABLE_FLOOR_POLL=true` to disable it.

### External Sites

QueenSync v2.0 Wave 1 talks to these constellation services over HTTP. The
SSRF allowlist (`QUEENSYNC_ALLOWED_HOSTS`) must include them in production:

| Host | Purpose | Endpoints used |
|---|---|---|
| `radio.ninja-portal.com` | kannaka-radio venue | `/api/now-playing`, `/api/state`, `/api/floor`, `/api/history`, `/api/dreams`, `/api/swarm` |
| `observatory.ninja-portal.com` | kannaka-observatory consciousness snapshot | `/api/state` |
| `170.9.238.136` | Oracle public IP fallback for the observatory while a domain is being mapped (port 3334, http only — requires `QUEENSYNC_ALLOW_HTTP=true`) | `/api/state` |

Each adapter pull degrades gracefully: if the live endpoint fails, the
in-memory last-success cache is served and surfaced as `mode=stale`. If
there is no cache yet, mock data is served as `mode=mock`. Observatory
responses with `phi=xi=order=0` set `metricsSuppressed=true` (the bloated
HRM situation called out in ADR-002) and the Adapters page shows a
"metrics suppressed" badge.
- `KANNAKTOPUS_WAKE_URL`, `KANNAKTOPUS_API_KEY` — optional wake-poke endpoint
  fired by the "Wake Kannaktopus" demo button.

## Security posture

- Outbound URL guard rejects loopback and RFC1918 private addresses by default
  (overridable with `QUEENSYNC_ALLOWED_HOSTS` or
  `QUEENSYNC_ALLOW_PRIVATE_HOSTS=true`). Applies to `dispatchExternal` and
  `test-connection`.
- Task callbacks are HMAC-authenticated when `QUEENSYNC_CALLBACK_SECRET` is
  set, with a bearer-token fallback. Both use timing-safe comparison.
- The control plane is currently demo-friendly: arms onboarding and resonance
  endpoints do not require auth. Future hardening (per-arm authn, route-level
  RBAC) is tracked as in-flight tasks.

## Known limitations

These are tracked separately as in-flight tasks and will be addressed before
the control plane is opened to untrusted networks:

- **No authn on mutating routes** — onboarding, task creation, signal
  injection, and resonance routes are open today. A shared admin token /
  per-arm credential layer is in flight.
- **Single shared `QUEENSYNC_API_KEY`** for outbound auth — every arm
  configured with `authMethod != "none"` shares the same secret. Per-arm
  credential storage is planned.
- **Connection-test SSRF surface** — the default URL guard blocks private
  hosts, but DNS rebinding is not yet defeated. Tighter validation
  (resolved-IP recheck after fetch, redirect ban) is in flight.
- **No rate limits / audit trail on demo + adapter endpoints** — anyone with
  network access can spam `/api/demo/*` or `/api/adapters/*/pull`. Rate
  limiting + an admin audit trail are in flight.
- **JWT `authMethod` is a placeholder** — currently sends the same shared
  bearer token. Per-arm JWT signing will land alongside per-arm credentials.
- **Single-region Postgres** — the deployment assumes a single Replit
  Postgres instance. No replication or failover.
- **WebSocket needs Reserved VM** — Autoscale deployments will sever live
  event connections; deploy to a Reserved VM tier.
