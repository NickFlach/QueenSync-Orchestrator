import { Router, type IRouter } from "express";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import {
  db,
  signalsTable,
  tasksTable,
  resonanceFieldsTable,
} from "@workspace/db";
import {
  observatoryHealth,
  observatoryPullEvents,
  radioHealth,
  radioPullEvents,
  type AdapterEventOut,
} from "../lib/adapters";
import { recordLog } from "../lib/log";
import { broadcast } from "../lib/ws";
import { autoLocalResonance } from "../lib/resonance";
import { dispatchTask } from "../lib/router";

const router: IRouter = Router();

let lastRadio: Awaited<ReturnType<typeof radioPullEvents>> = {
  mode: "mock",
  events: [],
};
let lastObservatory: Awaited<ReturnType<typeof observatoryPullEvents>> = {
  mode: "mock",
  events: [],
};

router.get("/adapters/radio/health", async (_req, res): Promise<void> => {
  res.json(await radioHealth());
});

router.get("/adapters/radio/signals", async (_req, res): Promise<void> => {
  if (lastRadio.events.length === 0) lastRadio = await radioPullEvents();
  res.json(lastRadio.events);
});

router.post("/adapters/radio/pull", async (_req, res): Promise<void> => {
  const result = await radioPullEvents();
  lastRadio = result;
  const conv = await convertEventsToSignalsAndResonance(
    result.events,
    "radio_transmission",
    "radio.ninja-portal.com",
    "transmit",
  );
  await recordLog({
    eventType: "adapter_pull",
    source: "radio",
    summary: `Pulled ${result.events.length} radio events (${result.mode})`,
    metadata: { mode: result.mode },
  });
  broadcast({
    type: "adapter_pull",
    data: { adapter: "radio", mode: result.mode, count: result.events.length },
  });
  res.json({
    pulled: result.events.length,
    mode: result.mode,
    signalIds: conv.signalIds,
    resonanceIds: conv.resonanceIds,
    taskIds: conv.taskIds,
  });
});

router.get(
  "/adapters/observatory/health",
  async (_req, res): Promise<void> => {
    res.json(await observatoryHealth());
  },
);

router.get(
  "/adapters/observatory/events",
  async (_req, res): Promise<void> => {
    if (lastObservatory.events.length === 0)
      lastObservatory = await observatoryPullEvents();
    res.json(lastObservatory.events);
  },
);

router.post(
  "/adapters/observatory/pull",
  async (_req, res): Promise<void> => {
    const result = await observatoryPullEvents();
    lastObservatory = result;
    const conv = await convertEventsToSignalsAndResonance(
      result.events,
      "observation_event",
      "observatory.ninja-portal.com",
      "observe",
    );
    await recordLog({
      eventType: "adapter_pull",
      source: "observatory",
      summary: `Pulled ${result.events.length} observatory events (${result.mode})`,
      metadata: { mode: result.mode },
    });
    broadcast({
      type: "adapter_pull",
      data: {
        adapter: "observatory",
        mode: result.mode,
        count: result.events.length,
      },
    });
    res.json({
      pulled: result.events.length,
      mode: result.mode,
      signalIds: conv.signalIds,
      resonanceIds: conv.resonanceIds,
      taskIds: conv.taskIds,
    });
  },
);

async function convertEventsToSignalsAndResonance(
  events: AdapterEventOut[],
  signalType: string,
  source: string,
  baseTag: string,
): Promise<{ signalIds: string[]; resonanceIds: string[]; taskIds: string[] }> {
  const signalIds: string[] = [];
  const resonanceIds: string[] = [];
  const taskIds: string[] = [];
  for (const e of events) {
    const [signal] = await db
      .insert(signalsTable)
      .values({
        id: nanoid(12),
        type: signalType,
        source,
        payload: { ...e.raw, _summary: e.summary, _eventType: e.type },
        status: "received",
      })
      .returning();
    signalIds.push(signal.id);
    broadcast({ type: "signal_received", data: signal });

    // Always create a task so the canonical signal -> task loop runs.
    const [task] = await db
      .insert(tasksTable)
      .values({
        id: nanoid(12),
        intent: e.summary,
        requiredCapability: baseTag,
        priority: 5,
        source: `adapter:${source}`,
        context: { ...e.raw, signalId: signal.id, eventType: e.type },
        status: "pending",
      })
      .returning();
    taskIds.push(task.id);
    broadcast({ type: "task_created", data: task });
    await db
      .update(signalsTable)
      .set({ status: "converted", derivedTaskId: task.id })
      .where(eq(signalsTable.id, signal.id));
    void dispatchTask(task);

    const tags = Array.from(
      new Set([baseTag, ...e.type.split(".").filter(Boolean)]),
    );
    const [field] = await db
      .insert(resonanceFieldsTable)
      .values({
        id: nanoid(12),
        intent: e.summary,
        tags,
        priority: 0.6,
        constraints: { signalId: signal.id, taskId: task.id },
        status: "active",
        expiresAt: new Date(Date.now() + 45_000),
      })
      .returning();
    resonanceIds.push(field.id);
    await db
      .update(signalsTable)
      .set({ derivedResonanceId: field.id })
      .where(eq(signalsTable.id, signal.id));
    await recordLog({
      eventType: "resonance_created",
      source,
      summary: `Resonance opened for adapter event: ${e.summary}`,
      metadata: { resonanceId: field.id, signalId: signal.id, taskId: task.id },
    });
    broadcast({
      type: "resonance_created",
      data: { ...field, responses: [] },
    });
    void autoLocalResonance(field);
  }
  return { signalIds, resonanceIds, taskIds };
}

export default router;
