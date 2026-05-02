import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import {
  db,
  signalsTable,
  resonanceFieldsTable,
} from "@workspace/db";
import { pollFloorReactions, type AdapterEventOut } from "./adapters";
import { broadcast } from "./ws";
import { autoLocalResonance } from "./resonance";
import { logger } from "./logger";

// Per ADR-002 Wave 1 tag vocabulary contract.
const RADIO_BASE_TAGS = ["radio", "signal", "analysis"];

const seen = new Set<string>();
let armed = false;
let timer: NodeJS.Timeout | null = null;

function pollIntervalMs(): number {
  const raw = process.env["QUEENSYNC_FLOOR_POLL_MS"];
  if (!raw) return 1000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 250) return 1000;
  return n;
}

function isDisabled(): boolean {
  const v = process.env["QUEENSYNC_DISABLE_FLOOR_POLL"];
  return v === "true" || v === "1";
}

async function ingestReaction(e: AdapterEventOut): Promise<void> {
  if (seen.has(e.id)) return;
  seen.add(e.id);
  // Bound the dedupe set
  if (seen.size > 500) {
    const overflow = seen.size - 500;
    let i = 0;
    for (const k of seen) {
      if (i++ >= overflow) break;
      seen.delete(k);
    }
  }

  const [signal] = await db
    .insert(signalsTable)
    .values({
      id: nanoid(12),
      type: "radio_transmission",
      source: "radio.ninja-portal.com",
      payload: { ...e.raw, _summary: e.summary, _eventType: e.type },
      status: "received",
    })
    .returning();
  broadcast({ type: "signal_received", data: signal });

  const subtypeTags = e.type.split(".").filter(Boolean);
  const tags = Array.from(new Set([...RADIO_BASE_TAGS, ...subtypeTags]));
  const [field] = await db
    .insert(resonanceFieldsTable)
    .values({
      id: nanoid(12),
      intent: e.summary,
      tags,
      priority: 0.65,
      constraints: { signalId: signal.id, source: "floor_poll" },
      status: "active",
      expiresAt: new Date(Date.now() + 30_000),
    })
    .returning();
  await db
    .update(signalsTable)
    .set({ derivedResonanceId: field.id })
    .where(eq(signalsTable.id, signal.id));
  broadcast({ type: "resonance_created", data: { ...field, responses: [] } });
  void autoLocalResonance(field);
}

async function tick(): Promise<void> {
  try {
    const result = await pollFloorReactions(5);
    if (!result.ok) {
      // Fetch failed (or force-mock). Do NOT arm — we don't know the
      // current snapshot, so we can't safely dedupe historical reactions.
      return;
    }
    if (!armed) {
      // First successful fetch: seed dedupe with whatever is currently on
      // the floor and start ingesting net-new reactions from the next tick.
      for (const e of result.events) seen.add(e.id);
      armed = true;
      logger.info(
        { primed: result.events.length },
        "floor poller armed (initial snapshot primed)",
      );
      return;
    }
    for (const e of result.events) {
      try {
        await ingestReaction(e);
      } catch (err) {
        logger.warn({ err, eventId: e.id }, "floor reaction ingest failed");
      }
    }
  } catch (err) {
    logger.warn({ err }, "floor poll tick failed");
  }
}

export function startFloorPoller(): void {
  if (timer || isDisabled()) return;
  const ms = pollIntervalMs();
  logger.info({ intervalMs: ms }, "starting radio floor reactions poller");
  timer = setInterval(() => {
    void tick();
  }, ms);
  // Don't keep the process alive solely for this poller.
  if (typeof timer.unref === "function") timer.unref();
  // Prime immediately
  void tick();
}

export function stopFloorPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    armed = false;
    seen.clear();
  }
}

// Internal helper for tests
export function _reset(): void {
  stopFloorPoller();
}
