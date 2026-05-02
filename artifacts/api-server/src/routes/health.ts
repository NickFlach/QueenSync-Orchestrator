import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getNatsStatus } from "../lib/nats-bridge";

const router: IRouter = Router();

function handleHealth(_req: unknown, res: { json: (v: unknown) => void }) {
  const data = HealthCheckResponse.parse({
    status: "ok",
    nats: getNatsStatus(),
  });
  res.json(data);
}

router.get("/healthz", handleHealth);
// Alias kept for backward-compat with monitors and the Wave 5 canary
// default URL.
router.get("/health", handleHealth);

export default router;
