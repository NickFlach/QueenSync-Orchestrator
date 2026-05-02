import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, logsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/logs", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(logsTable)
    .orderBy(desc(logsTable.createdAt))
    .limit(200);
  res.json(rows);
});

export default router;
