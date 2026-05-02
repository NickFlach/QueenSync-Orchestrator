import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";

export const memoryEventsTable = pgTable("memory_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  tag: text("tag").notNull(),
  tags: text("tags").array().notNull().default([]),
  content: text("content").notNull(),
  summary: text("summary").notNull().default(""),
  sourceAttribution: text("source_attribution").notNull().default(""),
  importance: doublePrecision("importance").notNull().default(0),
  decision: text("decision").notNull().default("approved"),
  reason: text("reason"),
  compacted: boolean("compacted").notNull().default(false),
  compactedIntoId: text("compacted_into_id"),
  agentId: text("agent_id"),
  sourceTaskId: text("source_task_id"),
  sourceResonanceId: text("source_resonance_id"),
  contentHash: text("content_hash").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type MemoryEvent = typeof memoryEventsTable.$inferSelect;
export type InsertMemoryEvent = typeof memoryEventsTable.$inferInsert;
