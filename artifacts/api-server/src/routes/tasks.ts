import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, tasksTable, armsTable } from "@workspace/db";
import { CreateTaskBody, TaskCallbackBody } from "@workspace/api-zod";
import { recordLog } from "../lib/log";
import { broadcast } from "../lib/ws";
import { dispatchTask } from "../lib/router";
import { evaluateMemory } from "../lib/memory-gate";

const router: IRouter = Router();

router.get("/tasks", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(tasksTable)
    .orderBy(desc(tasksTable.createdAt));
  res.json(rows);
});

router.post("/tasks", async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;
  const [row] = await db
    .insert(tasksTable)
    .values({
      id: nanoid(12),
      intent: body.intent,
      requiredCapability: body.requiredCapability,
      priority: body.priority ?? 5,
      source: body.source ?? "user",
      context: body.context ?? {},
      status: "pending",
    })
    .returning();
  await recordLog({
    eventType: "task_created",
    source: row.source,
    summary: `Task created: ${row.intent}`,
    metadata: { taskId: row.id },
  });
  broadcast({ kind: "task", data: row });
  const dispatched = await dispatchTask(row);
  res.status(201).json(dispatched);
});

router.get("/tasks/:id", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, id));
  if (!task) {
    res.status(404).json({ error: "task not found" });
    return;
  }
  res.json(task);
});

router.post("/tasks/:id/retry", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, id));
  if (!task) {
    res.status(404).json({ error: "task not found" });
    return;
  }
  const [reset] = await db
    .update(tasksTable)
    .set({
      status: "pending",
      assignedArmId: null,
      error: null,
      result: null,
      retryCount: task.retryCount + 1,
    })
    .where(eq(tasksTable.id, id))
    .returning();
  const dispatched = await dispatchTask(reset);
  res.json(dispatched);
});

router.post("/tasks/:id/callback", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const parsed = TaskCallbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, id));
  if (!task) {
    res.status(404).json({ error: "task not found" });
    return;
  }
  const [updated] = await db
    .update(tasksTable)
    .set({
      status: body.status,
      result: body.result ?? null,
      error: body.error ?? null,
    })
    .where(eq(tasksTable.id, id))
    .returning();
  if (task.assignedArmId) {
    await db
      .update(armsTable)
      .set({ status: "idle", lastHeartbeat: new Date() })
      .where(eq(armsTable.id, task.assignedArmId));
  }
  await recordLog({
    eventType: body.status === "completed" ? "task_completed" : "task_failed",
    source: task.assignedArmId ?? null,
    summary:
      body.status === "completed"
        ? `Task ${id} completed via callback`
        : `Task ${id} failed via callback: ${body.error ?? ""}`,
    metadata: { taskId: id },
  });
  broadcast({ kind: "task", data: updated });
  if (body.status === "completed" && body.result) {
    await evaluateMemory({
      type: "agent_output",
      content: body.result,
      agentId: task.assignedArmId ?? null,
      sourceTaskId: id,
    });
  }
  res.json(updated);
});

export default router;
