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
import { pushToKannakaMemory } from "./memory-adapter";

export type MemoryDecision = "approved" | "rejected" | "duplicate";

export interface EvaluationInput {
  type: string;
  content: string;
  agentId?: string | null;
  sourceTaskId?: string | null;
  sourceResonanceId?: string | null;
  metadata?: Record<string, unknown>;
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

  const decision: MemoryDecision = importance >= 0.4 ? "approved" : "rejected";

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
  };

  const [row] = await db
    .insert(memoryEventsTable)
    .values(insert)
    .returning();

  await recordLog({
    eventType: "memory_approved",
    source: input.agentId ?? null,
    summary: `Memory approved (${tag}, importance ${importance.toFixed(2)})`,
    metadata: { id: row.id, tag, tags, importance },
  });
  broadcast({ type: "memory_event", data: row });

  // Mirror to the kannaka-memory substrate (no-op stub today).
  await pushToKannakaMemory(row);

  return { decision, importance, event: row };
}
