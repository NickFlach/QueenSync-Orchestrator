import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { inArray } from "drizzle-orm";
import { db, memoryEventsTable } from "@workspace/db";
import app from "../../app";
import { evaluateMemory, recordAbsorbAck } from "../memory-gate";
import { ABSORB_SUBJECT } from "../memory-adapter";
import {
  startNatsBridge,
  stopNatsBridge,
  getNatsClient,
} from "../nats-bridge";
import {
  createInMemoryNatsClient,
  type NatsMessage,
} from "@workspace/nats";

const TEST_TAG_MARKER = "wave4-exemplar-decide-e2e";

interface ExemplarStats {
  strengthened: number;
  pruned: number;
  pending: number;
  total: number;
}

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

/**
 * End-to-end coverage for the inbound-exemplar decide flow that the
 * Memory page invokes when the operator clicks "Re-absorb" or
 * "Reject" on an HRM exemplar candidate. Drives the real Express
 * route (`POST /api/memory/:id/exemplar/decide`) over HTTP and
 * verifies both the publish-side wiring (KANNAKA.absorb) and the
 * counter wiring (`GET /api/memory/exemplars/stats`) the UI polls.
 */
describe("exemplar decide flow (HTTP + counters + publish)", () => {
  let server: http.Server;
  let baseUrl: string;
  let captured: NatsMessage[];

  before(async () => {
    await cleanup();
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await stopNatsBridge();
    await cleanup();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  beforeEach(async () => {
    await cleanup();
    await stopNatsBridge();
    const client = createInMemoryNatsClient();
    await startNatsBridge({ client, url: null });
    const live = getNatsClient();
    assert.ok(live, "nats client must be started");
    captured = [];
    live.subscribe(ABSORB_SUBJECT, (msg) => {
      captured.push(msg);
    });
  });

  // requireOperator accepts QUEENSYNC_OPERATOR_TOKEN, with
  // QUEENSYNC_ADMIN_TOKEN as a documented fallback when the operator
  // token is not configured separately. Mirror that resolution order
  // so the test passes in any environment that configures auth at all
  // — and gracefully omit the header for fully-open dev configs.
  const operatorToken =
    process.env["QUEENSYNC_OPERATOR_TOKEN"] ??
    process.env["QUEENSYNC_ADMIN_TOKEN"] ??
    "";
  const authHeaders: Record<string, string> = operatorToken
    ? { authorization: `Bearer ${operatorToken}` }
    : {};

  async function getStats(): Promise<ExemplarStats> {
    const res = await fetch(`${baseUrl}/api/memory/exemplars/stats`);
    assert.equal(res.status, 200);
    return (await res.json()) as ExemplarStats;
  }

  async function seedExemplar(label: string): Promise<string> {
    const r = await evaluateMemory({
      type: "signal",
      content: `${TEST_TAG_MARKER}: ${label}`,
      forcedDecision: "pending",
      inboundExemplar: true,
    });
    assert.ok(r.event, "seeded exemplar must persist");
    assert.equal(r.event.inboundExemplar, true);
    assert.equal(r.event.decision, "pending");
    assert.equal(r.event.exemplarOutcome, null);
    return r.event.id;
  }

  it("Re-absorb publishes on KANNAKA.absorb and HRM ack increments strengthened counter", async () => {
    const baseline = await getStats();
    const id = await seedExemplar("strengthen exemplar via UI button");

    // Pending counter should have ticked up by 1.
    const afterSeed = await getStats();
    assert.equal(afterSeed.pending, baseline.pending + 1);
    assert.equal(afterSeed.strengthened, baseline.strengthened);

    // Operator clicks "Re-absorb (strengthen)" — frontend issues:
    //   POST /api/memory/:id/exemplar/decide  { outcome: "strengthened" }
    const decideRes = await fetch(
      `${baseUrl}/api/memory/${id}/exemplar/decide`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders },
        body: JSON.stringify({ outcome: "strengthened" }),
      },
    );
    assert.equal(decideRes.status, 200);
    const decideBody = (await decideRes.json()) as {
      event: {
        id: string;
        decision: string;
        absorbState: string;
        exemplarOutcome: string | null;
        idempotencyKey: string | null;
      };
      publish: { delivered: boolean };
    };
    assert.equal(decideBody.event.id, id);
    assert.equal(decideBody.event.decision, "approved");
    assert.equal(decideBody.event.absorbState, "pending");
    assert.equal(
      decideBody.event.exemplarOutcome,
      null,
      "strengthened outcome must wait for HRM ack — never set at publish time",
    );
    assert.equal(decideBody.publish.delivered, true);

    // Exactly one publish on KANNAKA.absorb correlated to this memory id.
    assert.equal(captured.length, 1, "strengthen must publish exactly once");
    assert.equal(captured[0].subject, ABSORB_SUBJECT);
    const payload = captured[0].data as Record<string, unknown>;
    assert.equal(payload["memoryId"], id);
    assert.equal(payload["idempotencyKey"], decideBody.event.idempotencyKey);

    // Counters before HRM ack: still pending (strengthened only counts
    // after HRM acknowledges absorption).
    const beforeAck = await getStats();
    assert.equal(beforeAck.strengthened, baseline.strengthened);
    assert.equal(beforeAck.pending, baseline.pending + 1);

    // Simulate kannaka-memory acking on KANNAKA.absorb.ack.
    const acked = await recordAbsorbAck({
      memoryId: id,
      idempotencyKey: decideBody.event.idempotencyKey ?? undefined,
      status: "absorbed",
      hrmId: "hrm-e2e-strengthen",
    });
    assert.ok(acked);
    assert.equal(acked.absorbState, "absorbed");
    assert.equal(acked.exemplarOutcome, "strengthened");

    // Counter wiring: strengthened increments by 1, pending drops by 1.
    const afterAck = await getStats();
    assert.equal(afterAck.strengthened, baseline.strengthened + 1);
    assert.equal(afterAck.pending, baseline.pending);
    assert.equal(afterAck.pruned, baseline.pruned);
  });

  it("Reject prunes locally, increments pruned counter, and never publishes", async () => {
    const baseline = await getStats();
    const id = await seedExemplar("prune exemplar via UI button");

    // Operator clicks "Reject (prune)" — frontend issues:
    //   POST /api/memory/:id/exemplar/decide  { outcome: "pruned" }
    const decideRes = await fetch(
      `${baseUrl}/api/memory/${id}/exemplar/decide`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders },
        body: JSON.stringify({ outcome: "pruned" }),
      },
    );
    assert.equal(decideRes.status, 200);
    const decideBody = (await decideRes.json()) as {
      event: {
        id: string;
        decision: string;
        exemplarOutcome: string | null;
      };
      publish: { delivered: boolean };
    };
    assert.equal(decideBody.event.id, id);
    assert.equal(decideBody.event.decision, "rejected");
    assert.equal(decideBody.event.exemplarOutcome, "pruned");
    assert.equal(decideBody.publish.delivered, false);

    // Pruning must NOT publish on KANNAKA.absorb.
    assert.equal(captured.length, 0, "prune must not publish on absorb");

    // Counter wiring: pruned increments by 1, strengthened unchanged,
    // pending returns to baseline (the seed left it at +1, the prune
    // moved it into the pruned bucket).
    const afterDecide = await getStats();
    assert.equal(afterDecide.pruned, baseline.pruned + 1);
    assert.equal(afterDecide.strengthened, baseline.strengthened);
    assert.equal(afterDecide.pending, baseline.pending);
  });

  it("404s when deciding on a missing memory event", async () => {
    const res = await fetch(
      `${baseUrl}/api/memory/does-not-exist/exemplar/decide`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders },
        body: JSON.stringify({ outcome: "pruned" }),
      },
    );
    assert.equal(res.status, 404);
    assert.equal(captured.length, 0);
  });
});
