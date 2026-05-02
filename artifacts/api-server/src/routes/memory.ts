import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, memoryEventsTable } from "@workspace/db";
import {
  EvaluateMemoryBody,
  CompressMemoryDreamLiteBody,
} from "@workspace/api-zod";
import { evaluateMemory } from "../lib/memory-gate";
import { runDreamLiteCompression } from "../lib/memory-compress";
import { requireOperator } from "../lib/auth";
import { getAuditContext } from "../lib/audit";

const router: IRouter = Router();

router.get("/memory", async (req, res): Promise<void> => {
  const includeCompacted =
    req.query["includeCompacted"] === "true" ||
    req.query["includeCompacted"] === "1";
  const includeRejected =
    req.query["includeRejected"] === "true" ||
    req.query["includeRejected"] === "1";

  const conditions = [];
  if (!includeCompacted) {
    conditions.push(eq(memoryEventsTable.compacted, false));
  }
  if (!includeRejected) {
    conditions.push(
      inArray(memoryEventsTable.decision, ["approved"]),
    );
  }

  const rows = await db
    .select()
    .from(memoryEventsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
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

router.post(
  "/memory/dream-lite",
  requireOperator,
  async (req, res): Promise<void> => {
    const audit = getAuditContext(req);
    const parsed = CompressMemoryDreamLiteBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const result = await runDreamLiteCompression({
      windowMinutes: parsed.data.windowMinutes ?? undefined,
      trigger: audit.trigger,
    });
    res.json(result);
  },
);

export default router;
