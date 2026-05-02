import { Router, type IRouter } from "express";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, logsTable, tasksTable, type Task } from "@workspace/db";

const router: IRouter = Router();

const ORACLE_ADMIN_CAPABILITIES = [
  "restart_radio",
  "restart_observatory",
  "trigger_oration_now",
  "setOverride",
  "dream_trigger",
  "kannaka_status",
] as const;

const PRIVILEGED_DISPATCH_LIMIT = 100;
const DEFAULT_RECENT_WINDOW_MS = 60 * 60 * 1000;
const MAX_RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

router.get("/logs", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(logsTable)
    .orderBy(desc(logsTable.createdAt))
    .limit(200);
  res.json(rows);
});

router.get(
  "/logs/privileged-dispatches/recent-stats",
  async (req, res): Promise<void> => {
    const raw = Number(req.query.windowMs);
    const windowMs =
      Number.isFinite(raw) && raw > 0
        ? Math.min(raw, MAX_RECENT_WINDOW_MS)
        : DEFAULT_RECENT_WINDOW_MS;
    const since = new Date(Date.now() - windowMs);

    const rows = await db
      .select({
        status: tasksTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(tasksTable)
      .where(
        and(
          inArray(tasksTable.requiredCapability, [
            ...ORACLE_ADMIN_CAPABILITIES,
          ]),
          gte(tasksTable.createdAt, since),
        ),
      )
      .groupBy(tasksTable.status);

    let succeeded = 0;
    let failed = 0;
    let inFlight = 0;
    for (const r of rows) {
      if (r.status === "completed") succeeded += r.count;
      else if (r.status === "failed") failed += r.count;
      else inFlight += r.count;
    }

    res.json({ windowMs, succeeded, failed, inFlight });
  },
);

router.get("/logs/privileged-dispatches", async (_req, res): Promise<void> => {
  const tasks: Task[] = await db
    .select()
    .from(tasksTable)
    .where(inArray(tasksTable.requiredCapability, [...ORACLE_ADMIN_CAPABILITIES]))
    .orderBy(desc(tasksTable.createdAt))
    .limit(PRIVILEGED_DISPATCH_LIMIT);

  if (tasks.length === 0) {
    res.json([]);
    return;
  }

  const taskIds = tasks.map((t) => t.id);
  const creationLogs = await db
    .select()
    .from(logsTable)
    .where(
      and(
        eq(logsTable.eventType, "task_created"),
        inArray(sql`(metadata->>'taskId')`, taskIds),
      ),
    );

  const actorByTaskId = new Map<
    string,
    { actor: string | null; ip: string | null; trigger: string | null }
  >();
  for (const log of creationLogs) {
    const meta = (log.metadata ?? {}) as Record<string, unknown>;
    const id = typeof meta["taskId"] === "string" ? meta["taskId"] : null;
    if (!id || actorByTaskId.has(id)) continue;
    actorByTaskId.set(id, {
      actor: typeof meta["actor"] === "string" ? meta["actor"] : null,
      ip: typeof meta["ip"] === "string" ? meta["ip"] : null,
      trigger: typeof meta["trigger"] === "string" ? meta["trigger"] : null,
    });
  }

  const enriched = tasks.map((t) => {
    const audit = actorByTaskId.get(t.id) ?? {
      actor: null,
      ip: null,
      trigger: null,
    };
    return {
      id: t.id,
      intent: t.intent,
      requiredCapability: t.requiredCapability,
      priority: t.priority,
      source: t.source,
      status: t.status,
      assignedArmId: t.assignedArmId,
      result: t.result,
      error: t.error,
      actor: audit.actor,
      ip: audit.ip,
      trigger: audit.trigger,
      context: t.context,
      retryCount: t.retryCount,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  });

  res.json(enriched);
});

export default router;
