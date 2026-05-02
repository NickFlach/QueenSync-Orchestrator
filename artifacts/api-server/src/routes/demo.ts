import { Router, type IRouter } from "express";
import { nanoid } from "nanoid";
import { desc, eq } from "drizzle-orm";
import {
  db,
  armsTable,
  tasksTable,
  resonanceFieldsTable,
  memoryEventsTable,
} from "@workspace/db";
import { recordLog } from "../lib/log";
import { broadcast } from "../lib/ws";
import { dispatchTask } from "../lib/router";
import { autoLocalResonance, resolveField } from "../lib/resonance";
import { evaluateMemory } from "../lib/memory-gate";

const router: IRouter = Router();

router.post("/demo/wake-kannaktopus", async (_req, res): Promise<void> => {
  const created: string[] = [];
  const [arm] = await db
    .select()
    .from(armsTable)
    .where(eq(armsTable.id, "arm-kannaktopus-prime"));
  if (arm) {
    await db
      .update(armsTable)
      .set({ status: "idle", lastHeartbeat: new Date() })
      .where(eq(armsTable.id, arm.id));
  }
  const intents = [
    {
      intent: "Compose a chord transmission for Radio",
      capability: "transmit",
    },
    { intent: "Build a memory snapshot", capability: "build" },
    { intent: "Dream a short fragment", capability: "dream" },
  ];
  for (const i of intents) {
    const [task] = await db
      .insert(tasksTable)
      .values({
        id: nanoid(12),
        intent: i.intent,
        requiredCapability: i.capability,
        priority: 7,
        source: "demo:wake-kannaktopus",
        context: {},
        status: "pending",
      })
      .returning();
    created.push(task.id);
    await dispatchTask(task);
  }
  await recordLog({
    eventType: "kannaktopus_wake",
    source: "demo",
    summary: "Kannaktopus woken — issued 3 demo tasks",
    metadata: { taskIds: created },
  });
  res.json({ created, message: "Kannaktopus arms reaching outward." });
});

router.post("/demo/dream-lite", async (_req, res): Promise<void> => {
  const recent = await db
    .select()
    .from(memoryEventsTable)
    .orderBy(desc(memoryEventsTable.createdAt))
    .limit(20);
  const summary =
    recent.length === 0
      ? "Dream Lite hums in an empty room — no memories yet."
      : `Dream Lite compressed ${recent.length} memories: ${recent
          .map((m) => m.tag)
          .slice(0, 8)
          .join(", ")}.`;
  const result = await evaluateMemory({
    type: "decision",
    content: summary,
    agentId: "arm-dream-lite",
    metadata: { kind: "dream_lite" },
  });
  await recordLog({
    eventType: "dream_lite",
    source: "arm-dream-lite",
    summary,
    metadata: { decision: result.decision, importance: result.importance },
  });
  res.json({
    created: result.event ? [result.event.id] : [],
    message: summary,
  });
});

router.post("/demo/resonance-storm", async (_req, res): Promise<void> => {
  const created: string[] = [];
  const intents: Array<{ intent: string; tags: string[] }> = [
    {
      intent: "Should we transmit a chord to Radio now?",
      tags: ["transmit", "chord", "kannaka"],
    },
    {
      intent: "Compose a dream fragment from today's signals",
      tags: ["dream", "compose", "summarize"],
    },
    {
      intent: "Forge an OpenClaw artifact for the new arm",
      tags: ["artifact", "build", "merge"],
    },
  ];
  for (const r of intents) {
    const [field] = await db
      .insert(resonanceFieldsTable)
      .values({
        id: nanoid(12),
        intent: r.intent,
        tags: r.tags,
        priority: 0.8,
        constraints: {},
        status: "active",
        expiresAt: new Date(Date.now() + 30_000),
      })
      .returning();
    created.push(field.id);
    broadcast({ kind: "resonance", data: { ...field, responses: [] } });
    await autoLocalResonance(field);
    setTimeout(() => {
      void resolveField(field.id, "best");
    }, 1500);
  }
  await recordLog({
    eventType: "resonance_created",
    source: "demo",
    summary: `Resonance Storm — ${created.length} fields opened`,
    metadata: { resonanceIds: created },
  });
  res.json({ created, message: "Resonance storm seeded." });
});

export default router;
