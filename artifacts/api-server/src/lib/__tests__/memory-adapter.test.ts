import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { db, memoryEventsTable, type MemoryEvent } from "@workspace/db";
import {
  publishAbsorb,
  deriveAbsorbIdempotencyKey,
  ABSORB_SUBJECT,
  ABSORB_ACK_SUBJECT,
} from "../memory-adapter";
import {
  evaluateMemory,
  markLocalApproved,
  requestAbsorb,
  decideExemplar,
  recordAbsorbAck,
} from "../memory-gate";
import {
  startNatsBridge,
  stopNatsBridge,
  getNatsClient,
} from "../nats-bridge";
import {
  createInMemoryNatsClient,
  type NatsMessage,
} from "@workspace/nats";

const TEST_TAG_MARKER = "wave4-adapter-test";

async function cleanup(): Promise<void> {
  // Best-effort: remove rows whose summary marks them as ours.
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

describe("memory-adapter / memory-gate Wave 4 absorb bridge", () => {
  before(async () => {
    await cleanup();
  });
  after(async () => {
    await stopNatsBridge();
    await cleanup();
  });
  beforeEach(async () => {
    await cleanup();
    // Fresh in-memory bridge per test so each test starts in a known
    // "connected" state, regardless of whether a previous test stopped it.
    await stopNatsBridge();
    const client = createInMemoryNatsClient();
    await startNatsBridge({ client, url: null });
  });

  function captureSubject(subject: string): NatsMessage[] {
    const captured: NatsMessage[] = [];
    const client = getNatsClient();
    assert.ok(client, "nats client must be started");
    client.subscribe(subject, (msg) => {
      captured.push(msg);
    });
    return captured;
  }

  it("evaluateMemory persists approved events with absorb_state='not_required'", async () => {
    const result = await evaluateMemory({
      type: "agent_output",
      content: `${TEST_TAG_MARKER}: critical decision approved by operator on the radio`,
    });
    assert.equal(result.decision, "approved");
    assert.ok(result.event);
    assert.equal(result.event.absorbState, "not_required");
    assert.equal(result.event.inboundExemplar, false);
  });

  it("publishAbsorb publishes on KANNAKA.absorb with idempotency key", async () => {
    const captured = captureSubject(ABSORB_SUBJECT);
    const ev = await evaluateMemory({
      type: "agent_output",
      content: `${TEST_TAG_MARKER}: build approved by operator decision`,
    });
    assert.ok(ev.event);
    const result = await publishAbsorb(ev.event);
    assert.equal(result.delivered, true);
    assert.equal(result.attempted, true);
    assert.ok(result.idempotencyKey);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].subject, ABSORB_SUBJECT);
    const payload = captured[0].data as Record<string, unknown>;
    assert.equal(payload["memoryId"], ev.event.id);
    assert.equal(payload["idempotencyKey"], result.idempotencyKey);
    assert.equal(
      result.idempotencyKey,
      deriveAbsorbIdempotencyKey(ev.event),
    );
  });

  it("requestAbsorb sets pending → absorbed via ack handler", async () => {
    const captured = captureSubject(ABSORB_SUBJECT);
    const ev = await evaluateMemory({
      type: "agent_output",
      content: `${TEST_TAG_MARKER}: completion of resonance build pipeline approved`,
    });
    assert.ok(ev.event);
    const requestResult = await requestAbsorb(ev.event.id);
    assert.equal(requestResult.publish.delivered, true);
    assert.ok(requestResult.event);
    assert.equal(requestResult.event.absorbState, "pending");
    assert.equal(requestResult.event.absorbAttempts, 1);
    assert.ok(requestResult.event.idempotencyKey);
    assert.equal(captured.length, 1);

    // Simulate the HRM acking on KANNAKA.absorb.ack.
    const acked = await recordAbsorbAck({
      memoryId: ev.event.id,
      idempotencyKey: requestResult.event.idempotencyKey ?? undefined,
      status: "absorbed",
      hrmId: "hrm-fake-1",
    });
    assert.ok(acked);
    assert.equal(acked.absorbState, "absorbed");
    assert.ok(acked.absorbedAt);
    const meta = (acked.metadata as Record<string, unknown>) ?? {};
    assert.equal(meta["hrmId"], "hrm-fake-1");
  });

  it("recordAbsorbAck with status=rejected marks failed with reason", async () => {
    const ev = await evaluateMemory({
      type: "agent_output",
      content: `${TEST_TAG_MARKER}: anomaly observed in critical resonance`,
    });
    assert.ok(ev.event);
    await requestAbsorb(ev.event.id);
    const acked = await recordAbsorbAck({
      memoryId: ev.event.id,
      status: "rejected",
      reason: "below novelty threshold",
    });
    assert.ok(acked);
    assert.equal(acked.absorbState, "failed");
    assert.equal(acked.lastAbsorbError, "below novelty threshold");
  });

  it("markLocalApproved reverts a pending absorb back to not_required", async () => {
    const ev = await evaluateMemory({
      type: "agent_output",
      content: `${TEST_TAG_MARKER}: dream completion approved`,
    });
    assert.ok(ev.event);
    await requestAbsorb(ev.event.id);
    const updated = await markLocalApproved(ev.event.id);
    assert.ok(updated);
    assert.equal(updated.absorbState, "not_required");
    assert.equal(updated.lastAbsorbError, null);
  });

  it("inbound exemplars: decideExemplar prune marks rejected, no publish", async () => {
    const captured = captureSubject(ABSORB_SUBJECT);
    const ev = await evaluateMemory({
      type: "signal",
      content: `${TEST_TAG_MARKER}: hrm exemplar candidate from cluster 9`,
      forcedDecision: "pending",
      inboundExemplar: true,
    });
    assert.ok(ev.event);
    assert.equal(ev.event.decision, "pending");
    assert.equal(ev.event.inboundExemplar, true);
    const decided = await decideExemplar(ev.event.id, "pruned");
    assert.ok(decided.event);
    assert.equal(decided.event.decision, "rejected");
    assert.equal(decided.event.exemplarOutcome, "pruned");
    assert.equal(decided.publish.delivered, false);
    assert.equal(captured.length, 0, "pruning must not publish on absorb");
  });

  it("inbound exemplars: decideExemplar strengthen publishes pending; outcome is set ONLY after HRM ack", async () => {
    const captured = captureSubject(ABSORB_SUBJECT);
    const ev = await evaluateMemory({
      type: "signal",
      content: `${TEST_TAG_MARKER}: hrm exemplar to be strengthened`,
      forcedDecision: "pending",
      inboundExemplar: true,
    });
    assert.ok(ev.event);
    const decided = await decideExemplar(ev.event.id, "strengthened");
    assert.ok(decided.event);
    assert.equal(decided.event.decision, "approved");
    assert.equal(
      decided.event.exemplarOutcome,
      null,
      "strengthened must NOT be recorded at publish time — it is an HRM outcome",
    );
    assert.equal(decided.event.absorbState, "pending");
    assert.equal(captured.length, 1);

    // HRM acks success → now we record strengthened.
    const acked = await recordAbsorbAck({
      memoryId: ev.event.id,
      idempotencyKey: decided.event.idempotencyKey ?? undefined,
      status: "absorbed",
      hrmId: "hrm-strengthen-ok",
    });
    assert.ok(acked);
    assert.equal(acked.absorbState, "absorbed");
    assert.equal(acked.exemplarOutcome, "strengthened");
  });

  it("inbound exemplars: HRM nack on strengthen leaves outcome null + state failed", async () => {
    const ev = await evaluateMemory({
      type: "signal",
      content: `${TEST_TAG_MARKER}: hrm exemplar to be nacked`,
      forcedDecision: "pending",
      inboundExemplar: true,
    });
    assert.ok(ev.event);
    const decided = await decideExemplar(ev.event.id, "strengthened");
    assert.ok(decided.event);
    assert.equal(decided.event.exemplarOutcome, null);

    const acked = await recordAbsorbAck({
      memoryId: ev.event.id,
      idempotencyKey: decided.event.idempotencyKey ?? undefined,
      status: "rejected",
      reason: "novelty too low",
    });
    assert.ok(acked);
    assert.equal(acked.absorbState, "failed");
    assert.equal(
      acked.exemplarOutcome,
      null,
      "HRM nack must NOT count as strengthened",
    );
    assert.equal(acked.lastAbsorbError, "novelty too low");
  });

  it("inbound exemplars: publish failure (NATS down) on strengthen leaves outcome null + state failed", async () => {
    // Stop the bridge so publishAbsorb sees no client.
    await stopNatsBridge();
    try {
      const ev = await evaluateMemory({
        type: "signal",
        content: `${TEST_TAG_MARKER}: hrm exemplar publish-fail path`,
        forcedDecision: "pending",
        inboundExemplar: true,
      });
      assert.ok(ev.event);
      const decided = await decideExemplar(ev.event.id, "strengthened");
      assert.ok(decided.event);
      assert.equal(decided.publish.delivered, false);
      assert.equal(decided.event.absorbState, "failed");
      assert.ok(decided.event.lastAbsorbError);
      assert.equal(
        decided.event.exemplarOutcome,
        null,
        "failed publish must NOT count as strengthened",
      );
      // Operator can still retry (state remains a candidate, not a final outcome).
      assert.equal(decided.event.decision, "approved");
    } finally {
      // Restore the in-memory bridge for subsequent tests.
      const client = createInMemoryNatsClient();
      await startNatsBridge({ client, url: null });
    }
  });

  it("requestAbsorb persists idempotencyKey + attempts BEFORE publish (visible even on publish failure)", async () => {
    // Stop NATS so publishAbsorb returns delivered=false. The persist-
    // before-publish step must still have written idempotencyKey + bumped
    // attempts; only then does the CAS pending → failed flip the state.
    await stopNatsBridge();
    try {
      const ev = await evaluateMemory({
        type: "agent_output",
        content: `${TEST_TAG_MARKER}: critical decision approved - persist-before-publish guarantee`,
      });
      assert.ok(ev.event);
      assert.equal(ev.event.idempotencyKey, null);
      const result = await requestAbsorb(ev.event.id);
      assert.equal(result.publish.delivered, false);
      assert.ok(result.event);
      assert.ok(
        result.event.idempotencyKey,
        "idempotencyKey must be persisted before publish so a fast ack can correlate",
      );
      assert.equal(result.event.absorbAttempts, 1);
      // CAS pending → failed should have flipped the visible state.
      assert.equal(result.event.absorbState, "failed");
      assert.ok(result.event.lastAbsorbError);
    } finally {
      const client = createInMemoryNatsClient();
      await startNatsBridge({ client, url: null });
    }
  });

  it("requestAbsorb CAS guard: an absorbed ack survives a subsequent publish-failure attempt (no overwrite)", async () => {
    // Round 1 — happy path: publish + ack absorbed.
    const ev = await evaluateMemory({
      type: "agent_output",
      content: `${TEST_TAG_MARKER}: critical decision approved - cas-guard absorbed wins over later failed publish`,
    });
    assert.ok(ev.event);
    const round1 = await requestAbsorb(ev.event.id);
    assert.equal(round1.publish.delivered, true);
    const acked = await recordAbsorbAck({
      memoryId: ev.event.id,
      idempotencyKey: round1.event?.idempotencyKey ?? undefined,
      status: "absorbed",
      hrmId: "hrm-cas-1",
    });
    assert.ok(acked);
    assert.equal(acked.absorbState, "absorbed");

    // Round 2 — operator double-clicks Absorb after NATS dropped. Even
    // though publish would now fail, requestAbsorb early-exits on
    // existing.absorbState === "absorbed" and the CAS branch is gated on
    // `absorbState = pending`, so neither path can stomp the absorbed row.
    await stopNatsBridge();
    try {
      const round2 = await requestAbsorb(ev.event.id);
      assert.equal(
        round2.publish.delivered,
        true,
        "early-exit reports the existing absorbed status as delivered",
      );
      assert.ok(round2.event);
      assert.equal(round2.event.absorbState, "absorbed");
      assert.ok(round2.event.absorbedAt);
    } finally {
      const client = createInMemoryNatsClient();
      await startNatsBridge({ client, url: null });
    }

    // Direct CAS sanity check — even if the post-publish CAS were to fire
    // by mistake on an already-absorbed row, the WHERE clause keyed on
    // absorbState='pending' must NOT match, so nothing changes.
    const [stomp] = await db
      .update(memoryEventsTable)
      .set({
        absorbState: "failed",
        absorbStateUpdatedAt: new Date(),
        lastAbsorbError: "simulated stale stomp",
      })
      .where(
        and(
          eq(memoryEventsTable.id, ev.event.id),
          eq(memoryEventsTable.absorbState, "pending"),
        ),
      )
      .returning();
    assert.equal(
      stomp,
      undefined,
      "CAS guard must not match an already-absorbed row",
    );
    const [finalRow] = await db
      .select()
      .from(memoryEventsTable)
      .where(eq(memoryEventsTable.id, ev.event.id))
      .limit(1);
    assert.equal(finalRow.absorbState, "absorbed");
  });

  it("ABSORB_SUBJECT and ACK subjects match the kannaka-memory contract", () => {
    assert.equal(ABSORB_SUBJECT, "KANNAKA.absorb");
    assert.equal(ABSORB_ACK_SUBJECT, "KANNAKA.absorb.ack");
  });
});

// Compile-time guard: keep MemoryEvent shape in scope so tsc fails fast if
// the Wave 4 columns ever regress.
const _typeGuard: Pick<
  MemoryEvent,
  "absorbState" | "inboundExemplar" | "exemplarOutcome" | "idempotencyKey"
> = {
  absorbState: "not_required",
  inboundExemplar: false,
  exemplarOutcome: null,
  idempotencyKey: null,
};
void _typeGuard;
