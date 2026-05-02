import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const logsTable = pgTable("logs", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  source: text("source"),
  summary: text("summary").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type LogEntry = typeof logsTable.$inferSelect;
export type InsertLogEntry = typeof logsTable.$inferInsert;
