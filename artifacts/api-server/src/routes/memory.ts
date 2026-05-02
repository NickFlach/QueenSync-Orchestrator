import { Router, type IRouter } from "express";
import { nanoid } from "nanoid";
import { and, asc, desc, eq, inArray, sql, or } from "drizzle-orm";
import {
  db,
  memoryEventsTable,
  signalsTable,
  resonanceFieldsTable,
  resonanceResponsesTable,
  tasksTable,
  logsTable,
  type MemoryEvent,
  type Signal,
  type ResonanceField,
  type ResonanceResponse,
  type Task,
} from "@workspace/db";
import {
  EvaluateMemoryBody,
  CompressMemoryDreamLiteBody,
  DecideExemplarBody,
} from "@workspace/api-zod";
import {
  evaluateMemory,
  markLocalApproved,
  requestAbsorb,
  decideExemplar,
} from "../lib/memory-gate";
import { runDreamLiteCompression } from "../lib/memory-compress";
import { requireOperator } from "../lib/auth";
import { getAuditContext } from "../lib/audit";
import { recordLog } from "../lib/log";
import { broadcast } from "../lib/ws";
import { getNatsClient, getNatsStatus } from "../lib/nats-bridge";
import { SUBJECTS } from "@workspace/nats";

const router: IRouter = Router();

router.get("/memory", async (req, res): Promise<void> => {
  const includeCompacted =
    req.query["includeCompacted"] === "true" ||
    req.query["includeCompacted"] === "1";
  const includeRejected =
    req.query["includeRejected"] === "true" ||
    req.query["includeRejected"] === "1";
  const inboundExemplarsOnly =
    req.query["inboundExemplarsOnly"] === "true" ||
    req.query["inboundExemplarsOnly"] === "1";

  const conditions = [];
  if (!includeCompacted) {
    conditions.push(eq(memoryEventsTable.compacted, false));
  }
  if (inboundExemplarsOnly) {
    conditions.push(eq(memoryEventsTable.inboundExemplar, true));
  } else if (!includeRejected) {
    conditions.push(
      inArray(memoryEventsTable.decision, ["approved", "pending"]),
    );
  }

  const rows = await db
    .select()
    .from(memoryEventsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(memoryEventsTable.createdAt))
    .limit(200);
  res.json(rows);
});

router.get("/memory/exemplars/stats", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      outcome: memoryEventsTable.exemplarOutcome,
      count: sql<number>`count(*)::int`,
    })
    .from(memoryEventsTable)
    .where(eq(memoryEventsTable.inboundExemplar, true))
    .groupBy(memoryEventsTable.exemplarOutcome);
  let strengthened = 0;
  let pruned = 0;
  let pending = 0;
  for (const r of rows) {
    if (r.outcome === "strengthened") strengthened = Number(r.count);
    else if (r.outcome === "pruned") pruned = Number(r.count);
    else pending = Number(r.count);
  }
  res.json({
    strengthened,
    pruned,
    pending,
    total: strengthened + pruned + pending,
  });
});

router.post("/memory/evaluate", requireOperator, async (req, res): Promise<void> => {
  const parsed = EvaluateMemoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const result = await evaluateMemory(parsed.data);
  res.json(result);
});

router.post(
  "/memory/dream-lite",
  requireOperator,
  async (req, res): Promise<void> => {
    const audit = getAuditContext(req);
    const parsed = CompressMemoryDreamLiteBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const result = await runDreamLiteCompression({
      windowMinutes: parsed.data.windowMinutes ?? undefined,
      trigger: audit.trigger,
    });
    res.json(result);
  },
);

/**
 * Wave 4: dispatch a real Dream cycle to kannaka-prime / the swarm via the
 * NATS subject `KANNAKA.dream.dispatch`. Real progress arrives on
 * `queen.event.dream.start` / `queen.event.dream.end` (carrying the
 * dispatched `taskId`) and is broadcast to the UI as task_assigned /
 * task_completed events.
 *
 * Falls back to the local in-process Dream Lite compaction whenever no
 * real dispatch path is available — i.e. NATS is not connected. The
 * seeded `kannaka-prime` arm is type=`kannaktopus_arm`, which the
 * router's `simulateLocalExecution()` would otherwise mock-complete; we
 * deliberately skip `dispatchTask` here so a mock-arm row never looks
 * like a real dream cycle. The local fallback always preserves the
 * audit trail (memory_event + dream_lite log entries) and threads
 * `taskId` so the UI's live progress panel correlates them.
 */
router.post(
  "/memory/dream-lite/dispatch",
  requireOperator,
  async (req, res): Promise<void> => {
    const audit = getAuditContext(req);
    const parsed = CompressMemoryDreamLiteBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const windowMinutes = parsed.data.windowMinutes ?? 60;
    const intent = `kannaka dream --mode lite (window ${windowMinutes}m)`;
    const [task] = await db
      .insert(tasksTable)
      .values({
        id: nanoid(12),
        intent,
        requiredCapability: "dream",
        priority: 7,
        source: "operator:dream-lite",
        context: {
          mode: "lite",
          windowMinutes,
          trigger: audit.trigger,
          longRunningHint:
            "kannaka-prime dream cycles can take 5+ minutes on a bloated medium",
        },
        status: "pending",
      })
      .returning();
    await recordLog({
      eventType: "task_created",
      source: "operator",
      summary: `Dream Lite dispatched as task ${task.id} (capability=dream)`,
      metadata: {
        taskId: task.id,
        windowMinutes,
        longRunningHint: true,
      },
      audit,
    });
    broadcast({ type: "task_created", data: task });

    // Real dispatch path: publish on KANNAKA.dream.dispatch when NATS is
    // connected. We never route Dream Lite through `dispatchTask`/the
    // seeded `kannaka-prime` (kannaktopus_arm), because that arm type is
    // handled by `simulateLocalExecution` — a mock that would falsely
    // mark a dream cycle "completed" in seconds.
    const natsStatus = getNatsStatus();
    const natsClient = getNatsClient();
    let dispatched: Task = task;
    let publishOk = false;
    let publishError: string | null = null;
    if (natsStatus.state === "connected" && natsClient) {
      try {
        await natsClient.publish(SUBJECTS.DREAM_DISPATCH, {
          taskId: task.id,
          mode: "lite",
          windowMinutes,
          intent,
          trigger: audit.trigger,
          requestedAt: new Date().toISOString(),
        });
        publishOk = true;
        const [active] = await db
          .update(tasksTable)
          .set({ status: "active" })
          .where(eq(tasksTable.id, task.id))
          .returning();
        dispatched = active ?? task;
        await recordLog({
          eventType: "task_dispatched",
          source: "nats",
          summary: `Dream task ${task.id} published on ${SUBJECTS.DREAM_DISPATCH} — awaiting ${SUBJECTS.QUEEN_DREAM_END}`,
          metadata: {
            taskId: task.id,
            subject: SUBJECTS.DREAM_DISPATCH,
            windowMinutes,
          },
        });
        broadcast({ type: "task_assigned", data: dispatched });
      } catch (err) {
        publishError = (err as Error).message;
      }
    }

    // Local fallback: ALWAYS run when no real dispatch path succeeded.
    // This both preserves the prior compaction audit trail (memory_event
    // + dream_lite log) and gives the operator an immediate result even
    // when the swarm is unreachable. We thread `taskId` through so the
    // UI's live progress panel correlates the fallback with the
    // dispatched task.
    let localResult: Awaited<ReturnType<typeof runDreamLiteCompression>> | null = null;
    let note: string;
    if (publishOk) {
      note = `Dream task ${task.id} published on ${SUBJECTS.DREAM_DISPATCH}. Live progress will arrive on ${SUBJECTS.QUEEN_DREAM_START}/${SUBJECTS.QUEEN_DREAM_END} (5+ minutes is normal on a bloated medium).`;
    } else {
      const reason =
        publishError !== null
          ? `NATS publish failed: ${publishError}`
          : `NATS ${natsStatus.state} — no real dream-capable target reachable`;
      localResult = await runDreamLiteCompression({
        windowMinutes,
        trigger: `${audit.trigger} (${reason} — local fallback)`,
        taskId: task.id,
      });
      const [completed] = await db
        .update(tasksTable)
        .set({
          status: "completed",
          result:
            localResult.compactedCount > 0
              ? `Local Dream Lite fallback compressed ${localResult.compactedCount} memories into ${localResult.compressionEvent?.id ?? "(none)"}.`
              : `Local Dream Lite fallback ran — no approved memories in window.`,
        })
        .where(eq(tasksTable.id, task.id))
        .returning();
      dispatched = completed ?? task;
      await recordLog({
        eventType: "task_completed",
        source: "memory_keeper",
        summary: `Dream task ${task.id} completed via local fallback (${reason})`,
        metadata: {
          taskId: task.id,
          fallback: true,
          reason,
          compactedCount: localResult.compactedCount,
          compressionId: localResult.compressionEvent?.id ?? null,
        },
      });
      broadcast({ type: "task_completed", data: dispatched });
      note = `${reason}. Ran local Dream Lite compaction as fallback (${localResult.compactedCount} memories compressed). Connect kannaka-prime via NATS for the real HRM dream cycle.`;
    }

    res.json({
      task: dispatched,
      assignedArmId: dispatched.assignedArmId,
      dispatchPath: publishOk ? "nats" : "local-fallback",
      natsState: natsStatus.state,
      localFallback: localResult,
      note,
    });
  },
);

router.post(
  "/memory/:id/local-approve",
  requireOperator,
  async (req, res): Promise<void> => {
    const id = String(req.params.id);
    const updated = await markLocalApproved(id);
    if (!updated) {
      res.status(404).json({ error: "memory event not found" });
      return;
    }
    res.json(updated);
  },
);

router.post(
  "/memory/:id/absorb",
  requireOperator,
  async (req, res): Promise<void> => {
    const id = String(req.params.id);
    const result = await requestAbsorb(id);
    if (!result.event) {
      res.status(404).json({ error: "memory event not found" });
      return;
    }
    if (!result.publish.delivered) {
      // Not a hard 5xx — the event is persisted with absorb_state="failed"
      // and the operator can retry. 200 with a delivered=false body is more
      // useful for the UI than a 503.
      res.json(result);
      return;
    }
    res.json(result);
  },
);

router.post(
  "/memory/:id/exemplar/decide",
  requireOperator,
  async (req, res): Promise<void> => {
    const id = String(req.params.id);
    const parsed = DecideExemplarBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const result = await decideExemplar(id, parsed.data.outcome);
    if (!result.event) {
      res.status(404).json({ error: "memory event not found" });
      return;
    }
    res.json(result);
  },
);

// ---- Trace ---------------------------------------------------------------

interface TraceStep {
  kind:
    | "signal"
    | "task"
    | "resonance"
    | "resonance_response"
    | "memory"
    | "absorb_event"
    | "log";
  id: string;
  at: string;
  title: string;
  detail: string;
  metadata?: Record<string, unknown>;
}

router.get("/memory/:id/trace", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const [memory] = await db
    .select()
    .from(memoryEventsTable)
    .where(eq(memoryEventsTable.id, id))
    .limit(1);
  if (!memory) {
    res.status(404).json({ error: "memory event not found" });
    return;
  }

  const steps: TraceStep[] = [];

  // 1. Walk back to the source resonance + signal that opened it.
  let resonance: ResonanceField | null = null;
  let signal: Signal | null = null;
  let task: Task | null = null;
  let responses: ResonanceResponse[] = [];

  if (memory.sourceResonanceId) {
    const [r] = await db
      .select()
      .from(resonanceFieldsTable)
      .where(eq(resonanceFieldsTable.id, memory.sourceResonanceId))
      .limit(1);
    resonance = r ?? null;
  }
  if (memory.sourceTaskId) {
    const [t] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, memory.sourceTaskId))
      .limit(1);
    task = t ?? null;
  }
  if (resonance) {
    const [s] = await db
      .select()
      .from(signalsTable)
      .where(eq(signalsTable.derivedResonanceId, resonance.id))
      .limit(1);
    signal = s ?? null;
    responses = await db
      .select()
      .from(resonanceResponsesTable)
      .where(eq(resonanceResponsesTable.resonanceId, resonance.id))
      .orderBy(asc(resonanceResponsesTable.createdAt));
  }
  if (!signal && task) {
    const [s] = await db
      .select()
      .from(signalsTable)
      .where(eq(signalsTable.derivedTaskId, task.id))
      .limit(1);
    signal = s ?? null;
  }

  if (signal) {
    steps.push({
      kind: "signal",
      id: signal.id,
      at: signal.createdAt.toISOString(),
      title: `Signal ${signal.type}`,
      detail: signal.source ? `from ${signal.source}` : "no source",
      metadata: { status: signal.status },
    });
  }

  if (task) {
    steps.push({
      kind: "task",
      id: task.id,
      at: task.createdAt.toISOString(),
      title: `Task: ${task.intent}`,
      detail: `capability=${task.requiredCapability} status=${task.status}`,
      metadata: {
        assignedArmId: task.assignedArmId,
        result: task.result,
        error: task.error,
      },
    });
  }

  if (resonance) {
    steps.push({
      kind: "resonance",
      id: resonance.id,
      at: resonance.createdAt.toISOString(),
      title: `Resonance: ${resonance.intent}`,
      detail: `tags=${(resonance.tags ?? []).join(",")} status=${resonance.status}`,
      metadata: {
        priority: resonance.priority,
        selectedResponseId: resonance.selectedResponseId,
        coherenceScore: resonance.coherenceScore,
      },
    });
    for (const r of responses) {
      steps.push({
        kind: "resonance_response",
        id: r.id,
        at: r.createdAt.toISOString(),
        title: `Response from ${r.agentName ?? r.agentId}`,
        detail: r.output.length > 160 ? r.output.slice(0, 157) + "..." : r.output,
        metadata: { score: r.score, agentId: r.agentId },
      });
    }
  }

  steps.push({
    kind: "memory",
    id: memory.id,
    at: memory.createdAt.toISOString(),
    title: `Memory candidate: ${memory.tag}`,
    detail: `decision=${memory.decision} importance=${memory.importance.toFixed(2)} absorb=${memory.absorbState}`,
    metadata: {
      type: memory.type,
      tags: memory.tags,
      summary: memory.summary,
      inboundExemplar: memory.inboundExemplar,
      exemplarOutcome: memory.exemplarOutcome,
    },
  });

  // Absorb lifecycle from the audit log.
  const absorbEventTypes = [
    "memory_absorb_published",
    "memory_absorb_failed",
    "memory_absorbed",
    "memory_absorb_nack",
    "memory_local_approved",
    "memory_exemplar_pruned",
  ];
  const absorbLogs = await db
    .select()
    .from(logsTable)
    .where(
      and(
        inArray(logsTable.eventType, absorbEventTypes),
        or(
          sql`(${logsTable.metadata} ->> 'id') = ${memory.id}`,
          memory.idempotencyKey
            ? sql`(${logsTable.metadata} ->> 'idempotencyKey') = ${memory.idempotencyKey}`
            : sql`false`,
        ),
      ),
    )
    .orderBy(asc(logsTable.createdAt))
    .limit(50);
  for (const l of absorbLogs) {
    steps.push({
      kind: "absorb_event",
      id: l.id,
      at: l.createdAt.toISOString(),
      title: l.eventType,
      detail: l.summary,
      metadata: (l.metadata as Record<string, unknown>) ?? {},
    });
  }

  if (memory.absorbedAt) {
    steps.push({
      kind: "absorb_event",
      id: `${memory.id}-absorbed`,
      at: memory.absorbedAt.toISOString(),
      title: "HRM ack: absorbed",
      detail: `absorb_state=absorbed key=${memory.idempotencyKey ?? memory.contentHash}`,
      metadata: { absorbedAt: memory.absorbedAt.toISOString() },
    });
  }

  res.json({
    memoryId: memory.id,
    summary: {
      hasSignal: !!signal,
      hasTask: !!task,
      hasResonance: !!resonance,
      responseCount: responses.length,
      absorbState: memory.absorbState,
      absorbedAt: memory.absorbedAt ? memory.absorbedAt.toISOString() : null,
      idempotencyKey: memory.idempotencyKey,
    },
    steps,
  });
});

export default router;
