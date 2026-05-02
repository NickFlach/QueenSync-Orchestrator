import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  jsonb,
} from "drizzle-orm/pg-core";

export const resonanceFieldsTable = pgTable("resonance_fields", {
  id: text("id").primaryKey(),
  intent: text("intent").notNull(),
  tags: text("tags").array().notNull().default([]),
  priority: doublePrecision("priority").notNull().default(0.5),
  constraints: jsonb("constraints").notNull().default({}),
  status: text("status").notNull().default("active"),
  selectedResponseId: text("selected_response_id"),
  mergedOutput: text("merged_output"),
  coherenceScore: doublePrecision("coherence_score"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export const resonanceResponsesTable = pgTable("resonance_responses", {
  id: text("id").primaryKey(),
  resonanceId: text("resonance_id").notNull(),
  agentId: text("agent_id").notNull(),
  agentName: text("agent_name"),
  score: doublePrecision("score").notNull().default(0),
  output: text("output").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ResonanceField = typeof resonanceFieldsTable.$inferSelect;
export type InsertResonanceField = typeof resonanceFieldsTable.$inferInsert;
export type ResonanceResponse = typeof resonanceResponsesTable.$inferSelect;
export type InsertResonanceResponse =
  typeof resonanceResponsesTable.$inferInsert;
