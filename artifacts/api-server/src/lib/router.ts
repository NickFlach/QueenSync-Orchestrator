import { eq } from "drizzle-orm";
import { db, armsTable, tasksTable, type Task, type Arm } from "@workspace/db";
import { recordLog } from "./log";
import { broadcast } from "./ws";
import { evaluateMemory } from "./memory-gate";
import { logger } from "./logger";
import {
  applyArmAuthHeaders,
  isOracleAdminSigningConfigured,
  ORACLE_ADMIN_SIGNATURE_HEADER,
  ORACLE_ADMIN_TIMESTAMP_HEADER,
  signCallback,
  signOracleAdminBody,
} from "./auth";
import { safeFetch, BlockedUrlError } from "./safe-fetch";

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

  if (arm.type === "external_webhook" || arm.type === "oracle_admin") {
    if (arm.endpointUrl) {
      void dispatchExternal(updated, arm);
    } else {
      void failTask(
        updated,
        arm,
        `${arm.type} arm has no endpointUrl configured.`,
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
  broadcast({ type: "task_failed", data: failed });
  broadcast({ type: "arms_updated", data: { armId: arm.id, status: "idle" } });
}

function callbackUrlFor(taskId: string): string {
  const base =
    process.env["QUEENSYNC_BASE_URL"] ??
    process.env["QUEENSYNC_PUBLIC_BASE_URL"] ??
    "http://localhost:8080";
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
  applyArmAuthHeaders(arm.authMethod, headers);
  // Provide HMAC the receiving arm should echo on its callback so we can
  // accept it via /api/tasks/:id/callback. Successful callback must match.
  const completedSig = signCallback(task.id, "completed");
  const failedSig = signCallback(task.id, "failed");
  if (completedSig && failedSig) {
    headers["X-QueenSync-Completed-Signature"] = completedSig;
    headers["X-QueenSync-Failed-Signature"] = failedSig;
  }
  const body = JSON.stringify(payload);
  // For the oracle-admin shim, sign the request body with HMAC-SHA256
  // (timestamp + ":" + body) so the privileged shim can refuse forged
  // dispatches. Falls back to unsigned + a warning when the secret is unset.
  if (arm.type === "oracle_admin") {
    if (isOracleAdminSigningConfigured()) {
      const sig = signOracleAdminBody(body);
      if (sig) {
        headers[ORACLE_ADMIN_TIMESTAMP_HEADER] = sig.timestamp;
        headers[ORACLE_ADMIN_SIGNATURE_HEADER] = sig.signature;
      }
    } else {
      logger.warn(
        { armId: arm.id, taskId: task.id },
        "dispatching to oracle_admin arm without HMAC signature — set QUEENSYNC_ORACLE_ADMIN_HMAC_SECRET",
      );
    }
  }
  try {
    // safeFetch validates the URL (SSRF guard) and disables redirect
    // following — same hardening the heartbeat probe uses.
    const r = await safeFetch(arm.endpointUrl, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(5000),
      context: `dispatch:${arm.id}`,
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
      // Privileged arms must NEVER be marked completed via the mock fallback
      // — that would let a 4xx/5xx from a privileged shim look like a
      // successful restart. Fail loudly instead.
      if (arm.type === "oracle_admin") {
        await failTask(
          task,
          arm,
          `Dispatch to ${arm.name} returned HTTP ${r.status}`,
        );
      } else {
        void mockCallback(task, arm, true);
      }
    }
  } catch (err) {
    const blocked = err instanceof BlockedUrlError;
    const msg = blocked
      ? `Refused to dispatch to ${arm.endpointUrl}: ${(err as BlockedUrlError).reason}`
      : (err as Error).message;
    logger.warn({ err, armId: arm.id, blocked }, "external dispatch failed");
    await recordLog({
      eventType: "task_dispatch_failed",
      source: arm.id,
      summary: `Dispatch to ${arm.name} failed: ${msg}`,
      metadata: { taskId: task.id, armId: arm.id, blocked },
    });
    // SSRF-blocked URLs and privileged-arm failures never fall back to
    // the mock-completion path.
    if (blocked || arm.type === "oracle_admin") {
      await failTask(task, arm, `Dispatch to ${arm.name} failed: ${msg}`);
    } else {
      void mockCallback(task, arm, true);
    }
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
