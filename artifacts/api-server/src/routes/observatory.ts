import { Router, type IRouter } from "express";
import {
  fetchObservatoryState,
  observatoryBridgeConfig,
} from "../lib/observatory-bridge";

const router: IRouter = Router();

router.get("/observatory/state", async (_req, res): Promise<void> => {
  const snapshot = await fetchObservatoryState();
  res.json(snapshot);
});

router.get("/observatory/config", async (_req, res): Promise<void> => {
  res.json(observatoryBridgeConfig());
});

export default router;
