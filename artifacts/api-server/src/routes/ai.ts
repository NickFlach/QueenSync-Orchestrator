import { Router, type IRouter } from "express";
import { interpretCommand, isAiConfigured } from "../lib/ai-command";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/ai/status", (_req, res): void => {
  res.json({ configured: isAiConfigured() });
});

router.post("/ai/command", async (req, res): Promise<void> => {
  const promptRaw = (req.body && (req.body as { prompt?: unknown }).prompt) as
    | unknown
    | undefined;
  const prompt = typeof promptRaw === "string" ? promptRaw.trim() : "";
  if (!prompt) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }
  if (!isAiConfigured()) {
    res
      .status(503)
      .json({ error: "AI integration not configured on the server." });
    return;
  }
  try {
    const action = await interpretCommand(prompt);
    res.json(action);
  } catch (err) {
    logger.error({ err }, "ai-command failed");
    const message =
      err instanceof Error ? err.message : "AI interpretation failed";
    res.status(500).json({ error: message });
  }
});

export default router;
