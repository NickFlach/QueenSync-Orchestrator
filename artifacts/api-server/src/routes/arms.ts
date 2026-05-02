import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  db,
  armsTable,
  tasksTable,
  memoryEventsTable,
} from "@workspace/db";
import { OnboardArmBody } from "@workspace/api-zod";
import { recordLog } from "../lib/log";
import { broadcast } from "../lib/ws";
import { validateOutboundUrl, logBlockedUrl } from "../lib/url-guard";
import { safeFetch, BlockedUrlError } from "../lib/safe-fetch";
import { requireOperator } from "../lib/auth";
import { SUBJECTS } from "@workspace/nats";
import { getNatsClient, getNatsStatus } from "../lib/nats-bridge";

const router: IRouter = Router();

router.get("/arms", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(armsTable)
    .orderBy(desc(armsTable.createdAt));
  res.json(rows);
});

router.post("/arms", requireOperator, async (req, res): Promise<void> => {
  const parsed = OnboardArmBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;
  for (const [field, value] of [
    ["endpointUrl", body.endpointUrl],
    ["heartbeatUrl", body.heartbeatUrl],
  ] as const) {
    if (value == null || value === "") continue;
    const guard = validateOutboundUrl(value);
    if (!guard.ok) {
      logBlockedUrl(`onboard:${field}`, value, guard.reason ?? "blocked");
      res.status(400).json({
        error: `Invalid ${field}: ${guard.reason}`,
        field,
      });
      return;
    }
  }
  const [row] = await db
    .insert(armsTable)
    .values({
      id: nanoid(12),
      name: body.name,
      type: body.type,
      capabilities: body.capabilities,
      endpointUrl: body.endpointUrl ?? null,
      heartbeatUrl: body.heartbeatUrl ?? null,
      authMethod: body.authMethod,
      description: body.description ?? null,
      resonanceTags: body.resonanceTags ?? [],
      resonanceSensitivity: body.resonanceSensitivity ?? 0.5,
      resonanceMode: (body.resonanceMode as string | undefined) ?? "auto",
      status: "idle",
    })
    .returning();
  await recordLog({
    eventType: "arm_registered",
    source: row.id,
    summary: `Arm ${row.name} registered (${row.type})`,
    metadata: { armId: row.id, capabilities: row.capabilities },
  });
  broadcast({ type: "arm_registered", data: row });
  broadcast({ type: "arms_updated", data: { armId: row.id, status: "idle" } });
  res.status(201).json(row);
});

router.get("/arms/:id", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const [arm] = await db.select().from(armsTable).where(eq(armsTable.id, id));
  if (!arm) {
    res.status(404).json({ error: "arm not found" });
    return;
  }
  const recentTasks = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.assignedArmId, id))
    .orderBy(desc(tasksTable.createdAt))
    .limit(10);
  const memoryRows = await db
    .select()
    .from(memoryEventsTable)
    .where(eq(memoryEventsTable.agentId, id));
  res.json({
    ...arm,
    recentTasks,
    memoryContributionCount: memoryRows.length,
  });
});

router.delete("/arms/:id", requireOperator, async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const [removed] = await db
    .delete(armsTable)
    .where(eq(armsTable.id, id))
    .returning();
  if (!removed) {
    res.status(404).json({ error: "arm not found" });
    return;
  }
  await recordLog({
    eventType: "arm_removed",
    source: id,
    summary: `Arm ${removed.name} removed`,
    metadata: { armId: id },
  });
  broadcast({ type: "arm_removed", data: { armId: id, name: removed.name } });
  broadcast({ type: "arms_updated", data: { armId: id, status: "removed" } });
  res.sendStatus(204);
});

router.post("/arms/:id/heartbeat", requireOperator, async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const [updated] = await db
    .update(armsTable)
    .set({
      lastHeartbeat: new Date(),
      status: "idle",
    })
    .where(eq(armsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "arm not found" });
    return;
  }
  await recordLog({
    eventType: "heartbeat",
    source: id,
    summary: `Heartbeat from ${updated.name}`,
    metadata: { armId: id },
  });
  broadcast({ type: "arms_updated", data: { armId: id, status: "idle" } });
  res.json(updated);
});

// Arms whose `resonanceTags` include this marker are probed via NATS
// REQ/REPLY on `KANNAKA.ask.<id>` first; HTTPS is used as fallback.
const NATS_REACHABLE_TAG = "nats";

function armIsNatsReachable(arm: { resonanceTags: string[]; type: string }): boolean {
  if (arm.resonanceTags.includes(NATS_REACHABLE_TAG)) return true;
  // Real Kannaktopus arms live on the constellation bus by default.
  return arm.type === "kannaktopus_arm";
}

router.post("/arms/:id/test-connection", requireOperator, async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const [arm] = await db.select().from(armsTable).where(eq(armsTable.id, id));
  if (!arm) {
    res.status(404).json({ error: "arm not found" });
    return;
  }

  // Try NATS REQ/REPLY first when the arm is flagged NATS-reachable AND
  // our subscriber is actually connected. Falls through to HTTPS otherwise.
  const natsClient = getNatsClient();
  const natsState = getNatsStatus().state;
  if (armIsNatsReachable(arm) && natsClient && natsState === "connected") {
    const subject = `${SUBJECTS.ASK_PREFIX}.${arm.id}`;
    const start = Date.now();
    try {
      const reply = await natsClient.request(
        subject,
        { ping: true, ts: Date.now() },
        { timeoutMs: 2000 },
      );
      res.json({
        ok: true,
        message: `Reached ${arm.name} via NATS (${subject})`,
        latencyMs: Date.now() - start,
        method: "nats",
        replyData: reply.data,
      });
      return;
    } catch (err) {
      // Fall through to HTTPS — record the NATS failure so the operator
      // can see why we degraded.
      const natsErr = (err as Error).message;
      const targetUrl = arm.heartbeatUrl ?? arm.endpointUrl;
      if (!targetUrl) {
        res.json({
          ok: false,
          message: `NATS request to ${subject} failed: ${natsErr} — no HTTPS fallback configured`,
          latencyMs: Date.now() - start,
          method: "nats",
        });
        return;
      }
      // continue with HTTPS probe below
    }
  }

  const targetUrl = arm.heartbeatUrl ?? arm.endpointUrl;
  if (!targetUrl) {
    res.json({
      ok: true,
      message: `${arm.name} is local — no endpoint to probe.`,
      latencyMs: 0,
      method: "local",
    });
    return;
  }
  const guard = validateOutboundUrl(targetUrl);
  if (!guard.ok) {
    logBlockedUrl("test-connection", targetUrl, guard.reason ?? "blocked");
    res.status(400).json({
      ok: false,
      message: `Refused to probe ${targetUrl}: ${guard.reason}`,
      latencyMs: 0,
      method: "https",
    });
    return;
  }
  const start = Date.now();
  try {
    const r = await safeFetch(targetUrl, {
      signal: AbortSignal.timeout(4000),
      context: "test-connection",
    });
    res.json({
      ok: r.ok,
      message: r.ok
        ? `Reached ${targetUrl} (${r.status})`
        : `Endpoint responded ${r.status}`,
      latencyMs: Date.now() - start,
      method: "https",
    });
  } catch (err) {
    if (err instanceof BlockedUrlError) {
      res.status(400).json({
        ok: false,
        message: `Refused to probe ${targetUrl}: ${err.reason}`,
        latencyMs: Date.now() - start,
        method: "https",
      });
      return;
    }
    res.json({
      ok: false,
      message: `Unreachable: ${(err as Error).message}`,
      latencyMs: Date.now() - start,
      method: "https",
    });
  }
});

export default router;
