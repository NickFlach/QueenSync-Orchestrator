import { Router, type IRouter } from "express";
import { eq, gte, sql } from "drizzle-orm";
import {
  db,
  armsTable,
  tasksTable,
  signalsTable,
  memoryEventsTable,
  resonanceFieldsTable,
} from "@workspace/db";
import { observatoryHealth, radioHealth } from "../lib/adapters";
import { getNatsStatus } from "../lib/nats-bridge";

const router: IRouter = Router();

router.get("/summary", async (_req, res): Promise<void> => {
  const since = new Date(Date.now() - 1000 * 60 * 60);

  // Aggregate arm counts in SQL instead of pulling every row and filtering
  // in JS. Same for tasks. Then fan out every read in parallel — previously
  // the handler ran 6 sequential queries plus 2 health checks.
  const armsByStatusP = db
    .select({
      status: armsTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(armsTable)
    .groupBy(armsTable.status);

  const tasksByStatusP = db
    .select({
      status: tasksTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(tasksTable)
    .groupBy(tasksTable.status);

  const memApprovalsP = db
    .select({ count: sql<number>`count(*)::int` })
    .from(memoryEventsTable)
    .where(eq(memoryEventsTable.decision, "approved"));

  const recentSignalsP = db
    .select({ count: sql<number>`count(*)::int` })
    .from(signalsTable)
    .where(gte(signalsTable.createdAt, since));

  const activeResP = db
    .select({ count: sql<number>`count(*)::int` })
    .from(resonanceFieldsTable)
    .where(eq(resonanceFieldsTable.status, "active"));

  const [
    armsByStatus,
    tasksByStatus,
    memApprovals,
    recentSignals,
    activeRes,
    radio,
    obs,
  ] = await Promise.all([
    armsByStatusP,
    tasksByStatusP,
    memApprovalsP,
    recentSignalsP,
    activeResP,
    radioHealth(),
    observatoryHealth(),
  ]);

  let activeArms = 0;
  let totalArms = 0;
  for (const row of armsByStatus) {
    totalArms += row.count;
    if (row.status === "idle" || row.status === "busy") activeArms += row.count;
  }

  let queuedTasks = 0;
  let completedTasks = 0;
  let failedTasks = 0;
  for (const row of tasksByStatus) {
    if (row.status === "pending" || row.status === "active")
      queuedTasks += row.count;
    else if (row.status === "completed") completedTasks = row.count;
    else if (row.status === "failed") failedTasks = row.count;
  }

  res.json({
    activeArms,
    totalArms,
    queuedTasks,
    completedTasks,
    failedTasks,
    memoryApprovals: memApprovals[0]?.count ?? 0,
    recentSignals: recentSignals[0]?.count ?? 0,
    activeResonance: activeRes[0]?.count ?? 0,
    radioStatus: radio.mode === "live" ? "live" : "mock",
    observatoryStatus: obs.mode === "live" ? "live" : "mock",
    nats: getNatsStatus(),
  });
});

export default router;
