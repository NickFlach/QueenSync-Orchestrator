import { db, armsTable } from "@workspace/db";
import { logger } from "./logger";

const DEFAULT_ARMS = [
  {
    id: "arm-kannaktopus-prime",
    name: "Kannaktopus Prime",
    type: "kannaktopus_arm",
    status: "idle",
    capabilities: ["build", "transmit", "compose", "dream"],
    authMethod: "none",
    description: "Local simulated Kannaktopus core arm.",
    resonanceTags: ["build", "transmit", "dream", "kannaka"],
    resonanceSensitivity: 0.4,
    resonanceMode: "auto",
  },
  {
    id: "arm-openclaw-forge",
    name: "OpenClaw Forge",
    type: "openclaw",
    status: "idle",
    capabilities: ["artifact", "build", "merge"],
    authMethod: "none",
    description: "OpenClaw artifact builder.",
    resonanceTags: ["artifact", "build", "merge"],
    resonanceSensitivity: 0.5,
    resonanceMode: "auto",
  },
  {
    id: "arm-radio-listener",
    name: "Radio Listener",
    type: "external_webhook",
    status: "idle",
    capabilities: ["transmit", "broadcast", "ingest"],
    endpointUrl: "https://radio.ninja-portal.com",
    authMethod: "none",
    description: "Bridge to radio.ninja-portal.com transmissions.",
    resonanceTags: ["transmit", "story", "chord"],
    resonanceSensitivity: 0.5,
    resonanceMode: "passive",
  },
  {
    id: "arm-observatory-watch",
    name: "Observatory Watch",
    type: "external_webhook",
    status: "idle",
    capabilities: ["observe", "ingest", "anomaly"],
    endpointUrl: "https://observatory.ninja-portal.com",
    authMethod: "none",
    description: "Bridge to observatory.ninja-portal.com events.",
    resonanceTags: ["observe", "anomaly", "commit"],
    resonanceSensitivity: 0.5,
    resonanceMode: "passive",
  },
  {
    id: "arm-dream-lite",
    name: "Dream Lite",
    type: "local_simulated",
    status: "idle",
    capabilities: ["compose", "dream", "summarize"],
    authMethod: "none",
    description: "Local memory compression and dream synthesis.",
    resonanceTags: ["dream", "summarize", "compose"],
    resonanceSensitivity: 0.3,
    resonanceMode: "auto",
  },
] as const;

export async function seedDefaults() {
  const existing = await db.select().from(armsTable);
  if (existing.length > 0) return;
  await db.insert(armsTable).values(DEFAULT_ARMS as never);
  logger.info({ count: DEFAULT_ARMS.length }, "seeded default arms");
}
