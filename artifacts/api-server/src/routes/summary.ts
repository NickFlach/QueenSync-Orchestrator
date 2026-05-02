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
  const arms = await db.select().from(armsTable);
  const activeArms = arms.filter(
    (a) => a.status === "idle" || a.status === "busy",
  ).length;
  const tasks = await db.select().from(tasksTable);
  const queuedTasks = tasks.filter(
    (t) => t.status === "pending" || t.status === "active",
  ).length;
  const completedTasks = tasks.filter((t) => t.status === "completed").length;
  const failedTasks = tasks.filter((t) => t.status === "failed").length;
  const memApprovals = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(memoryEventsTable)
    .where(eq(memoryEventsTable.decision, "approved"));
  const recentSignals = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(signalsTable)
    .where(gte(signalsTable.createdAt, since));
  const activeRes = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(resonanceFieldsTable)
    .where(eq(resonanceFieldsTable.status, "active"));

  const [radio, obs] = await Promise.all([radioHealth(), observatoryHealth()]);

  res.json({
    activeArms,
    totalArms: arms.length,
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
