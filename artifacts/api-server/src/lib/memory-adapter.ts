/**
 * kannaka-memory adapter (placeholder).
 *
 * The real substrate lives at https://github.com/NickFlach/kannaka-memory and
 * exposes a remembrance graph keyed by (agentId, sourceTaskId, contentHash).
 * Once the live integration lands, this module will:
 *
 *   1. POST { event } to KANNAKA_MEMORY_URL/api/remember with HMAC auth using
 *      KANNAKA_MEMORY_SECRET (sha256 over the JSON body).
 *   2. Receive back { remembered: bool, memoryId, links[] } and stamp the
 *      local memory_events.metadata.kannakaMemoryId with the remote id.
 *   3. Stream subsequent updates over NATS subject `KANNAKA.memory.echo` for
 *      cross-arm propagation.
 *
 * Until that contract is implemented, every call here is a no-op that just
 * logs the event so operators can see governance is wired correctly.
 */

import { logger } from "./logger";
import type { MemoryEvent } from "@workspace/db";

export interface KannakaMemoryPushResult {
  attempted: boolean;
  delivered: boolean;
  message: string;
}

const KANNAKA_MEMORY_URL = process.env["KANNAKA_MEMORY_URL"] ?? null;

export async function pushToKannakaMemory(
  event: Pick<
    MemoryEvent,
    | "id"
    | "type"
    | "tag"
    | "tags"
    | "summary"
    | "sourceAttribution"
    | "importance"
    | "decision"
    | "agentId"
    | "sourceTaskId"
    | "sourceResonanceId"
    | "contentHash"
  >,
): Promise<KannakaMemoryPushResult> {
  // Placeholder: real wire-up tracked under v2 Wave 4 (Memory Gate ↔
  // kannaka-memory HRM bridge). Today the function only exists so the
  // governance pipeline calls a single, well-known seam.
  if (!KANNAKA_MEMORY_URL) {
    logger.debug(
      {
        memoryId: event.id,
        tag: event.tag,
        decision: event.decision,
      },
      "kannaka-memory adapter: stub (KANNAKA_MEMORY_URL not configured)",
    );
    return {
      attempted: false,
      delivered: false,
      message: "kannaka-memory adapter not configured (stub)",
    };
  }

  // When KANNAKA_MEMORY_URL is set we still no-op for now, but log loudly so
  // it is obvious the live bridge has not landed yet.
  logger.info(
    {
      memoryId: event.id,
      tag: event.tag,
      decision: event.decision,
      kannakaMemoryUrl: KANNAKA_MEMORY_URL,
    },
    "kannaka-memory adapter: no-op (live bridge pending v2 Wave 4)",
  );
  return {
    attempted: true,
    delivered: false,
    message: "kannaka-memory adapter: live bridge pending v2 Wave 4",
  };
}
