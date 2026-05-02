import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { and, eq, gte } from "drizzle-orm";
import {
  db,
  memoryEventsTable,
  armsTable,
  type InsertMemoryEvent,
  type MemoryEvent,
} from "@workspace/db";
import { recordLog } from "./log";
import { broadcast } from "./ws";
import {
  publishAbsorb,
  type AbsorbAckPayload,
  deriveAbsorbIdempotencyKey,
} from "./memory-adapter";

export type MemoryDecision = "approved" | "rejected" | "duplicate" | "pending";

export type AbsorbState = "not_required" | "pending" | "absorbed" | "failed";

export interface EvaluationInput {
  type: string;
  content: string;
  agentId?: string | null;
  sourceTaskId?: string | null;
  sourceResonanceId?: string | null;
  metadata?: Record<string, unknown>;
  /**
   * Wave 4 — when set, the event is persisted with this decision instead of
   * the auto-evaluated one. Used by the NATS bridge to land inbound
   * exemplars as `pending` so an operator can re-absorb or reject them.
   */
  forcedDecision?: MemoryDecision;
  /** Wave 4 — mark this row as a HRM exemplar candidate. */
  inboundExemplar?: boolean;
}

export interface EvaluationResult {
  decision: MemoryDecision;
  importance: number;
  event: MemoryEvent | null;
}

const HIGH_VALUE_KEYWORDS = [
  "decision",
  "approved",
  "completed",
  "kannaktopus",
  "openclaw",
  "resonance",
  "dream",
  "anomaly",
  "critical",
  "build",
];

// Loose tag dictionary used to classify the body of a memory event. Intent is
// to give operators a useful at-a-glance signal in the UI without ML.
const TAG_DICTIONARY: Array<{ tag: string; needles: string[] }> = [
  { tag: "decision", needles: ["decision", "approved", "rejected"] },
  { tag: "completion", needles: ["completed", "finished", "done"] },
  { tag: "kannaktopus", needles: ["kannaktopus"] },
  { tag: "openclaw", needles: ["openclaw", "artifact", "forge"] },
  { tag: "resonance", needles: ["resonance", "chord"] },
  { tag: "dream", needles: ["dream", "compress", "compaction"] },
  { tag: "anomaly", needles: ["anomaly", "alert", "spike"] },
  { tag: "critical", needles: ["critical", "fatal", "panic"] },
  { tag: "build", needles: ["build", "deploy", "merge"] },
  { tag: "transmit", needles: ["transmit", "broadcast", "signal"] },
  { tag: "audit", needles: ["audit", "governance"] },
  { tag: "observe", needles: ["observe", "observation", "telemetry"] },
];

function hash(content: string) {
  return createHash("sha1").update(content.trim().toLowerCase()).digest("hex");
}

function deriveTag(input: EvaluationInput): string {
  const c = input.content.toLowerCase();
  for (const kw of HIGH_VALUE_KEYWORDS) {
    if (c.includes(kw)) return kw;
  }
  return input.type;
}

function deriveTags(input: EvaluationInput, primaryTag: string): string[] {
  const lower = input.content.toLowerCase();
  const tags = new Set<string>();
  tags.add(primaryTag);
  tags.add(input.type);
  for (const entry of TAG_DICTIONARY) {
    if (entry.needles.some((n) => lower.includes(n))) tags.add(entry.tag);
  }
  // Optional caller-supplied tags via metadata.tags
  const meta = input.metadata ?? {};
  const metaTags = (meta as Record<string, unknown>)["tags"];
  if (Array.isArray(metaTags)) {
    for (const t of metaTags) {
      if (typeof t === "string" && t.length > 0) tags.add(t);
    }
  }
  return Array.from(tags).slice(0, 12);
}

function deriveSummary(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, " ");
  if (trimmed.length <= 160) return trimmed;
  return trimmed.slice(0, 157) + "...";
}

async function deriveSourceAttribution(
  input: EvaluationInput,
): Promise<string> {
  const parts: string[] = [];
  if (input.agentId) {
    const [arm] = await db
      .select({ name: armsTable.name })
      .from(armsTable)
      .where(eq(armsTable.id, input.agentId))
      .limit(1);
    parts.push(arm ? `${arm.name} (${input.agentId})` : `agent:${input.agentId}`);
  }
  if (input.sourceTaskId) parts.push(`task:${input.sourceTaskId}`);
  if (input.sourceResonanceId)
    parts.push(`resonance:${input.sourceResonanceId}`);
  if (parts.length === 0) parts.push(`type:${input.type}`);
  return parts.join(" · ");
}

function scoreImportance(input: EvaluationInput): number {
  const len = Math.min(1, input.content.length / 600);
  const base = 0.25 + len * 0.25;
  const lower = input.content.toLowerCase();
  let bonus = 0;
  for (const kw of HIGH_VALUE_KEYWORDS) {
    if (lower.includes(kw)) bonus += 0.1;
  }
  if (input.type === "decision") bonus += 0.2;
  if (input.type === "resonance_event") bonus += 0.15;
  if (input.sourceResonanceId) bonus += 0.05;
  return Math.max(0, Math.min(1, base + bonus));
}

async function persistRejected(
  input: EvaluationInput,
  importance: number,
  decision: "rejected" | "duplicate",
  reason: string,
  extraMetadata: Record<string, unknown> = {},
): Promise<MemoryEvent> {
  const tag = deriveTag(input);
  const tags = deriveTags(input, tag);
  const summary = deriveSummary(input.content);
  const sourceAttribution = await deriveSourceAttribution(input);
  const insert: InsertMemoryEvent = {
    id: nanoid(12),
    type: input.type,
    tag,
    tags,
    content: input.content,
    summary,
    sourceAttribution,
    importance,
    decision,
    reason,
    compacted: false,
    agentId: input.agentId ?? null,
    sourceTaskId: input.sourceTaskId ?? null,
    sourceResonanceId: input.sourceResonanceId ?? null,
    contentHash: hash(input.content),
    metadata: { ...(input.metadata ?? {}), ...extraMetadata },
    absorbState: "not_required",
  };
  const [row] = await db
    .insert(memoryEventsTable)
    .values(insert)
    .returning();
  broadcast({ type: "memory_event", data: row });
  return row;
}

export async function evaluateMemory(
  input: EvaluationInput,
): Promise<EvaluationResult> {
  const importance = scoreImportance(input);
  const contentHash = hash(input.content);
  const tag = deriveTag(input);
  const tags = deriveTags(input, tag);
  const summary = deriveSummary(input.content);
  const sourceAttribution = await deriveSourceAttribution(input);
  const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 24);

  const [existing] = await db
    .select()
    .from(memoryEventsTable)
    .where(
      and(
        eq(memoryEventsTable.contentHash, contentHash),
        gte(memoryEventsTable.createdAt, cutoff),
      ),
    )
    .limit(1);

  if (existing) {
    const reason = `duplicate of ${existing.id} (within 24h)`;
    const audit = await persistRejected(input, importance, "duplicate", reason, {
      duplicateOfId: existing.id,
    });
    await recordLog({
      eventType: "memory_rejected",
      source: input.agentId ?? null,
      summary: `Duplicate memory suppressed (${tag})`,
      metadata: {
        contentHash,
        originalId: existing.id,
        auditId: audit.id,
        reason,
      },
    });
    return { decision: "duplicate", importance, event: audit };
  }

  let decision: MemoryDecision;
  if (input.forcedDecision) {
    decision = input.forcedDecision;
  } else {
    decision = importance >= 0.4 ? "approved" : "rejected";
  }

  if (decision === "rejected") {
    const reason = `importance ${importance.toFixed(2)} below threshold 0.40`;
    const audit = await persistRejected(input, importance, "rejected", reason);
    await recordLog({
      eventType: "memory_rejected",
      source: input.agentId ?? null,
      summary: `Memory rejected (importance ${importance.toFixed(2)})`,
      metadata: { tag, importance, reason, auditId: audit.id },
    });
    return { decision, importance, event: audit };
  }

  const insert: InsertMemoryEvent = {
    id: nanoid(12),
    type: input.type,
    tag,
    tags,
    content: input.content,
    summary,
    sourceAttribution,
    importance,
    decision,
    reason: null,
    compacted: false,
    agentId: input.agentId ?? null,
    sourceTaskId: input.sourceTaskId ?? null,
    sourceResonanceId: input.sourceResonanceId ?? null,
    contentHash,
    metadata: input.metadata ?? {},
    // Wave 4: Approved events default to local-only. The operator must
    // explicitly click "Absorb to HRM" — see requestAbsorb() below.
    absorbState: "not_required",
    inboundExemplar: input.inboundExemplar ?? false,
  };

  const [row] = await db
    .insert(memoryEventsTable)
    .values(insert)
    .returning();

  await recordLog({
    eventType: decision === "pending" ? "memory_pending" : "memory_approved",
    source: input.agentId ?? null,
    summary:
      decision === "pending"
        ? `Memory candidate awaiting decision (${tag})`
        : `Memory approved (${tag}, importance ${importance.toFixed(2)})`,
    metadata: {
      id: row.id,
      tag,
      tags,
      importance,
      inboundExemplar: input.inboundExemplar ?? false,
    },
  });
  broadcast({ type: "memory_event", data: row });

  return { decision, importance, event: row };
}

// ──────────────────────────────────────────────────────────────────────────
// Wave 4: operator actions
// ──────────────────────────────────────────────────────────────────────────

async function loadEvent(id: string): Promise<MemoryEvent | null> {
  const [row] = await db
    .select()
    .from(memoryEventsTable)
    .where(eq(memoryEventsTable.id, id))
    .limit(1);
  return row ?? null;
}

async function patchEvent(
  id: string,
  patch: Partial<typeof memoryEventsTable.$inferInsert>,
): Promise<MemoryEvent | null> {
  const [row] = await db
    .update(memoryEventsTable)
    .set(patch)
    .where(eq(memoryEventsTable.id, id))
    .returning();
  if (row) broadcast({ type: "memory_event", data: row });
  return row ?? null;
}

/**
 * Operator action: "Approve (local)" — explicitly accept an event but do
 * NOT publish to HRM. Reverts a pending/failed absorb back to not_required.
 * The decision is also bumped to "approved" so a previously-pending
 * exemplar candidate becomes a normal local memory.
 */
export async function markLocalApproved(id: string): Promise<MemoryEvent | null> {
  const existing = await loadEvent(id);
  if (!existing) return null;
  const patch: Partial<typeof memoryEventsTable.$inferInsert> = {
    absorbState: "not_required",
    absorbStateUpdatedAt: new Date(),
    lastAbsorbError: null,
  };
  if (existing.decision === "pending") {
    patch.decision = "approved";
  }
  const updated = await patchEvent(id, patch);
  if (updated) {
    await recordLog({
      eventType: "memory_local_approved",
      source: existing.agentId ?? null,
      summary: `Memory ${id} marked local-approved (no HRM absorb)`,
      metadata: { id, tag: existing.tag },
    });
  }
  return updated;
}

export interface AbsorbActionResult {
  event: MemoryEvent | null;
  publish: { delivered: boolean; message: string };
}

/**
 * Operator action: "Absorb to HRM" — publish the event on KANNAKA.absorb
 * and mark it pending. If publish fails (NATS down) the row is marked
 * `absorb_state="failed"` so the operator can retry.
 *
 * Lifecycle ordering (critical):
 *   1. Persist `idempotencyKey` + `absorb_state="pending"` + bump attempt
 *      counter BEFORE publishing. This means a fast HRM ack arriving
 *      before `publishAbsorb` returns can already correlate by
 *      `idempotencyKey` and flip the row to `absorbed`.
 *   2. Publish on KANNAKA.absorb.
 *   3. On publish failure, only flip pending → failed via a compare-and-
 *      set guarded on `absorb_state="pending"`, so we never overwrite a
 *      later `absorbed` ack.
 *
 * Exemplar `exemplarOutcome="strengthened"` is intentionally NOT set here
 * — it is an HRM outcome and is set in `recordAbsorbAck` only after a
 * successful absorb. This keeps the strengthened/pruned counters tied to
 * actual HRM round-trip outcomes, not to operator clicks.
 */
export async function requestAbsorb(id: string): Promise<AbsorbActionResult> {
  const existing = await loadEvent(id);
  if (!existing) return { event: null, publish: { delivered: false, message: "not found" } };
  // Refuse to absorb explicitly rejected events — they shouldn't leave the
  // local audit trail.
  if (existing.decision === "rejected") {
    return {
      event: existing,
      publish: { delivered: false, message: "rejected events cannot be absorbed" },
    };
  }
  // If a previous attempt is already absorbed, surface that without re-publishing.
  if (existing.absorbState === "absorbed") {
    return {
      event: existing,
      publish: { delivered: true, message: "already absorbed by HRM" },
    };
  }
  // Promote pending exemplars to approved so the absorb is semantically a
  // "re-absorb / strengthen". The strengthened outcome itself is recorded
  // by recordAbsorbAck on a successful HRM ack.
  const decisionPatch: Partial<typeof memoryEventsTable.$inferInsert> = {};
  if (existing.decision === "pending") {
    decisionPatch.decision = "approved";
  }
  const idempotencyKey = deriveAbsorbIdempotencyKey(existing);
  const attempts = (existing.absorbAttempts ?? 0) + 1;
  const now = new Date();

  // Step 1 — persist pending BEFORE publishing so a fast ack can correlate.
  await patchEvent(id, {
    ...decisionPatch,
    idempotencyKey,
    absorbAttempts: attempts,
    absorbState: "pending",
    absorbStateUpdatedAt: now,
    lastAbsorbError: null,
  });

  // Step 2 — publish on KANNAKA.absorb. Re-load the row so publishAbsorb
  // sees the persisted idempotencyKey (deriveAbsorbIdempotencyKey prefers
  // the column over the content hash if present).
  const published = (await loadEvent(id)) ?? existing;
  const result = await publishAbsorb(published);

  // Step 3 — on failure, compare-and-set pending → failed. Do not touch
  // the row if a faster ack already advanced it to absorbed/failed.
  let finalEvent: MemoryEvent | null = null;
  if (!result.delivered) {
    const [casRow] = await db
      .update(memoryEventsTable)
      .set({
        absorbState: "failed",
        absorbStateUpdatedAt: new Date(),
        lastAbsorbError: result.message,
      })
      .where(
        and(
          eq(memoryEventsTable.id, id),
          eq(memoryEventsTable.absorbState, "pending"),
        ),
      )
      .returning();
    if (casRow) {
      broadcast({ type: "memory_event", data: casRow });
      finalEvent = casRow;
    }
  }
  if (!finalEvent) finalEvent = await loadEvent(id);

  await recordLog({
    eventType: result.delivered ? "memory_absorb_published" : "memory_absorb_failed",
    source: existing.agentId ?? null,
    summary: result.delivered
      ? `Memory ${id} published to KANNAKA.absorb`
      : `Memory ${id} absorb publish failed: ${result.message}`,
    metadata: {
      id,
      idempotencyKey,
      attempts,
      delivered: result.delivered,
      finalAbsorbState: finalEvent?.absorbState ?? null,
    },
  });
  return {
    event: finalEvent,
    publish: { delivered: result.delivered, message: result.message },
  };
}

/**
 * Operator action on an inbound exemplar candidate.
 * - "strengthened" → re-absorb (publishes back on KANNAKA.absorb).
 * - "pruned"       → reject locally, no publish.
 */
export async function decideExemplar(
  id: string,
  outcome: "strengthened" | "pruned",
): Promise<AbsorbActionResult> {
  const existing = await loadEvent(id);
  if (!existing) return { event: null, publish: { delivered: false, message: "not found" } };
  if (!existing.inboundExemplar) {
    return {
      event: existing,
      publish: { delivered: false, message: "not an inbound exemplar" },
    };
  }
  if (outcome === "pruned") {
    const updated = await patchEvent(id, {
      decision: "rejected",
      reason: "exemplar pruned by operator",
      exemplarOutcome: "pruned",
      absorbState: "not_required",
      absorbStateUpdatedAt: new Date(),
    });
    await recordLog({
      eventType: "memory_exemplar_pruned",
      source: existing.agentId ?? null,
      summary: `Exemplar ${id} pruned by operator`,
      metadata: { id, tag: existing.tag },
    });
    return { event: updated, publish: { delivered: false, message: "pruned (no publish)" } };
  }
  // strengthened → goes through requestAbsorb so we share publish + retry semantics.
  return requestAbsorb(id);
}

/**
 * Receiver-side handler for KANNAKA.absorb.ack. Wired in nats-bridge.ts.
 * Returns the updated event for tests; null if no row matched.
 */
export async function recordAbsorbAck(
  ack: AbsorbAckPayload,
): Promise<MemoryEvent | null> {
  // Prefer memoryId when present (exact match), fall back to idempotencyKey.
  let target: MemoryEvent | null = null;
  if (ack.memoryId) {
    target = await loadEvent(ack.memoryId);
  }
  if (!target && ack.idempotencyKey) {
    const [row] = await db
      .select()
      .from(memoryEventsTable)
      .where(eq(memoryEventsTable.idempotencyKey, ack.idempotencyKey))
      .limit(1);
    if (row) target = row;
  }
  if (!target) return null;
  const now = new Date();
  const patch: Partial<typeof memoryEventsTable.$inferInsert> = {
    absorbStateUpdatedAt: now,
  };
  if (ack.status === "absorbed") {
    patch.absorbState = "absorbed";
    patch.absorbedAt = now;
    patch.lastAbsorbError = null;
    if (ack.hrmId) {
      const meta =
        (target.metadata as Record<string, unknown> | null) ?? {};
      patch.metadata = { ...meta, hrmId: ack.hrmId };
    }
    // Inbound HRM exemplar succeeded a re-absorb round-trip → record the
    // "strengthened" outcome here, NOT at operator-click time. This keeps
    // the strengthened/pruned counters tied to actual HRM outcomes.
    if (target.inboundExemplar && target.exemplarOutcome == null) {
      patch.exemplarOutcome = "strengthened";
    }
  } else {
    patch.absorbState = "failed";
    patch.lastAbsorbError = ack.reason ?? `HRM ${ack.status}`;
    // HRM nack on a re-absorb does NOT count as strengthened. Leave
    // exemplarOutcome null so the operator can retry or prune.
  }
  const updated = await patchEvent(target.id, patch);
  await recordLog({
    eventType:
      ack.status === "absorbed" ? "memory_absorbed" : "memory_absorb_nack",
    source: target.agentId ?? null,
    summary:
      ack.status === "absorbed"
        ? `Memory ${target.id} absorbed by HRM${ack.hrmId ? ` (hrm=${ack.hrmId})` : ""}`
        : `Memory ${target.id} HRM ${ack.status}: ${ack.reason ?? "no reason"}`,
    metadata: {
      id: target.id,
      idempotencyKey: target.idempotencyKey,
      hrmId: ack.hrmId,
      status: ack.status,
      reason: ack.reason,
    },
  });
  return updated;
}
