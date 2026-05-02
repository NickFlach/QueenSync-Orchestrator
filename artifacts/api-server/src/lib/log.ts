import { nanoid } from "nanoid";
import { db, logsTable, type InsertLogEntry } from "@workspace/db";
import { broadcast } from "./ws";
import type { AuditContext } from "./audit";
import { appendLogExport } from "./log-export";

export type LogInput = Omit<InsertLogEntry, "id" | "createdAt"> & {
  audit?: AuditContext;
};

export async function recordLog(entry: LogInput) {
  const { audit, metadata, ...rest } = entry;
  const mergedMetadata = audit
    ? {
        ...(typeof metadata === "object" && metadata !== null ? metadata : {}),
        actor: audit.actor,
        ip: audit.ip,
        trigger: audit.trigger,
      }
    : metadata;
  const [row] = await db
    .insert(logsTable)
    .values({
      id: nanoid(12),
      ...rest,
      ...(mergedMetadata !== undefined ? { metadata: mergedMetadata } : {}),
    })
    .returning();
  broadcast({ type: "log_event", data: row });
  // Best-effort append to the export sink (no-op when QUEENSYNC_LOG_FILE
  // is not set). Errors are swallowed inside appendLogExport.
  void appendLogExport(row);
  return row;
}
