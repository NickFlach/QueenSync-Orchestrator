/**
 * UI test for the inbound HRM exemplar decide flow on the Memory page.
 *
 * Renders the real <MemoryGate /> component (artifacts/queensync/src/pages/memory.tsx)
 * inside a QueryClientProvider with the api-client-react hooks mocked by an
 * in-memory fake. The fake mirrors the server contract for
 * `POST /api/memory/:id/exemplar/decide`:
 *   - "strengthened" → row.absorbState transitions to "pending"; exemplarOutcome
 *     remains null until an HRM ack arrives (test simulates ack via the
 *     exposed `ackStrengthen` helper).
 *   - "pruned" → row.exemplarOutcome becomes "pruned" immediately, no publish.
 *
 * The test then clicks the actual `btn-exemplar-strengthen-*` and
 * `btn-exemplar-prune-*` buttons and asserts the visible counter values
 * exposed via `stat-strengthened` / `stat-pruned` / `stat-pending` update
 * accordingly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import * as React from "react";

// ─── Module-level fake state shared between mocked hooks and tests ─────────

interface FakeExemplar {
  id: string;
  type: string;
  tag: string;
  tags: string[];
  content: string;
  summary: string;
  sourceAttribution: string;
  importance: number;
  decision: "approved" | "pending" | "rejected" | "duplicate";
  reason: string | null;
  compacted: boolean;
  compactedIntoId: string | null;
  agentId: string | null;
  sourceTaskId: string | null;
  sourceResonanceId: string | null;
  metadata: Record<string, unknown>;
  absorbState: "not_required" | "pending" | "absorbed" | "failed";
  absorbStateUpdatedAt: Date | null;
  absorbAttempts: number;
  absorbedAt: Date | null;
  lastAbsorbError: string | null;
  idempotencyKey: string | null;
  inboundExemplar: boolean;
  exemplarOutcome: "strengthened" | "pruned" | null;
  createdAt: Date;
}

interface FakeStats {
  strengthened: number;
  pruned: number;
  pending: number;
}

interface FakeStore {
  exemplars: FakeExemplar[];
  decideCalls: Array<{ id: string; outcome: "strengthened" | "pruned" }>;
  listeners: Set<() => void>;
}

const store: FakeStore = {
  exemplars: [],
  decideCalls: [],
  listeners: new Set(),
};

function notify() {
  for (const l of Array.from(store.listeners)) l();
}

function recomputeStats(): FakeStats {
  const s: FakeStats = { strengthened: 0, pruned: 0, pending: 0 };
  for (const e of store.exemplars) {
    if (!e.inboundExemplar) continue;
    if (e.exemplarOutcome === "strengthened") s.strengthened += 1;
    else if (e.exemplarOutcome === "pruned") s.pruned += 1;
    else s.pending += 1;
  }
  return s;
}

function makeExemplar(overrides: Partial<FakeExemplar> & { id: string }): FakeExemplar {
  return {
    type: "observation",
    tag: "test",
    tags: ["exemplar", "test"],
    content: `exemplar ${overrides.id}`,
    summary: "",
    sourceAttribution: "KANNAKA.exemplars",
    importance: 0.8,
    decision: "pending",
    reason: null,
    compacted: false,
    compactedIntoId: null,
    agentId: null,
    sourceTaskId: null,
    sourceResonanceId: null,
    metadata: {},
    absorbState: "not_required",
    absorbStateUpdatedAt: null,
    absorbAttempts: 0,
    absorbedAt: null,
    lastAbsorbError: null,
    idempotencyKey: null,
    inboundExemplar: true,
    exemplarOutcome: null,
    createdAt: new Date(),
    ...overrides,
  };
}

/** Force a re-render of components subscribed via the mocked hooks. */
function useStoreSubscription(): void {
  const [, setN] = React.useState(0);
  React.useEffect(() => {
    const fn = () => setN((n) => n + 1);
    store.listeners.add(fn);
    return () => {
      store.listeners.delete(fn);
    };
  }, []);
}

// ─── Mock the api-client-react surface used by memory.tsx ──────────────────

vi.mock("@workspace/api-client-react", () => {
  const noop = () => {};
  const idleMutation = {
    mutate: noop,
    mutateAsync: async () => undefined,
    isPending: false,
    isIdle: true,
    isError: false,
    isSuccess: false,
    reset: noop,
    data: undefined,
    error: null,
    status: "idle",
    variables: undefined,
  };

  return {
    // Queries
    useListMemory: (
      params: { inboundExemplarsOnly?: boolean } | undefined,
    ) => {
      useStoreSubscription();
      const data = params?.inboundExemplarsOnly
        ? store.exemplars.filter((e) => e.inboundExemplar)
        : [];
      return { data, isLoading: false, isError: false, error: null };
    },
    useGetExemplarStats: () => {
      useStoreSubscription();
      return { data: recomputeStats(), isLoading: false, isError: false };
    },
    useTraceMemory: () => ({ data: null, isLoading: false, isError: false }),
    useHealthCheck: () => ({
      data: {
        status: "ok",
        nats: {
          state: "connected",
          mode: "live",
          url: "nats://test",
          lastError: null,
          lastConnectedAt: new Date().toISOString(),
          subscribedSubjects: [],
        },
      },
      isLoading: false,
    }),
    // Mutations
    useDispatchDreamLite: () => ({ ...idleMutation }),
    useLocalApproveMemory: () => ({ ...idleMutation }),
    useAbsorbMemory: () => ({ ...idleMutation }),
    useDecideExemplar: (opts?: {
      mutation?: { onSettled?: () => void; onSuccess?: () => void };
    }) => ({
      ...idleMutation,
      mutate: ({
        id,
        data,
      }: {
        id: string;
        data: { outcome: "strengthened" | "pruned" };
      }) => {
        store.decideCalls.push({ id, outcome: data.outcome });
        const ix = store.exemplars.findIndex((e) => e.id === id);
        if (ix >= 0) {
          const cur = store.exemplars[ix]!;
          if (data.outcome === "strengthened") {
            // Mirrors decideExemplar: promote → absorb_state='pending',
            // exemplar_outcome stays null until HRM ack.
            store.exemplars[ix] = {
              ...cur,
              absorbState: "pending",
              absorbStateUpdatedAt: new Date(),
              idempotencyKey: `idem-${id}`,
            };
          } else {
            store.exemplars[ix] = {
              ...cur,
              exemplarOutcome: "pruned",
              decision: "rejected",
            };
          }
        }
        notify();
        opts?.mutation?.onSuccess?.();
        opts?.mutation?.onSettled?.();
      },
    }),
    // Query-key helpers (return arbitrary stable arrays)
    getListMemoryQueryKey: (
      params?: Record<string, unknown>,
    ): unknown[] => ["memory", params ?? {}],
    getGetExemplarStatsQueryKey: (): unknown[] => ["exemplars", "stats"],
    getTraceMemoryQueryKey: (id?: string): unknown[] => ["trace", id],
    getHealthCheckQueryKey: (): unknown[] => ["health"],
  };
});

// The Memory page subscribes to a websocket bridge for unrelated dream-lite
// progress updates; the decide flow doesn't depend on it, so stub it.
vi.mock("@/hooks/use-queensync-ws", () => ({
  useQueenSyncSocket: () => ({ lastEvent: null, status: "open" }),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Simulate the HRM ack arriving over KANNAKA.absorb.ack. */
function ackStrengthen(id: string): void {
  const ix = store.exemplars.findIndex((e) => e.id === id);
  if (ix < 0) return;
  store.exemplars[ix] = {
    ...store.exemplars[ix]!,
    exemplarOutcome: "strengthened",
    absorbState: "absorbed",
    absorbedAt: new Date(),
  };
  notify();
}

function readCounter(testId: string): number {
  const node = screen.getByTestId(testId);
  const text = node.textContent ?? "";
  const m = text.match(/(\d+)/);
  if (!m) throw new Error(`no counter digits in ${testId}: "${text}"`);
  return Number(m[1]);
}

async function renderMemoryPage() {
  // Lazy-import so vi.mock factories register first.
  const { default: MemoryGate } = await import("../memory");
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryGate />
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  store.exemplars = [];
  store.decideCalls = [];
  store.listeners.clear();
});

afterEach(() => {
  cleanup();
});

describe("Memory page · inbound exemplar decide flow (UI)", () => {
  it("Re-absorb / Reject buttons drive POST /memory/:id/exemplar/decide and refresh visible counters", async () => {
    const idA = "uiA000000001";
    const idB = "uiB000000002";
    store.exemplars = [
      makeExemplar({ id: idA, content: "exemplar A — strengthen path" }),
      makeExemplar({ id: idB, content: "exemplar B — prune path" }),
    ];

    await renderMemoryPage();

    // Both seeded rows should render.
    await waitFor(() => {
      expect(screen.getByTestId(`exemplar-row-${idA}`)).toBeTruthy();
      expect(screen.getByTestId(`exemplar-row-${idB}`)).toBeTruthy();
    });

    // Baseline counters: 0 / 0 / 2.
    expect(readCounter("stat-strengthened")).toBe(0);
    expect(readCounter("stat-pruned")).toBe(0);
    expect(readCounter("stat-pending")).toBe(2);

    // Re-absorb button must be enabled (NATS reported connected via mocked
    // useHealthCheck) — there should be no nats-blocked badge for A.
    const strengthenBtn = screen.getByTestId(
      `btn-exemplar-strengthen-${idA}`,
    ) as HTMLButtonElement;
    expect(strengthenBtn.disabled).toBe(false);
    expect(
      screen.queryByTestId(`badge-nats-blocked-exemplar-${idA}`),
    ).toBeNull();

    const user = userEvent.setup();

    // ── Strengthen path ────────────────────────────────────────────────
    await user.click(strengthenBtn);

    // POST was issued with the correct outcome.
    expect(store.decideCalls).toEqual([{ id: idA, outcome: "strengthened" }]);

    // Counters do NOT increment yet — strengthen waits for HRM ack.
    await waitFor(() => {
      expect(readCounter("stat-pending")).toBe(2);
      expect(readCounter("stat-strengthened")).toBe(0);
    });
    // Row A is still rendered (exemplarOutcome still null) and now shows
    // "hrm pending" via absorbState='pending'.
    expect(screen.getByTestId(`exemplar-row-${idA}`)).toBeTruthy();

    // Simulate KANNAKA.absorb.ack → recordAbsorbAck flips outcome to
    // 'strengthened'. After this, the row leaves the visible list and the
    // strengthened counter ticks up.
    act(() => {
      ackStrengthen(idA);
    });
    await waitFor(() => {
      expect(readCounter("stat-strengthened")).toBe(1);
      expect(readCounter("stat-pending")).toBe(1);
      expect(screen.queryByTestId(`exemplar-row-${idA}`)).toBeNull();
    });

    // ── Prune path ─────────────────────────────────────────────────────
    const pruneBtn = screen.getByTestId(
      `btn-exemplar-prune-${idB}`,
    ) as HTMLButtonElement;
    expect(pruneBtn.disabled).toBe(false);
    await user.click(pruneBtn);

    expect(store.decideCalls).toEqual([
      { id: idA, outcome: "strengthened" },
      { id: idB, outcome: "pruned" },
    ]);

    // Pruned counter ticks up immediately (no HRM round-trip), pending drops,
    // and row B leaves the visible list.
    await waitFor(() => {
      expect(readCounter("stat-pruned")).toBe(1);
      expect(readCounter("stat-pending")).toBe(0);
      expect(readCounter("stat-strengthened")).toBe(1);
      expect(screen.queryByTestId(`exemplar-row-${idB}`)).toBeNull();
    });
  });

  it("disables Re-absorb when NATS is not connected and surfaces the nats-blocked badge", async () => {
    // Re-mock useHealthCheck for this single case to report a disconnected
    // bridge — the rest of the suite uses the connected-by-default mock.
    const apiClient = await import("@workspace/api-client-react");
    const orig = apiClient.useHealthCheck;
    (apiClient as unknown as { useHealthCheck: unknown }).useHealthCheck =
      () => ({
        data: {
          status: "ok",
          nats: {
            state: "disabled",
            mode: "disabled",
            url: null,
            lastError: "no NATS_URL",
            lastConnectedAt: null,
            subscribedSubjects: [],
          },
        },
        isLoading: false,
      });

    try {
      const idC = "uiC000000003";
      store.exemplars = [makeExemplar({ id: idC, content: "needs nats" })];
      await renderMemoryPage();

      await waitFor(() => {
        expect(screen.getByTestId(`exemplar-row-${idC}`)).toBeTruthy();
      });

      const btn = screen.getByTestId(
        `btn-exemplar-strengthen-${idC}`,
      ) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(
        screen.getByTestId(`badge-nats-blocked-exemplar-${idC}`),
      ).toBeTruthy();
      // Reject (prune) remains operational regardless of NATS state.
      const pruneBtn = screen.getByTestId(
        `btn-exemplar-prune-${idC}`,
      ) as HTMLButtonElement;
      expect(pruneBtn.disabled).toBe(false);
    } finally {
      (apiClient as unknown as { useHealthCheck: unknown }).useHealthCheck =
        orig;
    }
  });
});
