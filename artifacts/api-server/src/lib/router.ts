import { eq } from "drizzle-orm";
import { db, armsTable, tasksTable, type Task, type Arm } from "@workspace/db";
import { recordLog } from "./log";
import { broadcast } from "./ws";
import { evaluateMemory } from "./memory-gate";
import { logger } from "./logger";

export async function pickArmForCapability(
  requiredCapability: string,
): Promise<string | null> {
  const arms = await db.select().from(armsTable);
  const candidates = arms.filter(
    (arm) =>
      arm.status !== "offline" &&
      arm.status !== "failed" &&
      arm.capabilities.includes(requiredCapability),
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const score = (arm: (typeof candidates)[number]) => {
      let s = 0;
      if (arm.status === "idle") s += 2;
      if (arm.status === "pending") s += 1;
      if (arm.lastHeartbeat) s += 1;
      return s;
    };
    return score(b) - score(a);
  });
  return candidates[0].id;
}

export async function dispatchTask(task: Task): Promise<Task> {
  const armId = await pickArmForCapability(task.requiredCapability);
  if (!armId) {
    await recordLog({
      eventType: "task_pending",
      source: task.source,
      summary: `Task ${task.id} pending — no arm with capability ${task.requiredCapability}`,
      metadata: { taskId: task.id },
    });
    broadcast({ type: "task_updated", data: task });
    return task;
  }

  const [updated] = await db
    .update(tasksTable)
    .set({ status: "active", assignedArmId: armId })
    .where(eq(tasksTable.id, task.id))
    .returning();

  await db
    .update(armsTable)
    .set({ status: "busy" })
    .where(eq(armsTable.id, armId));

  await recordLog({
    eventType: "task_assigned",
    source: armId,
    summary: `Task ${task.id} assigned to ${armId}`,
    metadata: { taskId: task.id, armId },
  });
  broadcast({ type: "task_assigned", data: updated });
  broadcast({ type: "arms_updated", data: { armId, status: "busy" } });

  const [arm] = await db
    .select()
    .from(armsTable)
    .where(eq(armsTable.id, armId));
  if (!arm) return updated;

  if (arm.type === "external_webhook") {
    if (arm.endpointUrl) {
      void dispatchExternal(updated, arm);
    } else {
      void failTask(
        updated,
        arm,
        "External webhook arm has no endpointUrl configured.",
      );
    }
  } else if (arm.type === "local_simulated" || arm.type === "kannaktopus_arm") {
    void simulateLocalExecution(updated, arm);
  } else {
    // api / openclaw / mcp / human_configured / replit_hosted etc:
    // dispatch externally if endpoint provided, otherwise mock-callback so the
    // task does not get stuck in active state.
    if (arm.endpointUrl) {
      void dispatchExternal(updated, arm);
    } else {
      void mockCallback(updated, arm, true);
    }
  }

  return updated;
}

async function failTask(task: Task, arm: Arm, reason: string) {
  const [failed] = await db
    .update(tasksTable)
    .set({ status: "failed", result: reason })
    .where(eq(tasksTable.id, task.id))
    .returning();
  await db
    .update(armsTable)
    .set({ status: "idle" })
    .where(eq(armsTable.id, arm.id));
  await recordLog({
    eventType: "task_failed",
    source: arm.id,
    summary: `Task ${task.id} failed: ${reason}`,
    metadata: { taskId: task.id, armId: arm.id },
  });
  broadcast({ type: "task_completed", data: failed });
  broadcast({ type: "arms_updated", data: { armId: arm.id, status: "idle" } });
}

function callbackUrlFor(taskId: string): string {
  const base =
    process.env["QUEENSYNC_PUBLIC_BASE_URL"] ?? "http://localhost:8080";
  return `${base.replace(/\/$/, "")}/api/tasks/${taskId}/callback`;
}

async function dispatchExternal(task: Task, arm: Arm) {
  if (!arm.endpointUrl) return;
  const callbackUrl = callbackUrlFor(task.id);
  const payload = {
    taskId: task.id,
    intent: task.intent,
    requiredCapability: task.requiredCapability,
    priority: task.priority,
    context: task.context,
    callbackUrl,
    armId: arm.id,
  };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (arm.authMethod === "bearer" && process.env["QUEENSYNC_API_KEY"]) {
    headers["Authorization"] = `Bearer ${process.env["QUEENSYNC_API_KEY"]}`;
  }
  try {
    const r = await fetch(arm.endpointUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    await recordLog({
      eventType: r.ok ? "task_dispatched" : "task_dispatch_failed",
      source: arm.id,
      summary: r.ok
        ? `Task ${task.id} dispatched to ${arm.name} at ${arm.endpointUrl} (HTTP ${r.status})`
        : `Dispatch to ${arm.name} returned HTTP ${r.status}`,
      metadata: { taskId: task.id, armId: arm.id, status: r.status },
    });
    if (!r.ok) {
      void mockCallback(task, arm, true);
    }
  } catch (err) {
    logger.warn({ err, armId: arm.id }, "external dispatch failed; using mock callback");
    await recordLog({
      eventType: "task_dispatch_failed",
      source: arm.id,
      summary: `Dispatch to ${arm.name} failed: ${(err as Error).message}`,
      metadata: { taskId: task.id, armId: arm.id },
    });
    void mockCallback(task, arm, true);
  }
}

async function mockCallback(task: Task, arm: Arm, useMock: boolean) {
  if (!useMock) return;
  const delay = 600 + Math.floor(Math.random() * 1200);
  await new Promise((r) => setTimeout(r, delay));
  const result = `[mock] ${arm.name} acknowledged "${task.intent}" via ${arm.endpointUrl}.`;
  await completeTask(task, arm, result);
}

async function simulateLocalExecution(task: Task, arm: Arm) {
  const delay = 800 + Math.floor(Math.random() * 1200);
  await new Promise((r) => setTimeout(r, delay));
  const result = `${arm.name} executed "${task.intent}" using ${task.requiredCapability}.`;
  await completeTask(task, arm, result);
}

async function completeTask(task: Task, arm: Arm, result: string) {
  const [done] = await db
    .update(tasksTable)
    .set({ status: "completed", result })
    .where(eq(tasksTable.id, task.id))
    .returning();
  await db
    .update(armsTable)
    .set({ status: "idle", lastHeartbeat: new Date() })
    .where(eq(armsTable.id, arm.id));
  await recordLog({
    eventType: "task_completed",
    source: arm.id,
    summary: `Task ${task.id} completed by ${arm.name}`,
    metadata: { taskId: task.id, armId: arm.id },
  });
  broadcast({ type: "task_completed", data: done });
  broadcast({ type: "arms_updated", data: { armId: arm.id, status: "idle" } });
  await evaluateMemory({
    type: "agent_output",
    content: result,
    agentId: arm.id,
    sourceTaskId: task.id,
  });
}
