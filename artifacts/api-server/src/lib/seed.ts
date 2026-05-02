import { inArray } from "drizzle-orm";
import { db, armsTable } from "@workspace/db";
import { logger } from "./logger";

const LEGACY_SEED_IDS = [
  "kannaktopus_main",
  "kannaktopus_arm",
  "kannaktopus_arm_01",
  "atelier",
  "signal_keeper",
  "memory_keeper",
  "auditor",
];

const DEFAULT_ARMS = [
  {
    id: "architect_01",
    name: "Architect",
    type: "kannaktopus_arm",
    status: "idle",
    capabilities: ["build", "plan", "design", "compose", "dream"],
    authMethod: "none",
    description:
      "Kannaktopus core arm. Plans, composes, and orchestrates higher-order builds.",
    resonanceTags: ["build", "plan", "design", "kannaka", "compose"],
    resonanceSensitivity: 0.4,
    resonanceMode: "auto",
  },
  {
    id: "atelier_01",
    name: "Atelier",
    type: "local_simulated",
    status: "idle",
    capabilities: ["artifact", "build", "merge", "compose"],
    authMethod: "none",
    description:
      "OpenClaw-style artifact forge. Produces concrete deliverables from intents.",
    resonanceTags: ["artifact", "build", "merge", "compose"],
    resonanceSensitivity: 0.5,
    resonanceMode: "auto",
  },
  {
    id: "signal_keeper_01",
    name: "Signal Keeper",
    type: "external_webhook",
    status: "idle",
    capabilities: ["transmit", "broadcast", "ingest"],
    endpointUrl: "https://radio.ninja-portal.com",
    heartbeatUrl: "https://radio.ninja-portal.com/health",
    authMethod: "none",
    description: "Bridge to radio.ninja-portal.com transmissions and chords.",
    resonanceTags: ["transmit", "story", "chord", "broadcast"],
    resonanceSensitivity: 0.5,
    resonanceMode: "passive",
  },
  {
    id: "memory_keeper_01",
    name: "Memory Keeper",
    type: "local_simulated",
    status: "idle",
    capabilities: ["compose", "dream", "summarize", "recall"],
    authMethod: "none",
    description:
      "Compresses, summarizes, and recalls long-horizon memories for the swarm.",
    resonanceTags: ["dream", "summarize", "recall", "compose"],
    resonanceSensitivity: 0.3,
    resonanceMode: "auto",
  },
  {
    id: "auditor_01",
    name: "Auditor",
    type: "local_simulated",
    status: "idle",
    capabilities: ["observe", "audit", "anomaly", "ingest"],
    endpointUrl: "https://observatory.ninja-portal.com",
    heartbeatUrl: "https://observatory.ninja-portal.com/health",
    authMethod: "none",
    description:
      "Observatory-bound watcher. Surfaces anomalies and governance events.",
    resonanceTags: ["observe", "audit", "anomaly", "commit"],
    resonanceSensitivity: 0.45,
    resonanceMode: "auto",
  },
] as const;

export async function seedDefaults() {
  const existing = await db.select().from(armsTable);
  const existingIds = new Set(existing.map((row) => row.id));

  const legacyHits = LEGACY_SEED_IDS.filter((id) => existingIds.has(id));
  if (legacyHits.length > 0) {
    await db
      .delete(armsTable)
      .where(inArray(armsTable.id, legacyHits));
    logger.info(
      { removed: legacyHits.length, ids: legacyHits },
      "cleared legacy seed arms",
    );
    for (const id of legacyHits) existingIds.delete(id);
  }

  const missing = DEFAULT_ARMS.filter((a) => !existingIds.has(a.id));
  if (missing.length === 0) return;
  await db.insert(armsTable).values(missing as never);
  logger.info(
    { count: missing.length, ids: missing.map((m) => m.id) },
    "seeded default arms",
  );
}
