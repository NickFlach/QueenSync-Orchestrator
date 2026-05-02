import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, signalsTable, tasksTable, resonanceFieldsTable } from "@workspace/db";
import { InjectSignalBody } from "@workspace/api-zod";
import { recordLog } from "../lib/log";
import { broadcast } from "../lib/ws";
import { dispatchTask } from "../lib/router";
import { autoLocalResonance } from "../lib/resonance";
import { requireOperator } from "../lib/auth";

const router: IRouter = Router();

router.get("/signals", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(signalsTable)
    .orderBy(desc(signalsTable.createdAt));
  res.json(rows);
});

router.post("/signals", requireOperator, async (req, res): Promise<void> => {
  const parsed = InjectSignalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;
  const [signal] = await db
    .insert(signalsTable)
    .values({
      id: nanoid(12),
      type: body.type,
      source: body.source ?? null,
      payload: body.payload ?? {},
      status: "received",
    })
    .returning();
  await recordLog({
    eventType: "signal_received",
    source: body.source ?? null,
    summary: `Signal received: ${body.type}`,
    metadata: { signalId: signal.id, type: body.type },
  });
  broadcast({ type: "signal_received", data: signal });

  // Canonical signal -> task conversion. Every signal becomes a routable task
  // with an inferred capability; the more "resonant" types ALSO open a
  // resonance field so multiple arms can respond.
  const SIGNAL_CAPABILITY: Record<string, string> = {
    build_request: "build",
    radio_transmission: "transmit",
    openclaw_artifact: "artifact",
    memory_anomaly: "audit",
    governance_alert: "audit",
    observation_event: "observe",
    other: "build",
  };
  const RESONANCE_TYPES = new Set([
    "memory_anomaly",
    "governance_alert",
    "observation_event",
  ]);

  const summary =
    typeof body.payload?.summary === "string"
      ? (body.payload.summary as string)
      : typeof body.payload?.intent === "string"
        ? (body.payload.intent as string)
        : `Handle ${body.type}`;
  const capability =
    typeof body.payload?.capability === "string"
      ? (body.payload.capability as string)
      : (SIGNAL_CAPABILITY[body.type] ?? "build");

  const [task] = await db
    .insert(tasksTable)
    .values({
      id: nanoid(12),
      intent: summary,
      requiredCapability: capability,
      priority: 6,
      source: `signal:${body.type}`,
      context: body.payload ?? {},
      status: "pending",
    })
    .returning();
  await db
    .update(signalsTable)
    .set({ status: "converted", derivedTaskId: task.id })
    .where(eq(signalsTable.id, signal.id));
  await recordLog({
    eventType: "task_created",
    source: signal.id,
    summary: `Task derived from signal ${signal.id} (${body.type} -> ${capability})`,
    metadata: { taskId: task.id, signalId: signal.id, capability },
  });
  broadcast({ type: "task_created", data: task });
  await dispatchTask(task);

  if (RESONANCE_TYPES.has(body.type)) {
    const intent =
      typeof body.payload?.intent === "string"
        ? (body.payload.intent as string)
        : summary;
    // Per ADR-002 Wave 1: adapter-style signals injected manually (radio /
    // observatory / governance / memory anomaly) carry the same base tag
    // vocabulary the live adapters emit so resonance fields read the same
    // way regardless of how they were opened.
    const ADAPTER_BASE_TAGS: Record<string, string[]> = {
      radio_transmission: ["radio", "signal", "analysis"],
      observation_event: ["observation", "anomaly", "pattern"],
      memory_anomaly: ["observation", "anomaly", "audit"],
      governance_alert: ["observation", "anomaly", "audit"],
    };
    const customTags = Array.isArray(body.payload?.tags)
      ? (body.payload.tags as string[])
      : [];
    const baseTags = ADAPTER_BASE_TAGS[body.type] ?? [body.type, capability];
    const tags = Array.from(new Set([...baseTags, ...customTags, capability]));
    const [field] = await db
      .insert(resonanceFieldsTable)
      .values({
        id: nanoid(12),
        intent,
        tags,
        priority: 0.7,
        constraints: { ...(body.payload ?? {}), signalId: signal.id, taskId: task.id },
        status: "active",
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    await db
      .update(signalsTable)
      .set({ derivedResonanceId: field.id })
      .where(eq(signalsTable.id, signal.id));
    await recordLog({
      eventType: "resonance_created",
      source: signal.id,
      summary: `Resonance derived from signal ${signal.id}`,
      metadata: { resonanceId: field.id, signalId: signal.id },
    });
    broadcast({ type: "resonance_created", data: { ...field, responses: [] } });
    void autoLocalResonance(field);
  }

  const [refreshed] = await db
    .select()
    .from(signalsTable)
    .where(eq(signalsTable.id, signal.id));
  res.status(201).json(refreshed);
});

export default router;
