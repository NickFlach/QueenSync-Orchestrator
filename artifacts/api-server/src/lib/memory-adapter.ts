/**
 * kannaka-memory adapter — Wave 4 implementation.
 *
 * SUPERSEDES Draft #9 (mirror-to-kannaka-memory). The earlier no-op stub
 * that pretended to POST to a `KANNAKA_MEMORY_URL/api/remember` HTTP endpoint
 * is gone — the real bridge speaks NATS to the constellation's swarm bus.
 *
 * Approved memory events that the operator escalates with "Absorb to HRM"
 * publish on `KANNAKA.absorb` with an idempotency key derived from the
 * existing 24h dedupe hash. kannaka-memory's swarm-worker (per
 * `kannaka-memory` ADR-0026 Phase 6) consumes the subject, dedupes by the
 * idempotency key, absorbs into HRM, and acks on `KANNAKA.absorb.ack`.
 *
 * The ack handler is wired in `nats-bridge.ts` and updates `memory_events`
 * (`absorb_state="absorbed"`, `absorbed_at=...`).
 *
 * Failure modes are explicit:
 *   - NATS not connected → returns { delivered:false } so the caller can
 *     mark the event `absorb_state="failed"` and disable the UI button.
 *   - Publish exception → same.
 *   - HRM nack → ack handler marks `absorb_state="failed"` with a reason.
 */

import type { MemoryEvent } from "@workspace/db";
import { logger } from "./logger";
import { getNatsClient } from "./nats-bridge";

/** Subject the constellation listens on for absorb requests. */
export const ABSORB_SUBJECT = "KANNAKA.absorb";
/** Subject we listen on for HRM acks (success or rejection). */
export const ABSORB_ACK_SUBJECT = "KANNAKA.absorb.ack";

export interface AbsorbPayload {
  /** Stable idempotency key — the receiver dedupes on this. */
  idempotencyKey: string;
  /** Local QueenSync memory event id (for cross-referencing in the ack). */
  memoryId: string;
  type: string;
  tag: string;
  tags: string[];
  summary: string;
  content: string;
  importance: number;
  agentId: string | null;
  sourceTaskId: string | null;
  sourceResonanceId: string | null;
  sourceAttribution: string;
  metadata: Record<string, unknown>;
  /** ISO8601 — when QueenSync first observed the event. */
  createdAt: string;
}

export interface AbsorbAckPayload {
  /** Echoed from the publish — primary correlation key. */
  idempotencyKey?: string;
  /** Echoed memory id (preferred when present). */
  memoryId?: string;
  /** "absorbed" → HRM accepted; "rejected" → HRM rejected; "failed" → worker error. */
  status: "absorbed" | "rejected" | "failed";
  /** HRM-side identifier for cross-reference. */
  hrmId?: string;
  /** Free-text explanation when not absorbed. */
  reason?: string;
}

export interface AbsorbAttemptResult {
  attempted: boolean;
  delivered: boolean;
  message: string;
  idempotencyKey: string | null;
}

function buildPayload(event: MemoryEvent, idempotencyKey: string): AbsorbPayload {
  return {
    idempotencyKey,
    memoryId: event.id,
    type: event.type,
    tag: event.tag,
    tags: event.tags ?? [],
    summary: event.summary,
    content: event.content,
    importance: event.importance,
    agentId: event.agentId,
    sourceTaskId: event.sourceTaskId,
    sourceResonanceId: event.sourceResonanceId,
    sourceAttribution: event.sourceAttribution,
    metadata: (event.metadata as Record<string, unknown>) ?? {},
    createdAt:
      event.createdAt instanceof Date
        ? event.createdAt.toISOString()
        : String(event.createdAt),
  };
}

/**
 * Derive the idempotency key for an absorb publish. Today this is the
 * existing 24h dedupe `contentHash` — kannaka-memory dedupes on it so two
 * publishes of the same event resolve to a single HRM absorb.
 */
export function deriveAbsorbIdempotencyKey(event: MemoryEvent): string {
  return event.idempotencyKey ?? event.contentHash;
}

/**
 * Publish an approved memory event onto KANNAKA.absorb. The caller is
 * responsible for updating `memory_events.absorb_state` based on the
 * returned `delivered` flag — this function is intentionally side-effect-
 * free against the database so it stays cheap to test.
 */
export async function publishAbsorb(
  event: MemoryEvent,
): Promise<AbsorbAttemptResult> {
  const client = getNatsClient();
  const idempotencyKey = deriveAbsorbIdempotencyKey(event);
  if (!client) {
    return {
      attempted: false,
      delivered: false,
      message: "NATS bridge not started — absorb skipped",
      idempotencyKey,
    };
  }
  const status = client.status();
  if (status.state !== "connected") {
    return {
      attempted: false,
      delivered: false,
      message: `NATS ${status.state} — absorb cannot be published yet`,
      idempotencyKey,
    };
  }
  try {
    client.publish(ABSORB_SUBJECT, buildPayload(event, idempotencyKey));
    logger.info(
      {
        memoryId: event.id,
        idempotencyKey,
        subject: ABSORB_SUBJECT,
      },
      "kannaka-memory absorb published",
    );
    return {
      attempted: true,
      delivered: true,
      message: `Published on ${ABSORB_SUBJECT} (key=${idempotencyKey.slice(0, 8)}…)`,
      idempotencyKey,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err: message, memoryId: event.id, idempotencyKey },
      "kannaka-memory absorb publish failed",
    );
    return {
      attempted: true,
      delivered: false,
      message: `Publish failed: ${message}`,
      idempotencyKey,
    };
  }
}

/**
 * Back-compat shim: previously every approval auto-pushed to kannaka-memory.
 * Wave 4 makes that an explicit operator action ("Absorb to HRM"), so the
 * legacy seam is now a no-op that just logs. Removing the import sites is
 * tracked in the same wave but kept as a safe fallback in case any out-of-
 * tree caller still imports it.
 */
export async function pushToKannakaMemory(
  event: Pick<MemoryEvent, "id" | "tag" | "decision">,
): Promise<{ attempted: boolean; delivered: boolean; message: string }> {
  logger.debug(
    { memoryId: event.id, tag: event.tag, decision: event.decision },
    "pushToKannakaMemory is a no-op (Wave 4: absorb is operator-triggered)",
  );
  return {
    attempted: false,
    delivered: false,
    message: "operator must trigger Absorb to HRM (Wave 4)",
  };
}
