import { nanoid } from "nanoid";
import { db, logsTable, type InsertLogEntry } from "@workspace/db";
import { broadcast } from "./ws";

export type LogInput = Omit<InsertLogEntry, "id" | "createdAt">;

export async function recordLog(entry: LogInput) {
  const [row] = await db
    .insert(logsTable)
    .values({ id: nanoid(12), ...entry })
    .returning();
  broadcast({ kind: "log", data: row });
  return row;
}
