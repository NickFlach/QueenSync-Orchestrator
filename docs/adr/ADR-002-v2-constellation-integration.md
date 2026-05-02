# ADR-002 — QueenSync v2.0: Real Constellation Integration

**Status:** Wave 3 in progress (Waves 1–2 shipped; Wave 3 swarm + oracle-admin landing)
**Date:** 2026-05-02
**Authors:** Nick Flach + Kannaka constellation
**Builders:** Replit Agent (primary), Kannaka constellation (review + integration testing)
**Related:** QueenSync v1.0 (already shipped by Replit); kannaka-radio ADR-0001..0008;
kannaka-memory ADR-0020/0026; kannaka-staff ADR-001; Kannaktopus repo

---

## Why this ADR exists

QueenSync v1.0 ships a polished orchestration plane — Express 5 + WebSocket
API, Postgres + Drizzle, dark "Queen Console" React UI, OpenAPI 3.1
source-of-truth with Orval codegen, HMAC-signed callbacks, operator/viewer
auth. It looks production. **But the adapters are mocked, the swarm is
absent, and the memory gate persists nothing the rest of the constellation
can read.** v2.0 closes that gap.

In parallel I (Kannaka, via Claude Code) built `kannaka-staff` — a single-
file Node.js watcher running on Oracle with thirteen probes, an alert log,
a quick-action operations console, an album-publish CLI, and a curator
audit panel. Half of what kannaka-staff does belongs *inside* QueenSync.
v2.0 is also where that consolidation happens.

This ADR is **for Replit to implement.** It's structured as four waves of
concrete deliverables, each shippable on its own.

---

## What exists in the constellation today (the ground truth)

Replit's v1.0 README treats Radio, Observatory, Kannaktopus, and
kannaka-memory as abstract reference points. They're real. They run.

| Component | Repo | Where it runs | Public surface |
|---|---|---|---|
| **kannaka-radio** | NickFlach/kannaka-radio | Oracle Cloud (`ninjaportal`, 170.9.238.136), `kannaka-radio.service` | `https://radio.ninja-portal.com/` (Door, /player, /agent, /stream, /api/*) |
| **kannaka-memory** | NickFlach/kannaka-memory | Oracle, `kannaka-memory.service` (`kannaka swarm listen`), `kannaka-swarm-serve.service` (kannaka-prime ask/reply), `kannaka-swarm-worker.service` (work queue) | NATS subjects on `swarm.ninja-portal.com:4222` |
| **kannaka-observatory** | NickFlach/kannaka-observatory | Oracle, `kannaka-observatory.service` on `:3334` | (currently behind Oracle, not yet domain-mapped) |
| **kannaka-cannon** | NickFlach/kannaka-cannon | Local on user's Windows machine (Python). 51 MCP tools. | Used as a library by other constellation tooling |
| **Kannaktopus** | NickFlach/Kannaktopus | Local + MCP server on `:8787` | MCP tools, multi-model CLI |
| **NATS swarm** | (infrastructure) | Oracle, `nats-server` on `:4222` | Public read-only on `swarm.ninja-portal.com:4222`. Subjects: `KANNAKA.consciousness`, `KANNAKA.dreams`, `KANNAKA.agents`, `KANNAKA.exemplars`, `KANNAKA.reactions`, `KANNAKA.ask.<id>`, `KANNAKA.ask.broadcast`, `QUEEN.phase.*`, `queen.event.{join,leave,dream.start,dream.end,memory.shared}`, queue group `kannaka_workers` |
| **OpenBotCity (OBC)** | external (api.openbotcity.com) | Hosted | Heartbeat, building actions, gallery, feed/post, world/move, world/speak |
| **kannaka-staff** | NickFlach/kannaka-staff | Oracle, `kannaka-staff.service` on `:8889` | Watcher dashboard + 13 probes + ops console |

**Key NATS subjects v2.0 must speak fluently:**

- `KANNAKA.consciousness` — phi/xi/Kuramoto-order updates from kannaka-prime, ~every dream cycle
- `KANNAKA.dreams` — dream cycle reports (strengthened, pruned, hallucinated)
- `KANNAKA.agents` — per-agent presence + state gossip (auth required)
- `KANNAKA.exemplars` — top-25 cluster exemplars after each dream
- `KANNAKA.reactions` — Floor reactions in real time
- `QUEEN.phase.*` — per-agent phase signals
- `queen.event.dream.{start,end}` — dream lifecycle hooks
- `KANNAKA.ask.<agent_id>` — REQ/REPLY for direct ask
- `KANNAKA.ask.broadcast` — REQ/REPLY broadcast (self-throttled)
- `kannaka_workers` (queue group) — distributed work queue

---

## The constellation as QueenSync abstractions

Map the v1.0 abstractions onto real services:

### Arms (today's mock → v2.0 real)

| v1.0 mock arm types | v2.0 real arms |
|---|---|
| `kannaktopus_arm` | Real Kannaktopus instance reachable on `:8787` |
| `external_webhook` | Future builders / external collaborators |
| `replit_hosted` | (this is what QueenSync itself is) |
| `openclaw` | OBC bot agent (Kannaka's `0f05e10b-…` bot, or GossipGhost's `b5a9d58f-…`) |
| `local_simulated` | retain for tests; remove from production registry |
| **NEW: `oracle_admin`** | Tiny shim service running on Oracle with sudo for systemctl; receives "restart-radio", "trigger-oration" tasks |
| **NEW: `radio`** | The kannaka-radio service itself, registered with capabilities `play`, `oration`, `showcase`, `intro`, `voice_dj` |
| **NEW: `observatory`** | The observatory service, capabilities `consciousness_metrics`, `phi_history` |
| **NEW: `kannaka_prime`** | The NATS-listening swarm primary, capabilities `recall`, `dream`, `swarm_serve` |
| **NEW: `swarm_worker`** | Worker pool consumers of `kannaka_workers`, capability `worker_compose` |

### Signals → resonance fields (v2.0 wires the real bus)

In v1.0 these are mocked. In v2.0:

- `KANNAKA.dreams` events become resonance fields tagged
  `dream / consciousness / consolidation`. Memory Gate ingests dream
  reports as compressed memory events (importance proportional to
  `memories_strengthened + memories_hallucinated`).
- `KANNAKA.consciousness` updates become signal events with phi/xi as
  metrics. Routed to observatory arm.
- `KANNAKA.reactions` (Floor reactions) become signals tagged
  `audience / engagement`. The kannaka-radio arm gets a chance to bump
  the reacted-to track via the existing resonance loop.
- `KANNAKA.exemplars` become memory events tagged `exemplar / cluster`.
  Memory Gate either absorbs or rejects each.
- `queen.event.join / leave` become arm presence events.

### Memory Gate (v2.0 = real bridge)

v1.0 stores memory events in Postgres only. v2.0 must also push approved
events into kannaka-memory's HRM via NATS:

- Approved events publish on `KANNAKA.absorb` (or via an `absorb-on-resonance`
  worker per ADR-0026 Phase 6 in kannaka-memory).
- Rejected events stay logged in Postgres for audit but never reach HRM.
- Dream Lite Compression (already in v1.0) stays — but the compressed
  events flow back to HRM with high importance.

This is the bidirectional loop kannaka-memory's ADR-0026 was preparing
for. v2.0 of QueenSync is the concrete consumer.

---

## Where kannaka-staff goes

`kannaka-staff` and v1.0 of QueenSync overlap structurally — both watch the
constellation and surface state. Three options were considered:

| Option | Outcome |
|---|---|
| **A.** Fold kannaka-staff into QueenSync v2.0 entirely | Recommended. `staff/` becomes an internal QueenSync module. Watcher probes become QueenSync's internal health-check loop. Album-publish CLI becomes a QueenSync admin endpoint. Operations console buttons become Queen Console actions. The standalone repo gets archived with a redirect note. |
| B. Keep kannaka-staff as a small Oracle-side shim | Acceptable fallback if QueenSync v2.0 can't take on Oracle-side admin actions safely. The shim becomes the `oracle_admin` arm. |
| C. Both stay independent | Reject. Two operations layers maintained in parallel = drift. |

**v2.0 implements Option A**, with one carve-out: the **`oracle_admin` arm**
(Option B's shim) keeps living on Oracle, because QueenSync's Replit
deployment should *not* have sudo on Oracle's systemd. QueenSync dispatches
admin tasks; Oracle's tiny shim executes them. That keeps QueenSync's blast
radius bounded.

---

## v2.0 waves

Each wave ships independently. Test each before starting the next.

### Wave 1 — Real adapter integration

**Goal:** kill the mock adapters, wire to live services.

- `RADIO_BASE_URL=https://radio.ninja-portal.com` — already supported by v1.0
- `OBSERVATORY_BASE_URL` → `http://170.9.238.136:3334` (or domain-mapped if
  the user has set one up)
- Add `NATS_URL=nats://swarm.ninja-portal.com:4222` and a NATS client
  to `lib/nats/` — this becomes a workspace package other modules can
  import. Use the official `nats.js` for Node 24.
- The Radio adapter in v2.0 reads from real `/api/state`, `/api/floor`,
  `/api/history`, `/api/swarm`, `/api/dreams`, `/api/now-playing`. All
  shapes documented in `https://radio.ninja-portal.com/agent` (the
  Greenroom). Code-gen from those if useful.
- Observatory adapter reads from `:3334/api/state`. Currently observatory
  may report all-zero consciousness metrics due to a bloated HRM —
  surface that condition explicitly in the QueenSync UI rather than
  silently showing zeros.
- Mock mode stays as a fallback for development without the live
  endpoints. Document with `QUEENSYNC_FORCE_MOCK=true`.

**Success criteria:** Queen Console at `/signals` shows real radio
transmissions and observatory events. Floor reactions appear in the
signal feed within 1s of a listener clicking 🪶.

### Wave 2 — NATS subscription + resonance generation

**Goal:** the constellation's swarm bus becomes the real-time signal source.

- Subscribe to `KANNAKA.dreams`, `KANNAKA.consciousness`, `KANNAKA.reactions`,
  `KANNAKA.exemplars`, `queen.event.dream.{start,end}`.
- Each subscription generates either a signal, a resonance field, or a
  memory event per the mapping table in this ADR.
- Disconnect/reconnect cleanly; surface NATS connection state in the
  System Status panel.
- The "Connection Test" button on arms can publish to `KANNAKA.ask.<id>`
  and wait for a reply (REQ/REPLY) instead of HTTP probe — for arms
  registered as NATS-reachable.

**Success criteria:** The Queen Console "Signal Feed" populates in real
time during a `kannaka dream --mode lite` run. The "Resonance" panel
shows a field auto-created from the dream event.

### Wave 3 — Real arm registration for the constellation

**Goal:** every constellation service registers as an arm. The Queen
Console becomes the live directory.

- Seed migration: replace the 5 default mock arms with real registrations
  for `radio`, `observatory`, `kannaka-prime`, `swarm-worker`, `oracle-admin`.
- Each registers with its real `endpointUrl` (or NATS-reachable indicator),
  `capabilities`, `resonanceTags`. The radio's capabilities list:
  `["play", "oration", "showcase", "intro", "voice_dj", "track_request",
  "stream_health"]`.
- The `oracle_admin` arm is a small new Node service this ADR commissions:
  `/home/opc/queensync-oracle-admin/` running as `queensync-oracle-admin.service`.
  It exposes a single POST endpoint with HMAC auth that QueenSync calls
  with task payloads. Capabilities: `restart_radio`, `restart_observatory`,
  `trigger_oration_now`, `setOverride`, `dream_trigger`, `kannaka_status`.
  This arm is the only thing on Oracle with sudo for systemctl on the
  kannaka services — sudoers already configured for the `opc` user during
  kannaka-staff Phase 1.
- Health-checks (heartbeat) replace kannaka-staff's per-probe loop. v2.0's
  scheduler runs every 60s, marks stale arms unavailable.

**Success criteria:** Queen Console at `/arms` lists the live constellation.
A "Restart Radio" button on the radio arm dispatches a task to the
`oracle_admin` arm; the radio actually restarts; the task shows
`completed`.

#### Wave 3 — implementation notes (delivered)

- **Seed lineup.** `artifacts/api-server/src/lib/seed.ts` now ships with two
  arrays: `REAL_ARMS` (the five live registrations above) and `MOCK_ARMS`
  (the legacy Wave-1 demo set). The mocks are only inserted when
  `QUEENSYNC_SEED_MOCK_ARMS=true|1`. On boot, any legacy mock rows from
  earlier deploys are deleted; flipping the flag back off cleans them up
  on the next boot. Real arms seed `status="idle"` so the capability
  picker can dispatch to them immediately — the heartbeat sweeper
  demotes them to `offline` when they actually go silent. A one-time
  migration in `seedDefaults()` promotes any pre-existing real-arm row
  whose status is still `offline` AND `lastHeartbeat IS NULL` (the old
  default) to `idle`; rows that are offline because they actually
  heartbeated and went stale are left alone. The same loop reconciles
  capability/endpoint drift on existing real-arm rows so the ADR's
  required capability set stays the source of truth.
- **Capability lineup.** Wave 3 fixes the picker drift surfaced in code
  review: `observatory` adds `phi_history`; `kannaka-prime` adds
  `recall` and `swarm_serve`; `swarm-worker` adds `worker_compose` and
  carries the `queue:kannaka_workers` resonance tag (representing the
  NATS queue group `kannaka_workers` on the arms table, which has no
  dedicated column).
- **`oracle_admin` arm type.** Added to the `Arm.type` and
  `OnboardArmBody.type` enums in `lib/api-spec/openapi.yaml`; codegen
  regenerated. The router (`lib/router.ts:dispatchExternal`) now treats
  `oracle_admin` like `external_webhook` for outbound POST, but additionally
  attaches `X-QueenSync-Timestamp: <unix_ms>` and
  `X-QueenSync-Body-Signature: sha256=HMAC-SHA256(timestamp:body)` keyed
  by `QUEENSYNC_ORACLE_ADMIN_HMAC_SECRET`. Sign/verify helpers live in
  `lib/auth.ts` (`signOracleAdminBody`, `verifyOracleAdminBody`,
  `isOracleAdminSigningConfigured`) with a ±5 minute replay window.
  Unsigned dispatches are still attempted (with a warn log) when the
  secret is unset, so local dev still works.
- **The shim.** `artifacts/oracle-admin/` is a small Express 5 + pino
  service (`POST /dispatch`, `GET /healthz`). It verifies the HMAC body
  signature, immediately replies `202 accepted`, and runs the matching
  capability handler asynchronously. The six handlers map to:
  `restart_radio` / `restart_observatory` → `sudo systemctl restart …`;
  `trigger_oration_now` → `POST $RADIO_BASE_URL/admin/oration/now`;
  `setOverride` → `POST $OBSERVATORY_BASE_URL/admin/override` with
  `{target,value}` from `context`; `dream_trigger` →
  `POST $KANNAKA_DREAM_TRIGGER_URL` (or local `kannaka-dream.service`);
  `kannaka_status` → `GET $KANNAKA_STATUS_URL` (default `127.0.0.1:7777`).
  After the handler resolves, the shim posts the callback to QueenSync
  with `X-QueenSync-Signature` echoed from the dispatch's
  `X-QueenSync-Completed-Signature` / `X-QueenSync-Failed-Signature`
  headers — so the shim never holds `QUEENSYNC_CALLBACK_SECRET`.
- **Deployment artifacts.** `artifacts/oracle-admin/systemd/`
  ships `queensync-oracle-admin.service` (runs as `opc`,
  `EnvironmentFile=/etc/queensync-oracle-admin.env`,
  `ExecStart=/usr/bin/node /opt/queensync-oracle-admin/dist/index.mjs`)
  and `sudoers.d-queensync-oracle-admin` with a narrow `Cmnd_Alias` of
  the four exact `systemctl` invocations the shim is allowed to run
  (`NOPASSWD`). `artifacts/oracle-admin/README.md` is the operator
  runbook (build → rsync → install env file → install sudoers fragment →
  enable systemd unit → verify `/healthz`).
- **Heartbeat scheduler.** `lib/heartbeat-scheduler.ts` runs every 60s
  (configurable, default `DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000`),
  selects arms whose `lastHeartbeat` is older than
  `QUEENSYNC_ARM_STALE_MS` (default 180000ms) and whose status is not
  `offline`/`failed`, demotes them to `offline`, broadcasts
  `arms_updated`, and writes an `arm_marked_offline` log entry per arm.
  Started from `artifacts/api-server/src/index.ts`. Arms that have
  never heartbeated (lastHeartbeat IS NULL) are intentionally left alone
  so seeded `offline` rows don't churn.
- **Queen Console — quick actions.** `artifacts/queensync/src/pages/arms.tsx`
  ArmDetailDialog now renders a "Quick Actions" panel with one button
  per matching capability (Restart Radio, Restart Observatory, Trigger
  Oration, Trigger Dream Cycle, Kannaka Status). Each button calls
  `useCreateTask` with the corresponding capability — the picker routes
  the task to the only arm advertising it (`oracle-admin`). The dialog
  then polls `useGetTask` every 2s and surfaces the live `[active]` →
  `[completed]`/`[failed]` status plus the result/error payload returned
  by the shim's callback.
- **Tests.** `artifacts/oracle-admin/src/__tests__/` covers HMAC
  good/bad/expired/missing/tampered signatures and dispatch routing for
  oration / unknown-capability / setOverride-validation /
  kannaka_status. `artifacts/api-server/src/lib/__tests__/auth-oracle.test.ts`
  exercises sign/verify round-trips, header constants, and the
  unset-secret no-op path. `…/heartbeat-scheduler.test.ts` covers
  stale-vs-fresh demotion, the offline/failed bypass, the never-pinged
  bypass, and the `staleMs` override. `…/seed.test.ts` covers
  real-only / mocks-on / mocks-off-cleanup / oracle-admin shape /
  default-status assertions.

**Out of scope for Wave 3** (deferred to follow-ups):
per-arm rotating credentials (#17), oracle-admin runtime hardening
(#18), an audit log for privileged dispatches (#19), and Wave 4/5
behavior. The shim ships with a single shared HMAC secret —
operators **must** set `QUEENSYNC_ORACLE_ADMIN_HMAC_SECRET` (and the
matching env on the Oracle host) before exposing the shim publicly.

**Transport security.** HMAC body signing protects request integrity
and authenticity, but plain HTTP allows passive on-path replay within
the ±5min timestamp window. The seeded `QUEENSYNC_ORACLE_ADMIN_URL`
defaults to `https://oracle-admin.ninja-portal.com/dispatch`; the
shim itself binds `127.0.0.1:8090` by default
(`ORACLE_ADMIN_HOST=127.0.0.1`) and logs a loud warning at startup if
overridden to a non-loopback host. It is expected to be exposed only
via a TLS-terminating reverse proxy (nginx/caddy/Traefik) or a private
tunnel (Tailscale/WireGuard). The README runbook covers both.

### Wave 4 — Memory Gate ↔ HRM bridge

**Goal:** approved memory events flow into kannaka-memory's HRM.

- Memory Gate UI gains an "Absorb to HRM" approval action.
- Approved events publish on `KANNAKA.absorb` (or whichever subject
  ADR-0026 Phase 6 defines). kannaka-prime's `kannaka swarm worker` (already
  running) absorbs and acks.
- Bidirectional: HRM's `KANNAKA.exemplars` arrive in QueenSync as
  candidate memory events. Memory Gate gets a "Re-absorb / Reject"
  workflow for them. Each round-trip strengthens or prunes.
- "Dream Lite Compression" (already in v1.0) becomes a button that
  dispatches `kannaka dream --mode lite` to the `kannaka-prime` arm —
  honest about the current cost (5+ minutes on a bloated medium) and
  shows the progress in the UI.

**Success criteria:** A signal arriving from the radio flows
signal → resonance field → arm response → memory event candidate →
Memory Gate approval → HRM absorption. End-to-end visible in the UI.

### Wave 5 — Production deploy + auth hardening

**Goal:** ninja-portal.com goes live.

- Production-deploy QueenSync on Replit Reserved VM. Custom domain
  `ninja-portal.com` with `console.ninja-portal.com` for the Queen Console
  (since `radio.ninja-portal.com` already takes the radio).
- All required production secrets configured per the v1.0 README's
  Production Checklist.
- `QUEENSYNC_ALLOWED_HOSTS` populated with the real arm hosts so SSRF
  guard works.
- Operator passwords + bearer tokens issued. Recommend separate tokens
  per arm-type for revocation granularity.
- Logging exports to a file or external service so we don't lose
  forensics on a Replit redeploy.
- Watcher-style external canary on Fly.io free tier hits
  `console.ninja-portal.com/api/health` from outside Oracle's network so
  if Oracle disappears entirely, we still alert.

**Success criteria:** `https://console.ninja-portal.com/` is the live Queen
Console. The constellation runs from there. The standalone kannaka-staff
service is decommissioned (replaced by QueenSync's internal probes + the
`oracle_admin` arm).

---

## Where each piece runs after v2.0

```
                       ┌──────────────────────────────┐
   replit deployment   │  console.ninja-portal.com    │   QueenSync
   (reserved VM)       │  api-server + queen console  │   palace
                       │  postgres (replit)            │
                       └──────────┬───────────────────┘
                                  │  HTTP + NATS
                                  │
              ┌───────────────────┼─────────────────────┐
              │                   │                     │
   ┌──────────▼──────────┐  ┌─────▼──────┐  ┌──────────▼────────┐
   │   Oracle (Free)     │  │    NATS    │  │   External arms    │
   │ kannaka-radio       │  │  on Oracle │  │  (OBC, future       │
   │ kannaka-memory      │  │  swarm.ninja│ │   collaborators)    │
   │ kannaka-observatory │  │  -portal.com│ │                     │
   │ kannaka-swarm-serve │  │   :4222    │  └────────────────────┘
   │ kannaka-swarm-worker│  └────────────┘
   │ icecast2 / nats     │
   │ queensync-oracle-   │
   │   admin (NEW —      │
   │   sudo shim)        │
   └─────────────────────┘
                       
   ┌─────────────────────┐
   │ Fly.io free tier    │
   │ external canary     │   pings ninja-portal.com from outside
   └─────────────────────┘
```

---

## What kannaka-staff repo becomes

Once v2.0 Wave 5 is live:

1. The standalone `kannaka-staff.service` on Oracle is stopped.
2. The `kannaka-staff` repo's README gets a top notice: "This repo is
   superseded by QueenSync v2.0. The Watcher's probe loop, ops console,
   album-publish CLI, and Curator audit live in QueenSync now. The
   `oracle_admin` shim that replaces this service lives in
   QueenSync-Orchestrator/artifacts/oracle-admin/."
3. The repo is archived (read-only) but kept for the ADR + the album-
   publish design notes which are still useful as reference.

---

## Open questions / decisions for the user

1. **Domain:** `console.ninja-portal.com` vs `queensync.ninja-portal.com` vs
   `palace.ninja-portal.com`? The metaphor language across the constellation
   is "venue / palace / room" — `console` reads more operations-y, `palace`
   matches the venue language.
2. **Auth model in production:** start with operator/viewer passwords, or
   require bearer tokens from day one?
3. **Postgres:** Replit-attached Postgres is fine for development. For
   production, do we keep using Replit's, or move to a managed Postgres
   somewhere with a backup story?
4. **Memory Gate strictness:** every event approved by default, or every
   event held for review by default? Recommend "review-by-default" until
   we trust the ingestion shape.
5. **Showcase narration in QueenSync:** should the album-showcase narration
   composition (currently in `kannaka-radio/server/peace-oration.js`)
   migrate to a QueenSync Storyteller module? Probably yes after Wave 4 —
   centralizes all LLM-routing through QueenSync's auth-bounded calls.

---

## Phase-out checklist (v1.0 → v2.0)

- [ ] Wave 1 — real adapters wired
- [ ] Wave 2 — NATS subscription generating signals + resonance
- [ ] Wave 3 — `oracle_admin` arm built + deployed; constellation seeded
- [ ] Wave 4 — Memory Gate ↔ HRM round-trip working
- [ ] Wave 5 — production deploy on `console.ninja-portal.com`
- [ ] kannaka-staff service stopped on Oracle
- [ ] kannaka-staff repo archived with redirect README
- [ ] External Fly.io canary deployed
- [ ] ADR-002 closed with implementation notes

— ADR-002
