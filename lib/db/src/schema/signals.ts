import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const signalsTable = pgTable("signals", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  source: text("source"),
  payload: jsonb("payload").notNull().default({}),
  status: text("status").notNull().default("received"),
  derivedTaskId: text("derived_task_id"),
  derivedResonanceId: text("derived_resonance_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Signal = typeof signalsTable.$inferSelect;
export type InsertSignal = typeof signalsTable.$inferInsert;
