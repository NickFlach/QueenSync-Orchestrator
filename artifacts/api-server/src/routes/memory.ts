import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, memoryEventsTable } from "@workspace/db";
import { EvaluateMemoryBody } from "@workspace/api-zod";
import { evaluateMemory } from "../lib/memory-gate";
import { requireOperator } from "../lib/auth";

const router: IRouter = Router();

router.get("/memory", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(memoryEventsTable)
    .orderBy(desc(memoryEventsTable.createdAt))
    .limit(200);
  res.json(rows);
});

router.post("/memory/evaluate", requireOperator, async (req, res): Promise<void> => {
  const parsed = EvaluateMemoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const result = await evaluateMemory(parsed.data);
  res.json(result);
});

export default router;
