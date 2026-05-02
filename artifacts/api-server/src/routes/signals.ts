import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, signalsTable, tasksTable, resonanceFieldsTable } from "@workspace/db";
import { InjectSignalBody } from "@workspace/api-zod";
import { recordLog } from "../lib/log";
import { broadcast } from "../lib/ws";
import { dispatchTask } from "../lib/router";
import { autoLocalResonance } from "../lib/resonance";

const router: IRouter = Router();

router.get("/signals", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(signalsTable)
    .orderBy(desc(signalsTable.createdAt));
  res.json(rows);
});

router.post("/signals", async (req, res): Promise<void> => {
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
  broadcast({ kind: "signal", data: signal });

  // Convert signal -> task or resonance based on type
  if (body.type === "build_request") {
    const summary =
      typeof body.payload?.summary === "string"
        ? (body.payload.summary as string)
        : `Handle ${body.type}`;
    const capability =
      typeof body.payload?.capability === "string"
        ? (body.payload.capability as string)
        : "build";
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
      summary: `Task derived from signal ${signal.id}`,
      metadata: { taskId: task.id, signalId: signal.id },
    });
    await dispatchTask(task);
  } else if (
    body.type === "memory_anomaly" ||
    body.type === "governance_alert" ||
    body.type === "observation_event"
  ) {
    const intent =
      typeof body.payload?.intent === "string"
        ? (body.payload.intent as string)
        : `Resonate on ${body.type}`;
    const tags = Array.isArray(body.payload?.tags)
      ? (body.payload.tags as string[])
      : [body.type];
    const [field] = await db
      .insert(resonanceFieldsTable)
      .values({
        id: nanoid(12),
        intent,
        tags,
        priority: 0.7,
        constraints: body.payload ?? {},
        status: "active",
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    await db
      .update(signalsTable)
      .set({ status: "converted", derivedResonanceId: field.id })
      .where(eq(signalsTable.id, signal.id));
    await recordLog({
      eventType: "resonance_created",
      source: signal.id,
      summary: `Resonance derived from signal ${signal.id}`,
      metadata: { resonanceId: field.id, signalId: signal.id },
    });
    void autoLocalResonance(field);
  }

  const [refreshed] = await db
    .select()
    .from(signalsTable)
    .where(eq(signalsTable.id, signal.id));
  res.status(201).json(refreshed);
});

export default router;
