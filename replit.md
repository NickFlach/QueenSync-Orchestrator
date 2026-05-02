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
