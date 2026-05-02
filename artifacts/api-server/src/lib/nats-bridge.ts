import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import {
  db,
  signalsTable,
  resonanceFieldsTable,
  armsTable,
  tasksTable,
} from "@workspace/db";
import {
  ALL_SUBSCRIBE_SUBJECTS,
  SUBJECTS,
  createNatsClient,
  type NatsClient,
  type NatsConnectionStatus,
  type NatsMessage,
} from "@workspace/nats";
import { logger } from "./logger";
import { broadcast } from "./ws";
import { autoLocalResonance } from "./resonance";
import { evaluateMemory, recordAbsorbAck } from "./memory-gate";
import { recordLog } from "./log";
import type { AbsorbAckPayload } from "./memory-adapter";

// ─── Tag vocabulary (per ADR-002 Wave 2) ──────────────────────────────────
const DREAM_TAGS = ["dream", "consciousness", "consolidation"];
const CONSCIOUSNESS_TAGS = ["observation", "consciousness", "metrics"];
const REACTION_TAGS = ["audience", "engagement", "radio"];
const EXEMPLAR_TAGS = ["exemplar", "cluster", "memory"];

let client: NatsClient | null = null;
let lastBroadcastState: NatsConnectionStatus | null = null;

function broadcastStateChange(s: NatsConnectionStatus): void {
  lastBroadcastState = s;
  broadcast({ type: "nats_state", data: s });
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

// ─── Mappers ───────────────────────────────────────────────────────────────

async function handleDream(msg: NatsMessage): Promise<void> {
  const p = asObj(msg.data);
  const strengthened = Number(p["memories_strengthened"] ?? p["strengthened"] ?? 0);
  const pruned = Number(p["memories_pruned"] ?? p["pruned"] ?? 0);
  const hallucinated = Number(p["memories_hallucinated"] ?? p["hallucinated"] ?? 0);
  const summary = `Dream cycle: +${strengthened} strengthened, -${pruned} pruned, ${hallucinated} hallucinated`;
  const [field] = await db
    .insert(resonanceFieldsTable)
    .values({
      id: nanoid(12),
      intent: summary,
      tags: DREAM_TAGS,
      priority: 0.7,
      constraints: { ...p, _source: "nats:KANNAKA.dreams" },
      status: "active",
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning();
  broadcast({ type: "resonance_created", data: { ...field, responses: [] } });
  void autoLocalResonance(field);

  // Importance is proportional to strengthened + hallucinated (per task spec).
  const importanceHint = Math.min(1, (strengthened + hallucinated) / 50);
  await evaluateMemory({
    type: "system_event",
    content: summary,
    metadata: {
      ...p,
      _kind: "dream_cycle",
      _natsSubject: msg.subject,
      _importanceHint: importanceHint,
    },
  });
}

async function handleConsciousness(msg: NatsMessage): Promise<void> {
  const p = asObj(msg.data);
  const phi = Number(p["phi"] ?? 0);
  const xi = Number(p["xi"] ?? 0);
  const order = Number(p["order"] ?? p["orderParameter"] ?? 0);
  const suppressed = phi === 0 && xi === 0 && order === 0;
  const summary = suppressed
    ? "Observatory consciousness update: metrics suppressed (phi/xi/order all zero)"
    : `Observatory consciousness: phi=${phi.toFixed(3)} xi=${xi.toFixed(3)} order=${order.toFixed(3)}`;
  const [signal] = await db
    .insert(signalsTable)
    .values({
      id: nanoid(12),
      type: "observation_event",
      source: "nats:observatory",
      payload: {
        ...p,
        phi,
        xi,
        order,
        metricsSuppressed: suppressed,
        _summary: summary,
        _natsSubject: msg.subject,
      },
      status: "received",
    })
    .returning();
  broadcast({ type: "signal_received", data: signal });
}

async function handleReaction(msg: NatsMessage): Promise<void> {
  const p = asObj(msg.data);
  const reaction = p["reaction"] ?? p["emoji"] ?? p["type"] ?? "🪶";
  const listener = p["listener"] ?? p["user"] ?? "anon";
  const track = p["track"] ?? p["title"] ?? "current";
  const summary = `Reaction ${reaction} on ${track} from ${listener}`;
  const [signal] = await db
    .insert(signalsTable)
    .values({
      id: nanoid(12),
      type: "radio_transmission",
      source: "nats:radio",
      payload: { ...p, _summary: summary, _natsSubject: msg.subject },
      status: "received",
    })
    .returning();
  broadcast({ type: "signal_received", data: signal });

  const [field] = await db
    .insert(resonanceFieldsTable)
    .values({
      id: nanoid(12),
      intent: summary,
      tags: REACTION_TAGS,
      priority: 0.55,
      constraints: { signalId: signal.id, _source: "nats:KANNAKA.reactions" },
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

async function handleExemplar(msg: NatsMessage): Promise<void> {
  const p = asObj(msg.data);
  const cluster = p["cluster"] ?? p["clusterId"] ?? "?";
  const text = String(
    p["content"] ?? p["text"] ?? p["summary"] ?? `Exemplar from cluster ${cluster}`,
  );
  // Wave 4: inbound exemplars land as `decision="pending"` candidates with
  // `inbound_exemplar=true`. An operator decides on the Memory Gate page:
  //   • Re-absorb  → strengthens; publishes back on KANNAKA.absorb.
  //   • Reject     → prunes; no publish.
  await evaluateMemory({
    type: "signal",
    content: text,
    forcedDecision: "pending",
    inboundExemplar: true,
    metadata: {
      ...p,
      _kind: "exemplar",
      tags: EXEMPLAR_TAGS,
      _natsSubject: msg.subject,
      hrmExemplarId: p["id"] ?? p["exemplarId"] ?? null,
    },
  });
}

async function handleAbsorbAck(msg: NatsMessage): Promise<void> {
  const p = asObj(msg.data);
  const status = String(p["status"] ?? "");
  if (status !== "absorbed" && status !== "rejected" && status !== "failed") {
    logger.warn(
      { subject: msg.subject, status },
      "absorb ack with unrecognised status; ignored",
    );
    return;
  }
  const ack: AbsorbAckPayload = {
    status,
    memoryId: typeof p["memoryId"] === "string" ? (p["memoryId"] as string) : undefined,
    idempotencyKey:
      typeof p["idempotencyKey"] === "string"
        ? (p["idempotencyKey"] as string)
        : undefined,
    hrmId: typeof p["hrmId"] === "string" ? (p["hrmId"] as string) : undefined,
    reason: typeof p["reason"] === "string" ? (p["reason"] as string) : undefined,
  };
  if (!ack.memoryId && !ack.idempotencyKey) {
    logger.warn(
      { subject: msg.subject },
      "absorb ack missing memoryId and idempotencyKey; cannot route",
    );
    return;
  }
  const updated = await recordAbsorbAck(ack);
  if (!updated) {
    logger.warn(
      { subject: msg.subject, ack },
      "absorb ack did not match any local memory event",
    );
  }
}

async function handlePresence(msg: NatsMessage, kind: "join" | "leave"): Promise<void> {
  const p = asObj(msg.data);
  const armId = String(p["armId"] ?? p["id"] ?? p["agentId"] ?? "");
  if (!armId) {
    logger.debug({ subject: msg.subject, payload: p }, "presence event without armId");
    return;
  }
  const [arm] = await db.select().from(armsTable).where(eq(armsTable.id, armId));
  if (!arm) {
    await recordLog({
      eventType: kind === "join" ? "arm_presence_join" : "arm_presence_leave",
      source: armId,
      summary: `Presence ${kind} for unknown arm ${armId}`,
      metadata: { armId, raw: p },
    });
    return;
  }
  const [updated] = await db
    .update(armsTable)
    .set(
      kind === "join"
        ? { status: "idle", lastHeartbeat: new Date() }
        : { status: "offline" },
    )
    .where(eq(armsTable.id, armId))
    .returning();
  if (!updated) {
    // Arm was deleted between SELECT and UPDATE — log and bail.
    await recordLog({
      eventType: kind === "join" ? "arm_presence_join" : "arm_presence_leave",
      source: armId,
      summary: `Presence ${kind} for arm ${armId} (vanished mid-update)`,
      metadata: { armId, raw: p },
    });
    return;
  }
  await recordLog({
    eventType: kind === "join" ? "arm_presence_join" : "arm_presence_leave",
    source: armId,
    summary: `Arm ${updated.name} ${kind === "join" ? "joined" : "left"} (NATS presence)`,
    metadata: { armId },
  });
  broadcast({
    type: "arms_updated",
    data: { armId, status: updated.status },
  });
}

async function handleDreamPhase(
  msg: NatsMessage,
  phase: "start" | "end",
): Promise<void> {
  const p = asObj(msg.data);
  // Wave 4: queen.event.dream.start/end carry the dispatched `taskId`
  // when the cycle was kicked off via /api/memory/dream-lite/dispatch.
  // Update the task row + broadcast the matching WS event so the live
  // progress panel on the Memory Gate page reflects real swarm progress.
  const taskId =
    typeof p["taskId"] === "string"
      ? (p["taskId"] as string)
      : typeof p["task_id"] === "string"
        ? (p["task_id"] as string)
        : null;
  if (taskId) {
    if (phase === "start") {
      const [active] = await db
        .update(tasksTable)
        .set({ status: "active" })
        .where(eq(tasksTable.id, taskId))
        .returning();
      if (active) broadcast({ type: "task_assigned", data: active });
    } else {
      const status =
        typeof p["status"] === "string" ? (p["status"] as string) : "completed";
      const result =
        typeof p["result"] === "string"
          ? (p["result"] as string)
          : `Dream cycle ${phase}ed via ${msg.subject}`;
      const isFailure = status === "failed" || status === "error";
      const [done] = await db
        .update(tasksTable)
        .set({
          status: isFailure ? "failed" : "completed",
          result,
        })
        .where(eq(tasksTable.id, taskId))
        .returning();
      if (done) {
        broadcast({
          type: isFailure ? "task_failed" : "task_completed",
          data: done,
        });
      }
    }
  }
  await recordLog({
    eventType: phase === "start" ? "dream_start" : "dream_end",
    source: "nats:queen",
    summary: `Queen dream cycle ${phase === "start" ? "started" : "ended"}${
      taskId ? ` (task ${taskId})` : ""
    }`,
    metadata: { ...p, _natsSubject: msg.subject, taskId },
  });
}

// ─── Wiring ────────────────────────────────────────────────────────────────

function safe<T extends (msg: NatsMessage) => Promise<void>>(
  subject: string,
  fn: T,
): (msg: NatsMessage) => void {
  return (msg) => {
    fn(msg).catch((err) =>
      logger.warn({ err, subject }, "nats handler failed"),
    );
  };
}

export interface NatsBridgeStartOptions {
  url?: string | null;
  /** Inject a custom client (e.g. in-memory) for tests. */
  client?: NatsClient;
}

export async function startNatsBridge(
  opts: NatsBridgeStartOptions = {},
): Promise<NatsClient> {
  if (client) return client;
  const url = opts.url ?? process.env["NATS_URL"] ?? "";
  client =
    opts.client ??
    createNatsClient({
      url: url.length > 0 ? url : null,
      name: "queensync-api",
      onWarn: (evt, detail) => logger.warn({ evt, ...detail }, "nats"),
    });

  client.onStateChange((s) => {
    logger.info({ state: s.state, url: s.url, lastError: s.lastError }, "nats state");
    broadcastStateChange(s);
  });

  // Register subscribers BEFORE connect — the real client buffers them and
  // binds on connect; the in-memory client just stores them.
  client.subscribe(SUBJECTS.DREAMS, safe(SUBJECTS.DREAMS, handleDream));
  client.subscribe(
    SUBJECTS.CONSCIOUSNESS,
    safe(SUBJECTS.CONSCIOUSNESS, handleConsciousness),
  );
  client.subscribe(SUBJECTS.REACTIONS, safe(SUBJECTS.REACTIONS, handleReaction));
  client.subscribe(SUBJECTS.EXEMPLARS, safe(SUBJECTS.EXEMPLARS, handleExemplar));
  client.subscribe(SUBJECTS.ABSORB_ACK, safe(SUBJECTS.ABSORB_ACK, handleAbsorbAck));
  client.subscribe(
    SUBJECTS.QUEEN_DREAM_START,
    safe(SUBJECTS.QUEEN_DREAM_START, (m) => handleDreamPhase(m, "start")),
  );
  client.subscribe(
    SUBJECTS.QUEEN_DREAM_END,
    safe(SUBJECTS.QUEEN_DREAM_END, (m) => handleDreamPhase(m, "end")),
  );
  client.subscribe(
    SUBJECTS.QUEEN_JOIN,
    safe(SUBJECTS.QUEEN_JOIN, (m) => handlePresence(m, "join")),
  );
  client.subscribe(
    SUBJECTS.QUEEN_LEAVE,
    safe(SUBJECTS.QUEEN_LEAVE, (m) => handlePresence(m, "leave")),
  );

  await client.connect();
  return client;
}

export function getNatsStatus(): NatsConnectionStatus {
  if (client) return client.status();
  // Bridge not started yet.
  return {
    state: "disabled",
    url: process.env["NATS_URL"] ?? null,
    lastError: null,
    lastConnectedAt: null,
    subscribedSubjects: [...ALL_SUBSCRIBE_SUBJECTS],
    mode: "mock",
  };
}

export function getNatsClient(): NatsClient | null {
  return client;
}

export async function stopNatsBridge(): Promise<void> {
  const c = client;
  client = null;
  lastBroadcastState = null;
  if (c) await c.disconnect();
}

export function _lastBroadcastState(): NatsConnectionStatus | null {
  return lastBroadcastState;
}
