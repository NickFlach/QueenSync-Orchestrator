import { and, lt, ne, inArray, sql, isNotNull } from "drizzle-orm";
import { db, armsTable } from "@workspace/db";
import { logger } from "./logger";
import { broadcast } from "./ws";
import { recordLog } from "./log";

/**
 * Default heartbeat scheduler interval (60s). Can be lowered in tests by
 * passing `intervalMs` to {@link startHeartbeatScheduler}.
 */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Default stale window (3 minutes). Arms whose lastHeartbeat is older than
 * this — and whose status is not already `offline` — are demoted to
 * `offline`. Override with `QUEENSYNC_ARM_STALE_MS`.
 */
export const DEFAULT_HEARTBEAT_STALE_MS = 180_000;

/**
 * Status values a stale arm should NOT be demoted from. We keep `failed`
 * as-is so operators don't lose the failure signal, and `offline` is the
 * target state so re-marking is a no-op.
 */
const TERMINAL_STATUSES = ["offline", "failed"] as const;

let timer: NodeJS.Timeout | null = null;

export interface HeartbeatSchedulerOptions {
  intervalMs?: number;
  staleMs?: number;
}

function getStaleMs(opts: HeartbeatSchedulerOptions = {}): number {
  if (opts.staleMs !== undefined) return opts.staleMs;
  const env = process.env["QUEENSYNC_ARM_STALE_MS"];
  if (env) {
    const n = Number(env);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_HEARTBEAT_STALE_MS;
}

/**
 * Run a single sweep — find arms whose lastHeartbeat is stale and demote
 * them to `offline`. Returns the IDs that were demoted (useful in tests).
 *
 * Arms that have never heartbeated (lastHeartbeat IS NULL) are intentionally
 * left alone — many arms only ever respond to NATS REQ/REPLY and don't ping
 * the heartbeat endpoint. Those should be marked offline via NATS presence
 * leave events (handled in nats-bridge.ts), or left in their seeded state.
 */
export async function sweepStaleHeartbeats(
  opts: HeartbeatSchedulerOptions = {},
): Promise<string[]> {
  const staleMs = getStaleMs(opts);
  const cutoff = new Date(Date.now() - staleMs);
  const stale = await db
    .select({
      id: armsTable.id,
      name: armsTable.name,
      status: armsTable.status,
      lastHeartbeat: armsTable.lastHeartbeat,
    })
    .from(armsTable)
    .where(
      and(
        isNotNull(armsTable.lastHeartbeat),
        lt(armsTable.lastHeartbeat, cutoff),
        ne(armsTable.status, "offline"),
        ne(armsTable.status, "failed"),
      ),
    );
  if (stale.length === 0) return [];
  const ids = stale.map((s) => s.id);
  // Re-apply the staleness predicate on UPDATE so an arm that heartbeats
  // between our SELECT and UPDATE doesn't get falsely demoted (compare-
  // and-set). `updated` is the set of rows we actually demoted; rows that
  // raced past the cutoff are silently skipped.
  const updated = await db
    .update(armsTable)
    .set({ status: "offline" })
    .where(
      and(
        inArray(armsTable.id, ids),
        isNotNull(armsTable.lastHeartbeat),
        lt(armsTable.lastHeartbeat, cutoff),
        ne(armsTable.status, "offline"),
        ne(armsTable.status, "failed"),
      ),
    )
    .returning({ id: armsTable.id });
  const updatedIds = new Set(updated.map((u) => u.id));
  if (updatedIds.size === 0) return [];
  for (const s of stale) {
    if (!updatedIds.has(s.id)) continue;
    await recordLog({
      eventType: "arm_marked_offline",
      source: s.id,
      summary: `Arm ${s.name} marked offline — last heartbeat ${
        s.lastHeartbeat?.toISOString() ?? "never"
      } (stale > ${staleMs}ms)`,
      metadata: {
        armId: s.id,
        previousStatus: s.status,
        lastHeartbeat: s.lastHeartbeat?.toISOString() ?? null,
        staleMs,
      },
    });
    broadcast({ type: "arms_updated", data: { armId: s.id, status: "offline" } });
  }
  const finalIds = [...updatedIds];
  logger.info(
    { count: finalIds.length, ids: finalIds, staleMs },
    "heartbeat sweep — arms marked offline",
  );
  // Touch sql to satisfy drizzle import inference even if unused at runtime.
  void sql;
  return finalIds;
}

/**
 * Start the periodic heartbeat sweeper. Idempotent — safe to call twice.
 * Returns a stop fn for tests.
 */
export function startHeartbeatScheduler(
  opts: HeartbeatSchedulerOptions = {},
): () => void {
  if (timer) {
    logger.debug("heartbeat scheduler already running — ignoring duplicate start");
    return stopHeartbeatScheduler;
  }
  const intervalMs = opts.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  timer = setInterval(() => {
    void sweepStaleHeartbeats(opts).catch((err) =>
      logger.warn({ err }, "heartbeat sweep failed"),
    );
  }, intervalMs);
  // Don't keep the event loop alive for tests / graceful shutdown.
  if (typeof timer.unref === "function") timer.unref();
  logger.info(
    { intervalMs, staleMs: getStaleMs(opts) },
    "heartbeat scheduler started",
  );
  return stopHeartbeatScheduler;
}

export function stopHeartbeatScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
