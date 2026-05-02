import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { and, eq, gte } from "drizzle-orm";
import {
  db,
  memoryEventsTable,
  type InsertMemoryEvent,
} from "@workspace/db";
import { recordLog } from "./log";
import { broadcast } from "./ws";

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
  event: typeof memoryEventsTable.$inferSelect | null;
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

export async function evaluateMemory(
  input: EvaluationInput,
): Promise<EvaluationResult> {
  const importance = scoreImportance(input);
  const contentHash = hash(input.content);
  const tag = deriveTag(input);
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
    await recordLog({
      eventType: "memory_rejected",
      source: input.agentId ?? null,
      summary: `Duplicate memory suppressed (${tag})`,
      metadata: { contentHash, originalId: existing.id },
    });
    return { decision: "duplicate", importance, event: null };
  }

  const decision: MemoryDecision = importance >= 0.4 ? "approved" : "rejected";

  if (decision === "rejected") {
    await recordLog({
      eventType: "memory_rejected",
      source: input.agentId ?? null,
      summary: `Memory rejected (importance ${importance.toFixed(2)})`,
      metadata: { tag, importance },
    });
    return { decision, importance, event: null };
  }

  const insert: InsertMemoryEvent = {
    id: nanoid(12),
    type: input.type,
    tag,
    content: input.content,
    importance,
    decision,
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
    metadata: { id: row.id, tag, importance },
  });
  broadcast({ kind: "memory", data: row });

  return { decision, importance, event: row };
}
