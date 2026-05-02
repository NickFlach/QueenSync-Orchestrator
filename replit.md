# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

Currently hosts **QueenSync** — an agent orchestration + Resonance Control Protocol (RCP) plane for the Kannaka ecosystem. Frontend artifact `queensync` (dark "Queen Console" UI), backend `api-server` (Express + WebSocket on `/ws`), Postgres via Drizzle.

## QueenSync architecture

- API spec: `lib/api-spec/openapi.yaml`; codegen post-processed by `lib/api-spec/fix-index.mjs` (must stay — fixes a zod/types index name clash after every `pnpm codegen`).
- DB schemas: `lib/db/src/schema/{arms,tasks,signals,memory_events,logs,resonance_fields,resonance_responses}.ts`.
- Backend lib: `artifacts/api-server/src/lib/{ws,log,memory-gate,router,adapters,resonance,seed,audit,auth}.ts`.
- Routes mounted in `artifacts/api-server/src/routes/index.ts` (arms, tasks, signals, memory, logs, adapters, resonance, demo, summary).
- Rate limiting middleware: `artifacts/api-server/src/middlewares/rate-limit.ts` (in-memory token bucket per IP+limiter). Applied to `/api/demo/*` (10/min), `/api/adapters/*/pull` (12/min), `/api/tasks/:id/callback` (60/min). Exceeded calls return 429 + write a `rate_limited` log entry.
- Audit trail: every `recordLog({ ..., audit })` call from a request handler stamps `metadata.actor` / `metadata.ip` / `metadata.trigger` (built via `getAuditContext(req)`). Surfaced on the Logs page under each entry. `app.set('trust proxy', true)` so `req.ip` reflects the real client behind the Replit proxy.
- Server entry `artifacts/api-server/src/index.ts` wires HTTP + WebSocket, seeds 5 real arms (radio/observatory/kannaka-prime/swarm-worker/oracle-admin — set `QUEENSYNC_SEED_MOCK_ARMS=true` to also seed the legacy demo set), runs resonance expiry interval, and starts the 60s heartbeat scheduler (`heartbeat-scheduler.ts`) that demotes arms whose `lastHeartbeat` is older than `QUEENSYNC_ARM_STALE_MS` (default 180000) to `offline`.
- Real-arm liveness wiring lives in `docs/heartbeat-integration.md`: radio/observatory expose `/health` (probed by QueenSync) with optional Python push fallback to `/api/arms/:id/heartbeat`; kannaka-prime/swarm-worker publish `queen.event.join` on NATS every 30s (handled by `nats-bridge.ts → handlePresence`); oracle-admin self-heartbeats from `artifacts/oracle-admin/src/heartbeat.ts` when `QUEENSYNC_BASE_URL` + `QUEENSYNC_OPERATOR_TOKEN` are set.
- **oracle-admin shim** (`artifacts/oracle-admin/`) is a separate Node service — *not* a Replit artifact, no `artifact.toml`. Deployed off-Replit on the Oracle host as user `opc` via systemd + a narrow sudoers fragment. Receives HMAC-signed dispatches (`X-QueenSync-Timestamp` + `X-QueenSync-Body-Signature: sha256=HMAC(timestamp:body)` keyed by `QUEENSYNC_ORACLE_ADMIN_HMAC_SECRET`, ±5min replay window) and runs six capability handlers: `restart_radio`, `restart_observatory`, `trigger_oration_now`, `setOverride`, `dream_trigger`, `kannaka_status`. Echoes the `X-QueenSync-Completed/Failed-Signature` headers shipped by QueenSync back as `X-QueenSync-Signature` so the shim never holds the callback secret. The router branches on `arm.type === "oracle_admin"` to apply HMAC body signing in `lib/router.ts:dispatchExternal`.
- **Queen Console arm-detail dialog** renders capability quick-action buttons (Restart Radio / Restart Observatory / Trigger Oration / Trigger Dream Cycle / Kannaka Status) for every capability the inspected arm advertises; clicking dispatches a task and polls until `completed`/`failed` is rendered inline.
- Optional env: `RADIO_BASE_URL`, `OBSERVATORY_BASE_URL`, `QUEENSYNC_API_KEY` (all fall back to mock mode).

## QueenSync auth (operator vs viewer)

All mutating `/api/*` routes (arms POST/DELETE/heartbeat/test, tasks POST/retry, signals POST, memory/evaluate, resonance POST/respond/resolve, adapters/*/pull, demo/*) and the `/ws` WebSocket require an operator role. Read-only GETs are public unless `QUEENSYNC_REQUIRE_AUTH_FOR_READS=true` is set. Auth lives in `artifacts/api-server/src/lib/auth.ts` and `routes/auth.ts`.

Two auth modes:
- **Bearer token** — `Authorization: Bearer <token>`. Set `QUEENSYNC_OPERATOR_TOKEN` and/or `QUEENSYNC_VIEWER_TOKEN`. Legacy `QUEENSYNC_ADMIN_TOKEN` still accepted as operator.
- **Password login** — `POST /api/auth/login { password }` sets an HMAC-signed HttpOnly cookie (`queensync_session`, 12h TTL). Set `QUEENSYNC_OPERATOR_PASSWORD` and/or `QUEENSYNC_VIEWER_PASSWORD`, plus `QUEENSYNC_SESSION_SECRET` (auto-generated ephemeral if absent — sessions reset on restart).

The frontend (`artifacts/queensync`) gates the entire app behind `<AuthProvider>`/`LoginScreen`. Sidebar shows the current role and a sign-out button. 401/403 responses on any query/mutation auto-trigger a session refresh, which falls back to the login screen if the session has expired.

If **no** auth env vars are set, the server starts in OPEN mode (warns at startup, treats every caller as operator) — useful for local demo only. **Configure at least `QUEENSYNC_OPERATOR_TOKEN` or `QUEENSYNC_OPERATOR_PASSWORD` before exposing the app beyond a private demo.** WebSocket clients without a session cookie can authenticate via `?token=<bearer>` query param.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
