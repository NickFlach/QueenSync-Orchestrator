import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getNatsStatus } from "../lib/nats-bridge";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({
    status: "ok",
    nats: getNatsStatus(),
  });
  res.json(data);
});

export default router;
