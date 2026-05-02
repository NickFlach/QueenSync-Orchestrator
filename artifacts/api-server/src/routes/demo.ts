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
import { requireOperator } from "../lib/auth";
import {
  fetchObservatoryState,
  pokeKannaktopusWake,
} from "../lib/observatory-bridge";
import { getAuditContext } from "../lib/audit";
import { rateLimit } from "../middlewares/rate-limit";

const router: IRouter = Router();

const demoLimiter = rateLimit({
  name: "demo",
  windowMs: 60_000,
  max: 10,
});

router.use("/demo", demoLimiter);

router.post(
  "/demo/wake-kannaktopus",
  requireOperator,
  async (req, res): Promise<void> => {
    const audit = getAuditContext(req);
    const created: string[] = [];
    const [arm] = await db
      .select()
      .from(armsTable)
      .where(eq(armsTable.id, "architect_01"));
    if (arm) {
      await db
        .update(armsTable)
        .set({ status: "idle", lastHeartbeat: new Date() })
        .where(eq(armsTable.id, arm.id));
      broadcast({
        type: "arms_updated",
        data: { armId: arm.id, status: "idle" },
      });
    }
    const intents = [
      {
        intent: "Compose a chord transmission for Signal Keeper",
        capability: "transmit",
      },
      { intent: "Build a memory snapshot for the swarm", capability: "build" },
      {
        intent: "Dream a short fragment from today's logs",
        capability: "dream",
      },
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
      broadcast({ type: "task_created", data: task });
      await dispatchTask(task);
    }
    // Best-effort Kannaktopus wake poke — only fires if KANNAKTOPUS_WAKE_URL
    // is configured. Result is informational; the demo always succeeds.
    const wake = await pokeKannaktopusWake({
      taskIds: created,
      source: "demo:wake-kannaktopus",
    });

    // Pull a live observatory snapshot so the operator can see Kannaktopus
    // surface in the HRM panel and the Hologram TV view.
    const observatory = await fetchObservatoryState();
    broadcast({
      type: "kannaktopus_status",
      data: {
        trigger: "demo:wake-kannaktopus",
        observatory,
        wake,
      },
    });

    await recordLog({
      eventType: "kannaktopus_wake",
      source: "demo",
      summary: wake.attempted
        ? `Kannaktopus woken — issued ${created.length} demo tasks · ${wake.message}`
        : `Kannaktopus woken — issued ${created.length} demo tasks`,
      metadata: {
        taskIds: created,
        kannaktopusWake: wake,
        observatoryLevel: observatory.consciousness.level,
        observatoryPhi: observatory.consciousness.phi,
      },
      audit,
    });
    res.json({
      created,
      message: wake.attempted
        ? `Kannaktopus arms reaching outward · ${wake.message}`
        : "Kannaktopus arms reaching outward — observatory pulse pulled.",
    });
  },
);

router.post(
  "/demo/dream-lite",
  requireOperator,
  async (req, res): Promise<void> => {
    const audit = getAuditContext(req);
    const recent = await db
      .select()
      .from(memoryEventsTable)
      .orderBy(desc(memoryEventsTable.createdAt))
      .limit(20);
    const summary =
      recent.length === 0
        ? "Memory Keeper hums in an empty room — no memories yet."
        : `Memory Keeper compressed ${recent.length} memories: ${recent
            .map((m) => m.tag)
            .slice(0, 8)
            .join(", ")}.`;
    const result = await evaluateMemory({
      type: "decision",
      content: summary,
      agentId: "memory_keeper_01",
      metadata: { kind: "dream_lite" },
    });
    await recordLog({
      eventType: "dream_lite",
      source: "memory_keeper_01",
      summary,
      metadata: { decision: result.decision, importance: result.importance },
      audit,
    });
    res.json({
      created: result.event ? [result.event.id] : [],
      message: summary,
    });
  },
);

router.post(
  "/demo/resonance-storm",
  requireOperator,
  async (req, res): Promise<void> => {
    const audit = getAuditContext(req);
    const created: string[] = [];
    const intents: Array<{ intent: string; tags: string[] }> = [
      {
        intent: "Should we transmit a chord to Signal Keeper now?",
        tags: ["transmit", "chord", "broadcast"],
      },
      {
        intent: "Compose a dream fragment from today's signals",
        tags: ["dream", "compose", "summarize"],
      },
      {
        intent: "Forge an OpenClaw artifact for the new arm",
        tags: ["artifact", "build", "merge"],
      },
      {
        intent: "Audit the latest anomaly burst",
        tags: ["audit", "anomaly", "observe"],
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
      broadcast({
        type: "resonance_created",
        data: { ...field, responses: [] },
      });
      await autoLocalResonance(field);
      setTimeout(() => {
        void resolveField(field.id, "best");
      }, 1500);
    }
    await recordLog({
      eventType: "resonance_storm",
      source: "demo",
      summary: `Resonance Storm — ${created.length} fields opened`,
      metadata: { resonanceIds: created },
      audit,
    });
    res.json({ created, message: "Resonance storm seeded." });
  },
);

export default router;
