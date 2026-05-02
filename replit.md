# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

Currently hosts **QueenSync** — an agent orchestration + Resonance Control Protocol (RCP) plane for the Kannaka ecosystem. Frontend artifact `queensync` (dark "Queen Console" UI), backend `api-server` (Express + WebSocket on `/ws`), Postgres via Drizzle.

## QueenSync architecture

- API spec: `lib/api-spec/openapi.yaml`; codegen post-processed by `lib/api-spec/fix-index.mjs` (must stay — fixes a zod/types index name clash after every `pnpm codegen`).
- DB schemas: `lib/db/src/schema/{arms,tasks,signals,memory_events,logs,resonance_fields,resonance_responses}.ts`.
- Backend lib: `artifacts/api-server/src/lib/{ws,log,memory-gate,router,adapters,resonance,seed}.ts`.
- Routes mounted in `artifacts/api-server/src/routes/index.ts` (arms, tasks, signals, memory, logs, adapters, resonance, demo, summary).
- Server entry `artifacts/api-server/src/index.ts` wires HTTP + WebSocket, seeds 5 default arms, runs resonance expiry interval.
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
