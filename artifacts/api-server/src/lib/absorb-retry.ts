/**
 * Periodic retry worker for failed HRM absorbs.
 *
 * Wave 4 stores `absorb_state="failed"`, `absorb_attempts`, `last_absorb_error`
 * and `absorb_state_updated_at` on `memory_events` so that a brief NATS outage
 * does not strand approved events forever. This module wakes up on a
 * configurable interval, picks up rows whose state is `failed` and whose
 * attempt count is still below the cap, applies an exponential backoff against
 * `absorb_state_updated_at`, and replays each row through `requestAbsorb()`
 * (which already handles attempt bookkeeping, the persist-before-publish CAS,
 * and websocket broadcast).
 *
 * Configurable via env vars (override per-call by passing options):
 *   QUEENSYNC_ABSORB_RETRY_INTERVAL_MS    sweep cadence (default 60s)
 *   QUEENSYNC_ABSORB_MAX_ATTEMPTS         cap on attempts (default 6)
 *   QUEENSYNC_ABSORB_RETRY_BASE_MS        base backoff (default 30s)
 *   QUEENSYNC_ABSORB_RETRY_MAX_BACKOFF_MS backoff cap (default 1h)
 */

import { and, eq, lt, ne } from "drizzle-orm";
import { db, memoryEventsTable } from "@workspace/db";
import { logger } from "./logger";
import { requestAbsorb } from "./memory-gate";

export const DEFAULT_ABSORB_RETRY_INTERVAL_MS = 60_000;
export const DEFAULT_ABSORB_MAX_ATTEMPTS = 6;
export const DEFAULT_ABSORB_RETRY_BASE_MS = 30_000;
export const DEFAULT_ABSORB_RETRY_MAX_BACKOFF_MS = 60 * 60 * 1000;

export interface AbsorbRetryOptions {
  intervalMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getMaxAttempts(opts: AbsorbRetryOptions): number {
  return (
    opts.maxAttempts ??
    envInt("QUEENSYNC_ABSORB_MAX_ATTEMPTS", DEFAULT_ABSORB_MAX_ATTEMPTS)
  );
}

function getBaseBackoff(opts: AbsorbRetryOptions): number {
  return (
    opts.baseBackoffMs ??
    envInt("QUEENSYNC_ABSORB_RETRY_BASE_MS", DEFAULT_ABSORB_RETRY_BASE_MS)
  );
}

function getMaxBackoff(opts: AbsorbRetryOptions): number {
  return (
    opts.maxBackoffMs ??
    envInt(
      "QUEENSYNC_ABSORB_RETRY_MAX_BACKOFF_MS",
      DEFAULT_ABSORB_RETRY_MAX_BACKOFF_MS,
    )
  );
}

function getIntervalMs(opts: AbsorbRetryOptions): number {
  return (
    opts.intervalMs ??
    envInt(
      "QUEENSYNC_ABSORB_RETRY_INTERVAL_MS",
      DEFAULT_ABSORB_RETRY_INTERVAL_MS,
    )
  );
}

/**
 * Compute the earliest time (epoch ms) at which a row with the given attempt
 * counter and last-state-update timestamp should be retried. Backoff is
 * exponential — `base * 2^(attempts-1)` — capped at `maxBackoffMs`. A row
 * with no `absorb_state_updated_at` (legacy data) is treated as immediately
 * eligible.
 */
export function nextRetryAt(
  attempts: number,
  updatedAt: Date | null,
  opts: AbsorbRetryOptions = {},
): number {
  if (!updatedAt) return 0;
  const base = getBaseBackoff(opts);
  const cap = getMaxBackoff(opts);
  const safe = Math.max(1, attempts);
  const delay = Math.min(cap, base * Math.pow(2, safe - 1));
  return updatedAt.getTime() + delay;
}

/**
 * Run a single retry sweep. Returns the IDs that were re-attempted (regardless
 * of whether the publish ultimately succeeded). Rows whose attempt count has
 * reached `maxAttempts` are intentionally left alone for operator inspection.
 */
export async function runAbsorbRetrySweep(
  opts: AbsorbRetryOptions = {},
): Promise<string[]> {
  const maxAttempts = getMaxAttempts(opts);
  const candidates = await db
    .select({
      id: memoryEventsTable.id,
      absorbAttempts: memoryEventsTable.absorbAttempts,
      absorbStateUpdatedAt: memoryEventsTable.absorbStateUpdatedAt,
    })
    .from(memoryEventsTable)
    .where(
      and(
        eq(memoryEventsTable.absorbState, "failed"),
        ne(memoryEventsTable.decision, "rejected"),
        lt(memoryEventsTable.absorbAttempts, maxAttempts),
      ),
    );
  const now = Date.now();
  const due = candidates.filter(
    (c) => nextRetryAt(c.absorbAttempts, c.absorbStateUpdatedAt, opts) <= now,
  );
  const retried: string[] = [];
  for (const row of due) {
    try {
      const result = await requestAbsorb(row.id);
      retried.push(row.id);
      logger.info(
        {
          memoryId: row.id,
          previousAttempts: row.absorbAttempts,
          attempts: result.event?.absorbAttempts ?? null,
          delivered: result.publish.delivered,
          absorbState: result.event?.absorbState ?? null,
        },
        result.publish.delivered
          ? "absorb retry republished on KANNAKA.absorb"
          : "absorb retry still failing",
      );
    } catch (err) {
      logger.warn(
        { err, memoryId: row.id },
        "absorb retry threw unexpectedly",
      );
    }
  }
  if (retried.length > 0) {
    logger.debug(
      { count: retried.length, ids: retried },
      "absorb retry sweep complete",
    );
  }
  return retried;
}

let timer: NodeJS.Timeout | null = null;
let sweepInFlight = false;

/**
 * Start the periodic retry scheduler. Idempotent — safe to call twice.
 * Returns a stop fn for tests.
 */
export function startAbsorbRetryScheduler(
  opts: AbsorbRetryOptions = {},
): () => void {
  if (timer) {
    logger.debug(
      "absorb retry scheduler already running — ignoring duplicate start",
    );
    return stopAbsorbRetryScheduler;
  }
  const intervalMs = getIntervalMs(opts);
  const tick = async () => {
    // In-flight guard — if a previous sweep is still running (slow DB or
    // many candidates), skip this tick rather than fan out overlapping
    // republishes of the same row. HRM dedupes on idempotencyKey so this
    // is belt-and-suspenders, but it keeps logs and attempt counters clean.
    if (sweepInFlight) {
      logger.debug("absorb retry sweep still in flight — skipping tick");
      return;
    }
    sweepInFlight = true;
    try {
      await runAbsorbRetrySweep(opts);
    } catch (err) {
      logger.warn({ err }, "absorb retry sweep failed");
    } finally {
      sweepInFlight = false;
    }
  };
  timer = setInterval(() => {
    void tick();
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  logger.info(
    {
      intervalMs,
      maxAttempts: getMaxAttempts(opts),
      baseBackoffMs: getBaseBackoff(opts),
      maxBackoffMs: getMaxBackoff(opts),
    },
    "absorb retry scheduler started",
  );
  return stopAbsorbRetryScheduler;
}

export function stopAbsorbRetryScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
