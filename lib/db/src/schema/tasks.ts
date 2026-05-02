import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

export const tasksTable = pgTable("tasks", {
  id: text("id").primaryKey(),
  intent: text("intent").notNull(),
  requiredCapability: text("required_capability").notNull(),
  priority: integer("priority").notNull().default(5),
  source: text("source").notNull().default("user"),
  context: jsonb("context").notNull().default({}),
  status: text("status").notNull().default("pending"),
  assignedArmId: text("assigned_arm_id"),
  result: text("result"),
  error: text("error"),
  retryCount: integer("retry_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Task = typeof tasksTable.$inferSelect;
export type InsertTask = typeof tasksTable.$inferInsert;
