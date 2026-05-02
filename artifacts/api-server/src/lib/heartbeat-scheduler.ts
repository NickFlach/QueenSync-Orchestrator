import { and, eq, lt, ne, inArray, isNotNull } from "drizzle-orm";
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
 * Default per-probe HTTP timeout (5s). Probes use AbortSignal.timeout.
 */
export const DEFAULT_HEARTBEAT_PROBE_TIMEOUT_MS = 5_000;

type Fetcher = typeof fetch;

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
  probeTimeoutMs?: number;
  fetcher?: Fetcher;
}

/**
 * Actively probe each arm whose `heartbeatUrl` is set. On a 2xx response
 * we refresh `lastHeartbeat = now()` (and restore status from `offline`
 * back to `idle`). On a non-2xx or thrown error we leave `lastHeartbeat`
 * alone — the staleness sweep handles eventual demotion. Returns the IDs
 * we successfully probed.
 *
 * NATS-only arms (kannaktopus arms with no heartbeatUrl) are skipped; their
 * availability is tracked by the NATS bridge via presence join/leave events
 * (handled separately, see follow-up #20).
 */
export async function probeHeartbeatUrls(
  opts: HeartbeatSchedulerOptions = {},
): Promise<string[]> {
  const fetcher = opts.fetcher ?? fetch;
  const timeoutMs = opts.probeTimeoutMs ?? DEFAULT_HEARTBEAT_PROBE_TIMEOUT_MS;
  const rows = await db
    .select({
      id: armsTable.id,
      heartbeatUrl: armsTable.heartbeatUrl,
      status: armsTable.status,
    })
    .from(armsTable)
    .where(isNotNull(armsTable.heartbeatUrl));
  const refreshed: string[] = [];
  await Promise.all(
    rows.map(async (row) => {
      const url = row.heartbeatUrl;
      if (!url) return;
      try {
        const r = await fetcher(url, {
          method: "GET",
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!r.ok) {
          logger.debug(
            { armId: row.id, status: r.status, url },
            "heartbeat probe non-2xx — letting sweep handle staleness",
          );
          return;
        }
        const next: { status?: string; lastHeartbeat: Date } = {
          lastHeartbeat: new Date(),
        };
        if (row.status === "offline") next.status = "idle";
        await db.update(armsTable).set(next).where(eq(armsTable.id, row.id));
        refreshed.push(row.id);
        if (row.status === "offline") {
          broadcast({
            type: "arms_updated",
            data: { armId: row.id, status: "idle" },
          });
        }
      } catch (err) {
        logger.debug(
          { armId: row.id, url, err: (err as Error).message },
          "heartbeat probe error — letting sweep handle staleness",
        );
      }
    }),
  );
  if (refreshed.length > 0) {
    logger.debug(
      { count: refreshed.length, ids: refreshed },
      "heartbeat probe — refreshed lastHeartbeat",
    );
  }
  return refreshed;
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
 * Run a single sweep — demote arms whose lastHeartbeat is stale to
 * `offline`. Skips arms with NULL lastHeartbeat — those are tracked via
 * a separate channel (NATS presence) rather than HTTP probing. Returns
 * the IDs that were actually demoted.
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
  // Compare-and-set: re-apply the staleness predicate on UPDATE so an arm
  // that heartbeats between SELECT and UPDATE isn't falsely demoted.
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
  const tick = async () => {
    try {
      await probeHeartbeatUrls(opts);
    } catch (err) {
      logger.warn({ err }, "heartbeat probe failed");
    }
    try {
      await sweepStaleHeartbeats(opts);
    } catch (err) {
      logger.warn({ err }, "heartbeat sweep failed");
    }
  };
  timer = setInterval(() => {
    void tick();
  }, intervalMs);
  // Kick off an immediate first probe so newly-booted servers don't wait
  // a full interval before reflecting reality.
  void tick();
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
