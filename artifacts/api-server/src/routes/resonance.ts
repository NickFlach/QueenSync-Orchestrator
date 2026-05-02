import { Router, type IRouter } from "express";
import { nanoid } from "nanoid";
import {
  db,
  resonanceFieldsTable,
  resonanceResponsesTable,
} from "@workspace/db";
import {
  CreateResonanceBody,
  RespondResonanceBody,
  ResolveResonanceBody,
} from "@workspace/api-zod";
import { recordLog } from "../lib/log";
import { broadcast } from "../lib/ws";
import {
  autoLocalResonance,
  listResonanceFields,
  loadResonance,
  resolveField,
} from "../lib/resonance";
import { requireOperator } from "../lib/auth";

const router: IRouter = Router();

router.get("/resonance", async (_req, res): Promise<void> => {
  res.json(await listResonanceFields(false));
});

router.get("/resonance/active", async (_req, res): Promise<void> => {
  res.json(await listResonanceFields(true));
});

router.post("/resonance", requireOperator, async (req, res): Promise<void> => {
  const parsed = CreateResonanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;
  const [field] = await db
    .insert(resonanceFieldsTable)
    .values({
      id: nanoid(12),
      intent: body.intent,
      tags: body.tags,
      priority: body.priority ?? 0.5,
      constraints: body.constraints ?? {},
      status: "active",
      expiresAt: body.ttlSeconds
        ? new Date(Date.now() + body.ttlSeconds * 1000)
        : new Date(Date.now() + 60_000),
    })
    .returning();
  await recordLog({
    eventType: "resonance_created",
    source: null,
    summary: `Resonance field opened: ${body.intent}`,
    metadata: { resonanceId: field.id, tags: body.tags },
  });
  broadcast({ type: "resonance_created", data: { ...field, responses: [] } });
  void autoLocalResonance(field);
  const full = await loadResonance(field.id);
  res.status(201).json(full);
});

router.post("/resonance/:id/respond", requireOperator, async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const parsed = RespondResonanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const field = await loadResonance(id);
  if (!field) {
    res.status(404).json({ error: "resonance not found" });
    return;
  }
  const body = parsed.data;
  const [response] = await db
    .insert(resonanceResponsesTable)
    .values({
      id: nanoid(12),
      resonanceId: id,
      agentId: body.agentId,
      score: body.score,
      output: body.output,
    })
    .returning();
  await recordLog({
    eventType: "resonance_response",
    source: body.agentId,
    summary: `Manual response from ${body.agentId} (${body.score.toFixed(2)})`,
    metadata: { resonanceId: id, responseId: response.id },
  });
  broadcast({ type: "resonance_response", data: response });
  const updated = await loadResonance(id);
  if (updated) broadcast({ type: "resonance_updated", data: updated });
  res.json(updated);
});

router.post("/resonance/:id/resolve", requireOperator, async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const parsed = ResolveResonanceBody.safeParse(req.body ?? {});
  const strategy =
    parsed.success && parsed.data.strategy ? parsed.data.strategy : "best";
  const updated = await resolveField(id, strategy as "best" | "merge");
  if (!updated) {
    res.status(404).json({ error: "resonance not found" });
    return;
  }
  res.json(updated);
});

export default router;
