import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db, memoryEventsTable } from "@workspace/db";
import { ABSORB_SUBJECT } from "../memory-adapter";
import { evaluateMemory, requestAbsorb } from "../memory-gate";
import {
  startNatsBridge,
  stopNatsBridge,
  getNatsClient,
} from "../nats-bridge";
import {
  createInMemoryNatsClient,
  type NatsMessage,
} from "@workspace/nats";
import {
  nextRetryAt,
  runAbsorbRetrySweep,
  startAbsorbRetryScheduler,
  stopAbsorbRetryScheduler,
  DEFAULT_ABSORB_RETRY_BASE_MS,
} from "../absorb-retry";

const TEST_TAG_MARKER = "absorb-retry-test";

async function cleanup(): Promise<void> {
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

async function ensureBridge(): Promise<void> {
  await stopNatsBridge();
  const client = createInMemoryNatsClient();
  await startNatsBridge({ client, url: null });
}

function captureSubject(subject: string): NatsMessage[] {
  const captured: NatsMessage[] = [];
  const client = getNatsClient();
  assert.ok(client, "nats client must be started");
  client.subscribe(subject, (msg) => {
    captured.push(msg);
  });
  return captured;
}

describe("absorb-retry sweep", () => {
  before(async () => {
    await cleanup();
  });
  after(async () => {
    stopAbsorbRetryScheduler();
    await stopNatsBridge();
    await cleanup();
  });
  beforeEach(async () => {
    stopAbsorbRetryScheduler();
    await cleanup();
    await ensureBridge();
  });

  it("nextRetryAt computes exponential backoff capped by maxBackoffMs", () => {
    const t = new Date(1_000_000);
    // attempts=1 → base
    assert.equal(
      nextRetryAt(1, t, { baseBackoffMs: 1000, maxBackoffMs: 60_000 }),
      t.getTime() + 1000,
    );
    // attempts=4 → base * 8 = 8000
    assert.equal(
      nextRetryAt(4, t, { baseBackoffMs: 1000, maxBackoffMs: 60_000 }),
      t.getTime() + 8000,
    );
    // capped
    assert.equal(
      nextRetryAt(10, t, { baseBackoffMs: 1000, maxBackoffMs: 5000 }),
      t.getTime() + 5000,
    );
    // null updatedAt → immediately eligible (epoch 0)
    assert.equal(nextRetryAt(3, null), 0);
  });

  it("re-publishes a failed row whose backoff has elapsed", async () => {
    // Step 1 — produce a failed row by running requestAbsorb while NATS is down.
    await stopNatsBridge();
    const ev = await evaluateMemory({
      type: "agent_output",
      content: `${TEST_TAG_MARKER}: critical decision approved while bridge offline`,
    });
    assert.ok(ev.event);
    const failed = await requestAbsorb(ev.event.id);
    assert.equal(failed.event?.absorbState, "failed");
    assert.equal(failed.event?.absorbAttempts, 1);

    // Backdate the failure so the backoff window has clearly elapsed.
    await db
      .update(memoryEventsTable)
      .set({ absorbStateUpdatedAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(memoryEventsTable.id, ev.event.id));

    // Step 2 — bring NATS back, then sweep.
    await ensureBridge();
    const captured = captureSubject(ABSORB_SUBJECT);
    const retried = await runAbsorbRetrySweep({
      maxAttempts: 5,
      baseBackoffMs: 1000,
    });
    assert.deepEqual(retried, [ev.event.id]);
    assert.equal(captured.length, 1, "retry must republish on KANNAKA.absorb");

    const [row] = await db
      .select()
      .from(memoryEventsTable)
      .where(eq(memoryEventsTable.id, ev.event.id))
      .limit(1);
    assert.equal(row.absorbState, "pending");
    assert.equal(row.absorbAttempts, 2);
    assert.equal(row.lastAbsorbError, null);
  });

  it("skips rows whose backoff has not yet elapsed", async () => {
    await stopNatsBridge();
    const ev = await evaluateMemory({
      type: "agent_output",
      content: `${TEST_TAG_MARKER}: build approved decision while offline (backoff guard)`,
    });
    assert.ok(ev.event);
    await requestAbsorb(ev.event.id);
    // Leave absorbStateUpdatedAt at "just now" — backoff cannot have elapsed.
    await ensureBridge();
    const captured = captureSubject(ABSORB_SUBJECT);
    const retried = await runAbsorbRetrySweep({
      maxAttempts: 5,
      baseBackoffMs: DEFAULT_ABSORB_RETRY_BASE_MS,
    });
    assert.deepEqual(retried, []);
    assert.equal(captured.length, 0);
  });

  it("does not retry rows that have hit the attempt cap", async () => {
    await stopNatsBridge();
    const ev = await evaluateMemory({
      type: "agent_output",
      content: `${TEST_TAG_MARKER}: anomaly critical decision approved (cap test)`,
    });
    assert.ok(ev.event);
    await requestAbsorb(ev.event.id);
    // Force attempts to the cap and backdate so backoff is irrelevant.
    await db
      .update(memoryEventsTable)
      .set({
        absorbAttempts: 5,
        absorbStateUpdatedAt: new Date(Date.now() - 60 * 60 * 1000),
      })
      .where(eq(memoryEventsTable.id, ev.event.id));
    await ensureBridge();
    const captured = captureSubject(ABSORB_SUBJECT);
    const retried = await runAbsorbRetrySweep({
      maxAttempts: 5,
      baseBackoffMs: 1000,
    });
    assert.deepEqual(retried, []);
    assert.equal(captured.length, 0);
  });

  it("ignores rows with absorb_state != 'failed' (no double-publish on pending/absorbed)", async () => {
    const ev = await evaluateMemory({
      type: "agent_output",
      content: `${TEST_TAG_MARKER}: completion approved decision (state filter)`,
    });
    assert.ok(ev.event);
    // Drive it to pending via a normal absorb (NATS up).
    await requestAbsorb(ev.event.id);
    const captured = captureSubject(ABSORB_SUBJECT);
    const retried = await runAbsorbRetrySweep({
      maxAttempts: 5,
      baseBackoffMs: 1,
    });
    assert.deepEqual(retried, []);
    assert.equal(captured.length, 0, "pending rows must not be retried");
  });

  it("scheduler start is idempotent and stop releases the timer", () => {
    const stop1 = startAbsorbRetryScheduler({ intervalMs: 60_000 });
    const stop2 = startAbsorbRetryScheduler({ intervalMs: 60_000 });
    // Both calls return the same stop fn reference (the module-level stopper).
    assert.equal(stop1, stop2);
    stopAbsorbRetryScheduler();
    // Calling stop again is safe.
    stopAbsorbRetryScheduler();
  });
});
