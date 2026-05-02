# QueenSync — Kannaka Control Plane

QueenSync is the agent orchestration plane and Resonance Control Protocol (RCP)
hub for the Kannaka ecosystem. It exposes a dark "Queen Console" UI plus an
Express + WebSocket API at `/api` and `/ws` from a single deployable artifact.

## Repository layout

```
artifacts/
  api-server/       Express 5 + WebSocket backend, Drizzle ORM
  queensync/        React + Vite frontend (Queen Console)
  mockup-sandbox/   Vite preview server for design iteration (not deployed)
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

## Kannaka repo mapping

| Kannaka repo / surface           | QueenSync representation                                               |
|----------------------------------|------------------------------------------------------------------------|
| `kannaktopus`                    | seeded arm `architect_01` (type `kannaktopus_arm`, capabilities build/plan/dream/compose)|
| `openclaw` (artifact forge)      | seeded arm `atelier_01` (type `local_simulated`, capabilities artifact/build/merge)|
| `radio.ninja-portal.com`         | seeded arm `signal_keeper_01` (type `external_webhook`) + Radio adapter|
| Memory / dream pipeline          | seeded arm `memory_keeper_01`                                          |
| `observatory.ninja-portal.com`   | seeded arm `auditor_01` + Observatory adapter                          |

Demo buttons on the overview page exercise these arms end-to-end:

- **Wake Kannaktopus** — issues 3 demo tasks routed through `architect_01` /
  `signal_keeper_01` / `memory_keeper_01`.
- **Dream Lite** — runs the Memory Gate over recent memory events and emits a
  `dream_lite` decision via `memory_keeper_01`.
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
| GET    | `/api/memory`                         | Memory Gate decisions                    |
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

## Onboarding & callbacks

Onboard an arm via `POST /api/arms` (or the Onboard button on the Arms page).
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

`authMethod` controls outbound headers (using `QUEENSYNC_API_KEY`):

- `none` → no auth header
- `api_key` → `X-API-Key: $QUEENSYNC_API_KEY`
- `bearer` → `Authorization: Bearer $QUEENSYNC_API_KEY`
- `jwt` → `Authorization: Bearer $QUEENSYNC_API_KEY` (placeholder until per-arm JWT signing lands)

When QueenSync dispatches to an external arm it includes `callbackUrl`,
`taskId`, `armId`, and (when `QUEENSYNC_CALLBACK_SECRET` is set) two
HMAC-SHA256 signatures the arm must echo back on `/api/tasks/:id/callback`:

- `X-QueenSync-Completed-Signature: sha256=…` for `status: "completed"`
- `X-QueenSync-Failed-Signature: sha256=…` for `status: "failed"`

The arm replies to `callbackUrl` with `{status, result?, error?}` and sets
`X-QueenSync-Signature` to whichever signature matches its outcome. If
`QUEENSYNC_CALLBACK_SECRET` is unset but `QUEENSYNC_ADMIN_TOKEN` is set, the
callback falls back to `Authorization: Bearer <token>`. With neither, the
callback accepts unauthenticated requests and logs a warning — only safe for
local development.

## Resonance Control Protocol (RCP)

A resonance field captures a high-level intent (`intent`, `tags`, `priority`,
`constraints`). Every arm with `resonanceMode != "off"` is offered the field
and scored:

```
score = tagOverlap*0.5 + priorityWeight*0.3 + availability*0.2
```

If `score >= sensitivity` the arm produces a textual response and a coherence
score. Resolution comes in two flavours:

- **best** — pick the response with the highest coherence score
- **merge** — concatenate the top responses, average the scores

Resolution emits `resonance_resolved` over the WebSocket and feeds the result
back into the Memory Gate.

## Signal → task loop

Every signal (manual injection, adapter pull, or programmatic) becomes a
routable task. The capability is taken from `payload.capability` if present,
otherwise inferred from the signal `type`:

| Signal type           | Default capability |
|-----------------------|--------------------|
| `build_request`       | `build`            |
| `radio_transmission`  | `transmit`         |
| `openclaw_artifact`   | `artifact`         |
| `memory_anomaly`      | `audit` (+ resonance) |
| `governance_alert`    | `audit` (+ resonance) |
| `observation_event`   | `observe` (+ resonance) |
| `other`               | `build`            |

Adapter pulls (`/adapters/radio/pull`, `/adapters/observatory/pull`) emit one
signal + one task + one resonance field per event so every external pulse is
both routed and openly resonant.

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
- `RADIO_BASE_URL`, `OBSERVATORY_BASE_URL` — adapter targets (optional, mock
  fallback)

## Security posture

- Outbound URL guard rejects loopback and RFC1918 private addresses by default
  (overridable with `QUEENSYNC_ALLOWED_HOSTS` or
  `QUEENSYNC_ALLOW_PRIVATE_HOSTS=true`). Applies to `dispatchExternal` and
  `test-connection`.
- Task callbacks are HMAC-authenticated when `QUEENSYNC_CALLBACK_SECRET` is
  set, with a bearer-token fallback. Both use timing-safe comparison.
- The control plane is currently demo-friendly: arms onboarding and resonance
  endpoints do not require auth. Future hardening (per-arm authn, route-level
  RBAC) is tracked as follow-up tasks.
