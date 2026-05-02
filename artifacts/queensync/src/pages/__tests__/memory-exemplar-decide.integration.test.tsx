/**
 * Integration test: real Express api-server (in-process, ephemeral port,
 * in-memory NATS) + real generated api-client + real DB + real <MemoryGate />
 * rendered in happy-dom. Clicks Re-absorb / Reject and asserts the right
 * KANNAKA.absorb publish + counter refresh behaviour.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { inArray } from "drizzle-orm";

import { db, memoryEventsTable } from "@workspace/db";
import {
  createInMemoryNatsClient,
  type NatsMessage,
} from "@workspace/nats";

// Pull api-server symbols by relative source path — both packages live in
// the same pnpm workspace and TS source is consumable directly.
import app from "../../../../api-server/src/app";
import {
  startNatsBridge,
  stopNatsBridge,
  getNatsClient,
} from "../../../../api-server/src/lib/nats-bridge";
import {
  evaluateMemory,
  recordAbsorbAck,
} from "../../../../api-server/src/lib/memory-gate";
import { ABSORB_SUBJECT } from "../../../../api-server/src/lib/memory-adapter";

import {
  setBaseUrl,
  setAuthTokenGetter,
} from "@workspace/api-client-react";

// happy-dom's fetch strips Authorization on cross-origin requests, so we
// substitute a node:http-backed fetch that preserves headers and returns a
// real Response object (so customFetch can read headers/body normally).
async function nodeFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;
  const method = (init?.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {};
  if (init?.headers) {
    new Headers(init.headers as HeadersInit).forEach((v, k) => {
      headers[k] = v;
    });
  }
  const bodyInit = init?.body;
  const bodyStr =
    typeof bodyInit === "string" || bodyInit == null
      ? (bodyInit as string | null | undefined)
      : JSON.stringify(bodyInit);
  const u = new URL(url);
  return new Promise<Response>((resolve, reject) => {
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const responseHeaders = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) {
              for (const item of v) responseHeaders.append(k, item);
            } else if (typeof v === "string") {
              responseHeaders.set(k, v);
            }
          }
          // Construct via the Uint8Array body so the Response carries a
          // readable body (customFetch checks `response.body == null`).
          const body =
            method === "HEAD" || res.statusCode === 204 || res.statusCode === 205
              ? null
              : new Uint8Array(buf);
          resolve(
            new Response(body, {
              status: res.statusCode ?? 0,
              statusText: res.statusMessage ?? "",
              headers: responseHeaders,
            }),
          );
        });
      },
    );
    req.on("error", reject);
    if (bodyStr != null) req.write(bodyStr);
    req.end();
  });
}
const NODE_FETCH = nodeFetch as unknown as typeof fetch;

// The Memory page subscribes to a websocket bridge for unrelated dream-lite
// progress updates. The decide flow doesn't depend on it, so stub it before
// the page module is imported. We mock once at module scope; the integration
// itself is otherwise un-mocked.
import { vi } from "vitest";
vi.mock("@/hooks/use-queensync-ws", () => ({
  useQueenSyncSocket: () => ({ lastEvent: null, status: "open" }),
}));

// Identity mock pins `@workspace/db` to a single module instance across the
// vitest graph; otherwise the test process and the in-proc api-server end
// up with two pg.Pool instances against the same DATABASE_URL.
vi.mock("@workspace/db", async () => {
  return await vi.importActual<Record<string, unknown>>("@workspace/db");
});

const TEST_TAG_MARKER = "wave4-exemplar-decide-ui-int";

let server: http.Server;
let baseUrl: string;
let captured: NatsMessage[] = [];
let MemoryGate: React.ComponentType;

async function dbCleanup(): Promise<void> {
  const rows = await db
    .select({ id: memoryEventsTable.id, content: memoryEventsTable.content })
    .from(memoryEventsTable);
  const ours = rows
    .filter((r) => r.content.includes(TEST_TAG_MARKER))
    .map((r) => r.id);
  if (ours.length > 0) {
    await db.delete(memoryEventsTable).where(inArray(memoryEventsTable.id, ours));
  }
}

beforeAll(async () => {
  // Boot real Express on an ephemeral port.
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  // Point the generated client at our test server. The Memory page's hooks
  // build relative paths like `/api/memory`; setBaseUrl prepends our origin.
  setBaseUrl(baseUrl);

  // Send the operator bearer when configured (so requireOperator passes
  // when QUEENSYNC_OPERATOR_TOKEN / QUEENSYNC_ADMIN_TOKEN is set; harmless
  // in fully-open dev configs that allow unauthenticated writes).
  const token =
    process.env["QUEENSYNC_OPERATOR_TOKEN"] ??
    process.env["QUEENSYNC_ADMIN_TOKEN"] ??
    null;
  setAuthTokenGetter(() => token);

  // Make sure happy-dom didn't shadow Node's fetch.
  (globalThis as { fetch: typeof fetch }).fetch = NODE_FETCH;

  // Lazy-import the page so the vi.mock for use-queensync-ws is in effect.
  MemoryGate = (await import("../memory")).default;
});

afterAll(async () => {
  setBaseUrl(null);
  setAuthTokenGetter(null);
  await stopNatsBridge();
  await dbCleanup();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(async () => {
  await dbCleanup();
  await stopNatsBridge();
  const inproc = createInMemoryNatsClient();
  await startNatsBridge({ client: inproc, url: null });
  const live = getNatsClient();
  if (!live) throw new Error("nats client must be started");
  captured = [];
  live.subscribe(ABSORB_SUBJECT, (msg) => {
    captured.push(msg);
  });
  // happy-dom can re-shadow fetch between cases; reapply.
  (globalThis as { fetch: typeof fetch }).fetch = NODE_FETCH;
});

afterEach(() => {
  cleanup();
});

function readCounter(testId: string): number {
  const node = screen.getByTestId(testId);
  const text = node.textContent ?? "";
  const m = text.match(/(\d+)/);
  if (!m) throw new Error(`no counter digits in ${testId}: "${text}"`);
  return Number(m[1]);
}

async function seedExemplar(label: string): Promise<string> {
  // Calls evaluateMemory directly (not POST /api/memory/evaluate) because
  // the EvaluateMemoryBody zod schema does not accept forcedDecision /
  // inboundExemplar; the @workspace/db identity mock above guarantees the
  // resulting row is visible to the in-proc api-server.
  const r = await evaluateMemory({
    type: "signal",
    content: `${TEST_TAG_MARKER}: ${label}`,
    forcedDecision: "pending",
    inboundExemplar: true,
  });
  if (!r.event) throw new Error("evaluateMemory did not persist an event");
  return r.event.id;
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryGate />
    </QueryClientProvider>,
  );
}

describe("Memory page · inbound exemplar decide flow (integration)", () => {
  it(
    "Re-absorb publishes on KANNAKA.absorb; ack drives strengthened counter; Reject prunes without publishing",
    async () => {
      // Baseline counters from the real /api/memory/exemplars/stats endpoint
      // before we seed anything (other rows in the dev DB may exist).
      const baselineRes = await NODE_FETCH(
        `${baseUrl}/api/memory/exemplars/stats`,
      );
      expect(baselineRes.status).toBe(200);
      const baseline = (await baselineRes.json()) as {
        strengthened: number;
        pruned: number;
        pending: number;
      };

      const uniq = `${Date.now()}-${Math.random()}`;
      const idA = await seedExemplar(`A-${uniq}-strengthen`);
      const idB = await seedExemplar(`B-${uniq}-prune`);

      // Sanity: confirm in-proc app's stats endpoint reflects our seeds.
      const postSeed = (await NODE_FETCH(
        `${baseUrl}/api/memory/exemplars/stats`,
      ).then((r) => r.json())) as {
        strengthened: number;
        pruned: number;
        pending: number;
      };
      expect(postSeed.pending).toBe(baseline.pending + 2);

      const postSeedList = (await NODE_FETCH(
        `${baseUrl}/api/memory?inboundExemplarsOnly=true`,
      ).then((r) => r.json())) as Array<{ id: string }>;
      const ids = postSeedList.map((r) => r.id);
      expect(ids).toContain(idA);
      expect(ids).toContain(idB);

      renderPage();

      // Wait for the seeded rows to appear in the rendered list. The page
      // queries /api/memory?inboundExemplarsOnly=true on mount.
      await waitFor(
        () => {
          expect(screen.getByTestId(`exemplar-row-${idA}`)).toBeTruthy();
          expect(screen.getByTestId(`exemplar-row-${idB}`)).toBeTruthy();
        },
        { timeout: 7000 },
      );

      // Visible counters reflect the real backend stats: pending = baseline + 2.
      await waitFor(() => {
        expect(readCounter("stat-pending")).toBe(baseline.pending + 2);
        expect(readCounter("stat-strengthened")).toBe(baseline.strengthened);
        expect(readCounter("stat-pruned")).toBe(baseline.pruned);
      });

      const user = userEvent.setup();

      // ── Re-absorb (strengthen) ────────────────────────────────────────
      const strengthenBtn = screen.getByTestId(
        `btn-exemplar-strengthen-${idA}`,
      ) as HTMLButtonElement;
      // The bridge is connected (in-memory client), so the button must be
      // enabled and there must be no nats-blocked badge.
      expect(strengthenBtn.disabled).toBe(false);
      expect(
        screen.queryByTestId(`badge-nats-blocked-exemplar-${idA}`),
      ).toBeNull();

      await user.click(strengthenBtn);

      // The real route persists absorb_state='pending' and publishes once on
      // KANNAKA.absorb. exemplar_outcome must NOT be set yet — strengthened
      // only increments after the HRM ack arrives.
      await waitFor(
        () => {
          expect(captured.length).toBe(1);
        },
        { timeout: 5000 },
      );
      expect(captured[0]!.subject).toBe(ABSORB_SUBJECT);
      const payload = captured[0]!.data as Record<string, unknown>;
      expect(payload["memoryId"]).toBe(idA);

      // Visible counters: still baseline.strengthened, pending unchanged
      // (row left "pending bucket" definition unchanged because
      // exemplar_outcome is still null).
      await waitFor(() => {
        expect(readCounter("stat-strengthened")).toBe(baseline.strengthened);
        expect(readCounter("stat-pending")).toBe(baseline.pending + 2);
      });

      // Simulate kannaka-memory acking on KANNAKA.absorb.ack.
      const acked = await recordAbsorbAck({
        memoryId: idA,
        idempotencyKey:
          (payload["idempotencyKey"] as string | undefined) ?? undefined,
        status: "absorbed",
        hrmId: "hrm-int-strengthen",
      });
      expect(acked).toBeTruthy();
      expect(acked!.absorbState).toBe("absorbed");
      expect(acked!.exemplarOutcome).toBe("strengthened");

      // ── Reject (prune) on the second exemplar ─────────────────────────
      const pruneBtn = screen.getByTestId(
        `btn-exemplar-prune-${idB}`,
      ) as HTMLButtonElement;
      expect(pruneBtn.disabled).toBe(false);
      await user.click(pruneBtn);

      // Pruning must NOT publish on KANNAKA.absorb — the captured count
      // remains exactly 1 (just the strengthen publish).
      // Give the prune mutation a beat to round-trip before the assertion.
      await waitFor(() => {
        expect(readCounter("stat-pruned")).toBe(baseline.pruned + 1);
      });
      expect(captured.length).toBe(1);

      // Final visible counter snapshot. The list query is invalidated by
      // the mutation onSettled hook, so the strengthened tick lands once
      // the refetch completes.
      await waitFor(
        () => {
          expect(readCounter("stat-strengthened")).toBe(
            baseline.strengthened + 1,
          );
          expect(readCounter("stat-pruned")).toBe(baseline.pruned + 1);
          expect(readCounter("stat-pending")).toBe(baseline.pending);
          expect(screen.queryByTestId(`exemplar-row-${idA}`)).toBeNull();
          expect(screen.queryByTestId(`exemplar-row-${idB}`)).toBeNull();
        },
        { timeout: 7000 },
      );
    },
    20000,
  );
});
