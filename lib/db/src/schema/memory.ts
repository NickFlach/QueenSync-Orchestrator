import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  jsonb,
  boolean,
  integer,
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
  // ── Wave 4: HRM absorb bridge ──────────────────────────────────────────
  // absorb_state values:
  //   "not_required" — local-only approval; never sent to HRM
  //   "pending"      — published on KANNAKA.absorb, awaiting ack
  //   "absorbed"     — HRM acked via KANNAKA.absorb.ack
  //   "failed"       — publish errored OR HRM nacked; operator can retry
  absorbState: text("absorb_state").notNull().default("not_required"),
  absorbStateUpdatedAt: timestamp("absorb_state_updated_at", {
    withTimezone: true,
  }),
  absorbAttempts: integer("absorb_attempts").notNull().default(0),
  absorbedAt: timestamp("absorbed_at", { withTimezone: true }),
  lastAbsorbError: text("last_absorb_error"),
  // The idempotency key sent on KANNAKA.absorb. Today this is the same as
  // contentHash (the existing 24h dedupe hash) but kept as a separate column
  // so the bridge can evolve the key derivation without disturbing the
  // local dedupe semantics.
  idempotencyKey: text("idempotency_key"),
  // Inbound exemplars that arrive on KANNAKA.exemplars are persisted as
  // candidate events with `inboundExemplar=true` — an operator decides
  // whether to "Re-absorb" (strengthen) or "Reject" (prune).
  inboundExemplar: boolean("inbound_exemplar").notNull().default(false),
  exemplarOutcome: text("exemplar_outcome"), // "strengthened" | "pruned" | null
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type MemoryEvent = typeof memoryEventsTable.$inferSelect;
export type InsertMemoryEvent = typeof memoryEventsTable.$inferInsert;
