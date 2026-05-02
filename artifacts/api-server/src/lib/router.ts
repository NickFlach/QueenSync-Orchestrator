import { eq } from "drizzle-orm";
import { db, armsTable, tasksTable, type Task } from "@workspace/db";
import { recordLog } from "./log";
import { broadcast } from "./ws";
import { evaluateMemory } from "./memory-gate";

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
      eventType: "task_created",
      source: task.source,
      summary: `Task ${task.id} pending — no arm with capability ${task.requiredCapability}`,
      metadata: { taskId: task.id },
    });
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
  broadcast({ kind: "task", data: updated });

  void simulateLocalExecution(updated);

  return updated;
}

async function simulateLocalExecution(task: Task) {
  if (!task.assignedArmId) return;
  const [arm] = await db
    .select()
    .from(armsTable)
    .where(eq(armsTable.id, task.assignedArmId));
  if (!arm) return;
  if (arm.type !== "local_simulated" && arm.type !== "kannaktopus_arm") return;

  const delay = 800 + Math.floor(Math.random() * 1200);
  await new Promise((r) => setTimeout(r, delay));

  const result = `${arm.name} executed "${task.intent}" using ${task.requiredCapability}.`;
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
  broadcast({ kind: "task", data: done });
  await evaluateMemory({
    type: "agent_output",
    content: result,
    agentId: arm.id,
    sourceTaskId: task.id,
  });
}
