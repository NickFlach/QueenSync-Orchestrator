import { nanoid } from "nanoid";
import { and, desc, eq, gte, inArray, ne } from "drizzle-orm";
import {
  db,
  memoryEventsTable,
  type InsertMemoryEvent,
  type MemoryEvent,
} from "@workspace/db";
import { recordLog } from "./log";
import { broadcast } from "./ws";

export interface DreamLiteCompressionResult {
  compactedCount: number;
  windowMinutes: number;
  message: string;
  compressionEvent: MemoryEvent | null;
  compactedIds: string[];
}

const TOP_TAGS = 6;

function buildSummary(rows: MemoryEvent[]): string {
  const tagCounts = new Map<string, number>();
  for (const r of rows) {
    for (const t of r.tags ?? []) {
      tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    }
    if ((!r.tags || r.tags.length === 0) && r.tag) {
      tagCounts.set(r.tag, (tagCounts.get(r.tag) ?? 0) + 1);
    }
  }
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_TAGS)
    .map(([t, n]) => `${t}×${n}`);
  const sources = new Set<string>();
  for (const r of rows) {
    if (r.agentId) sources.add(r.agentId);
  }
  const sample = rows
    .slice(0, 3)
    .map((r) => `• ${r.summary || r.content.slice(0, 80)}`)
    .join("\n");
  const sourceStr = sources.size > 0 ? ` from ${[...sources].join(", ")}` : "";
  return [
    `Dream Lite compressed ${rows.length} memories${sourceStr}.`,
    `Top tags: ${topTags.join(", ") || "(none)"}.`,
    sample,
  ]
    .filter(Boolean)
    .join("\n");
}

function aggregateTags(rows: MemoryEvent[]): string[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const t of r.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    if (r.tag) counts.set(r.tag, (counts.get(r.tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([t]) => t);
}

export async function runDreamLiteCompression(options: {
  windowMinutes?: number;
  trigger?: string;
  /**
   * Wave 4 — when the compaction is the local fallback for a dispatched
   * Dream Lite task, thread the dispatched task id through every log /
   * memory event so the UI's live progress panel (filtered by
   * `metadata.taskId`) can render the fallback's progress.
   */
  taskId?: string;
}): Promise<DreamLiteCompressionResult> {
  const windowMinutes = Math.max(
    1,
    Math.min(60 * 24, Math.floor(options.windowMinutes ?? 60)),
  );
  const cutoff = new Date(Date.now() - windowMinutes * 60_000);

  const rows = await db
    .select()
    .from(memoryEventsTable)
    .where(
      and(
        eq(memoryEventsTable.decision, "approved"),
        eq(memoryEventsTable.compacted, false),
        ne(memoryEventsTable.type, "dream_lite_compression"),
        gte(memoryEventsTable.createdAt, cutoff),
      ),
    )
    .orderBy(desc(memoryEventsTable.createdAt))
    .limit(100);

  if (rows.length === 0) {
    const message = `Dream Lite found no approved memories in the last ${windowMinutes}m to compress.`;
    await recordLog({
      eventType: "dream_lite",
      source: "memory_keeper",
      summary: message,
      metadata: {
        windowMinutes,
        compactedCount: 0,
        trigger: options.trigger ?? "unknown",
        taskId: options.taskId ?? null,
      },
    });
    return {
      compactedCount: 0,
      windowMinutes,
      message,
      compressionEvent: null,
      compactedIds: [],
    };
  }

  const summary = buildSummary(rows);
  const tags = aggregateTags(rows);
  const importance = Math.min(1, 0.55 + Math.log10(1 + rows.length) * 0.15);
  const ids = rows.map((r) => r.id);
  const sources = [...new Set(rows.map((r) => r.agentId).filter(Boolean))];
  const sourceAttribution = `dream_lite · ${rows.length} memories${
    sources.length > 0 ? ` · ${sources.join(", ")}` : ""
  }`;

  const insert: InsertMemoryEvent = {
    id: nanoid(12),
    type: "dream_lite_compression",
    tag: "dream_lite",
    tags,
    content: summary,
    summary: `Dream Lite compression of ${rows.length} memories (window ${windowMinutes}m).`,
    sourceAttribution,
    importance,
    decision: "approved",
    reason: null,
    compacted: false,
    agentId: "memory_keeper",
    sourceTaskId: null,
    sourceResonanceId: null,
    contentHash: `dream_lite:${ids.sort().join(",")}`,
    metadata: {
      kind: "dream_lite_compression",
      windowMinutes,
      compactedIds: ids,
      tagsAggregated: tags,
      trigger: options.trigger ?? "unknown",
      taskId: options.taskId ?? null,
    },
  };

  const [compressionRow] = await db
    .insert(memoryEventsTable)
    .values(insert)
    .returning();

  await db
    .update(memoryEventsTable)
    .set({ compacted: true, compactedIntoId: compressionRow.id })
    .where(inArray(memoryEventsTable.id, ids));

  broadcast({ type: "memory_event", data: compressionRow });
  for (const id of ids) {
    broadcast({
      type: "memory_compacted",
      data: { id, compactedIntoId: compressionRow.id },
    });
  }

  await recordLog({
    eventType: "dream_lite",
    source: "memory_keeper",
    summary: `Dream Lite compressed ${rows.length} memories into ${compressionRow.id}`,
    metadata: {
      windowMinutes,
      compactedCount: rows.length,
      compressionId: compressionRow.id,
      compactedIds: ids,
      trigger: options.trigger ?? "unknown",
      taskId: options.taskId ?? null,
    },
  });

  // Wave 4: dream-lite compression rows are local-only by default.
  // Operators can escalate them to HRM with the per-row "Absorb to HRM"
  // action on the Memory Gate page.

  return {
    compactedCount: rows.length,
    windowMinutes,
    message: `Dream Lite compressed ${rows.length} memories from the last ${windowMinutes}m.`,
    compressionEvent: compressionRow,
    compactedIds: ids,
  };
}
