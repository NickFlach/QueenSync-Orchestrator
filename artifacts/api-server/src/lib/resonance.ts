import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";
import {
  db,
  armsTable,
  resonanceFieldsTable,
  resonanceResponsesTable,
  type ResonanceField,
} from "@workspace/db";
import { recordLog } from "./log";
import { broadcast } from "./ws";
import { evaluateMemory } from "./memory-gate";

export interface ResonanceWithResponses extends ResonanceField {
  responses: (typeof resonanceResponsesTable.$inferSelect)[];
}

export async function loadResonance(id: string): Promise<ResonanceWithResponses | null> {
  const [field] = await db
    .select()
    .from(resonanceFieldsTable)
    .where(eq(resonanceFieldsTable.id, id));
  if (!field) return null;
  const responses = await db
    .select()
    .from(resonanceResponsesTable)
    .where(eq(resonanceResponsesTable.resonanceId, id));
  return { ...field, responses };
}

export async function listResonanceFields(activeOnly = false) {
  const fields = activeOnly
    ? await db
        .select()
        .from(resonanceFieldsTable)
        .where(eq(resonanceFieldsTable.status, "active"))
    : await db.select().from(resonanceFieldsTable);
  const withResponses = await Promise.all(
    fields.map(async (f) => {
      const responses = await db
        .select()
        .from(resonanceResponsesTable)
        .where(eq(resonanceResponsesTable.resonanceId, f.id));
      return { ...f, responses };
    }),
  );
  return withResponses.sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

export function computeArmScore(
  arm: typeof armsTable.$inferSelect,
  field: ResonanceField,
): number {
  const tagOverlap = arm.resonanceTags.filter((t) =>
    field.tags.includes(t),
  ).length;
  const totalTags = Math.max(1, field.tags.length);
  const tagComponent = (tagOverlap / totalTags) * 0.5;
  const priorityComponent = field.priority * 0.3;
  const availabilityComponent =
    (arm.status === "idle" ? 1 : arm.status === "busy" ? 0.4 : 0) * 0.2;
  return tagComponent + priorityComponent + availabilityComponent;
}

export async function autoLocalResonance(field: ResonanceField) {
  const arms = await db.select().from(armsTable);
  const candidates = arms.filter(
    (arm) =>
      arm.resonanceMode === "auto" &&
      arm.status !== "offline" &&
      (arm.type === "local_simulated" || arm.type === "kannaktopus_arm"),
  );
  for (const arm of candidates) {
    const score = computeArmScore(arm, field);
    if (score < 0.5 && score < arm.resonanceSensitivity) continue;
    const output = `${arm.name} resonates with "${field.intent}" via tags [${arm.resonanceTags.join(", ")}].`;
    const [response] = await db
      .insert(resonanceResponsesTable)
      .values({
        id: nanoid(12),
        resonanceId: field.id,
        agentId: arm.id,
        agentName: arm.name,
        score,
        output,
      })
      .returning();
    await recordLog({
      eventType: "resonance_response",
      source: arm.id,
      summary: `${arm.name} responded to ${field.id} (score ${score.toFixed(2)})`,
      metadata: { resonanceId: field.id, armId: arm.id, score },
    });
    broadcast({ kind: "resonance_response", data: response });
  }
}

export async function resolveField(
  id: string,
  strategy: "best" | "merge" = "best",
): Promise<ResonanceWithResponses | null> {
  const field = await loadResonance(id);
  if (!field) return null;
  if (field.responses.length === 0) {
    const [updated] = await db
      .update(resonanceFieldsTable)
      .set({ status: "expired" })
      .where(eq(resonanceFieldsTable.id, id))
      .returning();
    return { ...updated, responses: [] };
  }

  const sorted = [...field.responses].sort((a, b) => b.score - a.score);
  let mergedOutput: string | null = null;
  let selectedResponseId: string | null = null;
  let coherence = 0;

  if (strategy === "best") {
    selectedResponseId = sorted[0].id;
    mergedOutput = sorted[0].output;
    coherence = sorted[0].score;
  } else {
    mergedOutput = sorted
      .slice(0, 5)
      .map((r) => `[${r.agentName ?? r.agentId} | ${r.score.toFixed(2)}] ${r.output}`)
      .join("\n");
    const total = sorted.reduce((s, r) => s + r.score, 0);
    coherence = sorted.length ? total / sorted.length : 0;
  }

  const [updated] = await db
    .update(resonanceFieldsTable)
    .set({
      status: "resolved",
      selectedResponseId,
      mergedOutput,
      coherenceScore: coherence,
    })
    .where(eq(resonanceFieldsTable.id, id))
    .returning();

  await recordLog({
    eventType: "resonance_resolved",
    source: null,
    summary: `Resonance ${id} resolved via ${strategy} (coherence ${coherence.toFixed(2)})`,
    metadata: { resonanceId: id, strategy, coherence },
  });
  await evaluateMemory({
    type: "resonance_event",
    content: mergedOutput ?? "",
    sourceResonanceId: id,
    metadata: { strategy, coherence },
  });
  const responses = await db
    .select()
    .from(resonanceResponsesTable)
    .where(eq(resonanceResponsesTable.resonanceId, id));
  broadcast({ kind: "resonance", data: { ...updated, responses } });
  return { ...updated, responses };
}

export async function expireOldResonance() {
  const fields = await db
    .select()
    .from(resonanceFieldsTable)
    .where(eq(resonanceFieldsTable.status, "active"));
  const now = Date.now();
  for (const f of fields) {
    if (f.expiresAt && f.expiresAt.getTime() < now) {
      await resolveField(f.id, "best");
    }
  }
}
