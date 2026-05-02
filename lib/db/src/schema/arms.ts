import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
} from "drizzle-orm/pg-core";

export const armsTable = pgTable("arms", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull().default("pending"),
  capabilities: text("capabilities").array().notNull().default([]),
  endpointUrl: text("endpoint_url"),
  heartbeatUrl: text("heartbeat_url"),
  authMethod: text("auth_method").notNull().default("none"),
  description: text("description"),
  resonanceTags: text("resonance_tags").array().notNull().default([]),
  resonanceSensitivity: doublePrecision("resonance_sensitivity")
    .notNull()
    .default(0.5),
  resonanceMode: text("resonance_mode").notNull().default("auto"),
  lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Arm = typeof armsTable.$inferSelect;
export type InsertArm = typeof armsTable.$inferInsert;
