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
   - `QUEENSYNC_ALLOWED_HOSTS=radio.ninja-portal.com,observatory.ninja-portal.com,<…any-arm-host…>`
     to restrict outbound dispatch / connection-test to known hosts.
   - `RADIO_BASE_URL` and `OBSERVATORY_BASE_URL` — set to the live endpoints
     once Radio / Observatory are deployed; leave unset for mock mode.
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
- [ ] `QUEENSYNC_BASE_URL` set to the public URL (e.g. `https://ninja-portal.com`)
- [ ] `QUEENSYNC_CALLBACK_SECRET` set (required for trusted external arms)
- [ ] `QUEENSYNC_API_KEY` set if any arm needs auth headers on dispatch
- [ ] `QUEENSYNC_ALLOWED_HOSTS` populated with the real arm hosts
- [ ] `QUEENSYNC_ALLOW_PRIVATE_HOSTS` left unset (defaults to `false`)
- [ ] Reserved VM deployment tier selected (for WebSocket persistence)
- [ ] Custom domain attached and DNS validated

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

## Future MCP compatibility

The Onboarding flow already accepts `type: "mcp"` so an MCP server can be
registered as an arm with an `endpointUrl`. The current dispatcher treats it
as a generic external webhook (HTTP POST + JSON callback); a future revision
will replace the wire format with the MCP `tools/call` JSON-RPC envelope and
reuse the existing capability-matching + callback authentication paths. No
schema or onboarding UI change will be needed to adopt MCP — only the
`dispatchExternal` body shape.

## Future kannaka-memory integration

The Memory Gate keeps a local audit log of approved / rejected events in
Postgres. The plan is to mirror approved events to
[github.com/NickFlach/kannaka-memory](https://github.com/NickFlach/kannaka-memory)
as the canonical identity / memory substrate. A `lib/memory-adapter.ts`
placeholder will land alongside the v1.0 Memory Governance task; today the
Memory Gate runs entirely against Postgres.

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
