import { Router, type IRouter } from "express";
import { nanoid } from "nanoid";
import { db, signalsTable } from "@workspace/db";
import {
  observatoryHealth,
  observatoryPullEvents,
  radioHealth,
  radioPullEvents,
} from "../lib/adapters";
import { recordLog } from "../lib/log";

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
  const signalIds: string[] = [];
  for (const e of result.events) {
    const [row] = await db
      .insert(signalsTable)
      .values({
        id: nanoid(12),
        type: "radio_transmission",
        source: "radio.ninja-portal.com",
        payload: e.raw,
        status: "received",
      })
      .returning();
    signalIds.push(row.id);
  }
  await recordLog({
    eventType: "adapter_pull",
    source: "radio",
    summary: `Pulled ${result.events.length} radio events (${result.mode})`,
    metadata: { mode: result.mode },
  });
  res.json({
    pulled: result.events.length,
    mode: result.mode,
    signalIds,
    resonanceIds: [],
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
    const signalIds: string[] = [];
    for (const e of result.events) {
      const [row] = await db
        .insert(signalsTable)
        .values({
          id: nanoid(12),
          type: "observation_event",
          source: "observatory.ninja-portal.com",
          payload: e.raw,
          status: "received",
        })
        .returning();
      signalIds.push(row.id);
    }
    await recordLog({
      eventType: "adapter_pull",
      source: "observatory",
      summary: `Pulled ${result.events.length} observatory events (${result.mode})`,
      metadata: { mode: result.mode },
    });
    res.json({
      pulled: result.events.length,
      mode: result.mode,
      signalIds,
      resonanceIds: [],
    });
  },
);

export default router;
