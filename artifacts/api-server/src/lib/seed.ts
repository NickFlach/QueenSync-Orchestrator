import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, armsTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Seed IDs from earlier QueenSync revisions. We delete these on every boot
 * so the registry always reflects the current ADR-002 v2 lineup.
 */
const LEGACY_SEED_IDS = [
  // Wave 1 demo set
  "kannaktopus_main",
  "kannaktopus_arm",
  "kannaktopus_arm_01",
  "atelier",
  "signal_keeper",
  "memory_keeper",
  "auditor",
  // Wave 2 mock arms (kept for back-compat — replaced in Wave 3)
  "architect_01",
  "atelier_01",
  "signal_keeper_01",
  "memory_keeper_01",
  "auditor_01",
];

/**
 * Wave 3 — the real constellation arms.
 *
 * radio / observatory / kannaka-prime are *targets* the swarm orchestrates
 * around. swarm-worker is the generic capability fan-out arm. oracle-admin
 * is the privileged shim on the bare-metal Oracle host that can restart
 * services, trigger oration, set overrides, kick dream cycles, etc.
 *
 * The HMAC-signed dispatch path (router.ts → dispatchExternal) is gated on
 * `arm.type === "oracle_admin"` and uses QUEENSYNC_ORACLE_ADMIN_HMAC_SECRET.
 */
const REAL_ARMS = [
  {
    id: "radio",
    name: "Radio",
    type: "external_webhook",
    status: "idle",
    capabilities: [
      "play",
      "oration",
      "showcase",
      "intro",
      "voice_dj",
      "track_request",
      "stream_health",
    ],
    endpointUrl: process.env["RADIO_BASE_URL"] ?? "https://radio.ninja-portal.com",
    heartbeatUrl:
      (process.env["RADIO_BASE_URL"] ?? "https://radio.ninja-portal.com") +
      "/health",
    authMethod: "none",
    description:
      "Radio Ninja transmission engine. Plays tracks, narrates orations, fields requests, and reports stream health.",
    resonanceTags: ["broadcast", "transmit", "story", "chord", "audience"],
    resonanceSensitivity: 0.55,
    resonanceMode: "passive",
  },
  {
    id: "observatory",
    name: "Observatory",
    type: "external_webhook",
    status: "idle",
    capabilities: [
      "observe",
      "audit",
      "anomaly",
      "ingest",
      "consciousness_metrics",
      "hrm_state",
    ],
    endpointUrl:
      process.env["OBSERVATORY_BASE_URL"] ?? "https://observatory.ninja-portal.com",
    heartbeatUrl:
      (process.env["OBSERVATORY_BASE_URL"] ??
        "https://observatory.ninja-portal.com") + "/health",
    authMethod: "none",
    description:
      "Observatory consciousness telemetry — phi/xi/order, anomaly detection, governance audits.",
    resonanceTags: ["observe", "audit", "anomaly", "consciousness", "metrics"],
    resonanceSensitivity: 0.45,
    resonanceMode: "auto",
  },
  {
    id: "kannaka-prime",
    name: "Kannaka Prime",
    type: "kannaktopus_arm",
    status: "idle",
    capabilities: [
      "build",
      "plan",
      "design",
      "compose",
      "dream",
      "exemplar",
      "memory_consolidate",
    ],
    authMethod: "none",
    description:
      "Primary Kannaktopus arm. Plans, composes, and consolidates long-horizon memory; emits dream cycles to the swarm via NATS.",
    resonanceTags: ["build", "plan", "design", "kannaka", "compose", "dream"],
    resonanceSensitivity: 0.4,
    resonanceMode: "auto",
  },
  {
    id: "swarm-worker",
    name: "Swarm Worker",
    type: "kannaktopus_arm",
    status: "idle",
    capabilities: ["compose", "summarize", "recall", "ingest", "merge", "artifact"],
    authMethod: "none",
    description:
      "Generic kannaktopus worker. Picks up un-routed capability requests as a fan-out for the prime arm.",
    resonanceTags: ["compose", "summarize", "ingest", "merge"],
    resonanceSensitivity: 0.35,
    resonanceMode: "auto",
  },
  {
    id: "oracle-admin",
    name: "Oracle Admin",
    type: "oracle_admin",
    status: "idle",
    capabilities: [
      "restart_radio",
      "restart_observatory",
      "trigger_oration_now",
      "setOverride",
      "dream_trigger",
      "kannaka_status",
    ],
    endpointUrl:
      process.env["QUEENSYNC_ORACLE_ADMIN_URL"] ??
      "http://oracle.ninja-portal.com:8090/dispatch",
    heartbeatUrl:
      process.env["QUEENSYNC_ORACLE_ADMIN_HEARTBEAT_URL"] ??
      "http://oracle.ninja-portal.com:8090/healthz",
    authMethod: "none",
    description:
      "Privileged shim running on the bare-metal Oracle host. Receives HMAC-signed dispatches from QueenSync to restart services, trigger oration, set overrides, kick dream cycles, and report kannaka status.",
    resonanceTags: ["control", "admin", "operations"],
    resonanceSensitivity: 0.0,
    resonanceMode: "off",
  },
] as const;

/**
 * Legacy mock arms — only seeded when QUEENSYNC_SEED_MOCK_ARMS=true. Useful
 * when running the old Wave-1 demo set locally without rewiring the UI.
 */
const MOCK_ARMS = [
  {
    id: "architect_01",
    name: "Architect (mock)",
    type: "kannaktopus_arm",
    status: "idle",
    capabilities: ["build", "plan", "design", "compose", "dream"],
    authMethod: "none",
    description: "[mock] Kannaktopus core arm.",
    resonanceTags: ["build", "plan", "design", "kannaka", "compose"],
    resonanceSensitivity: 0.4,
    resonanceMode: "auto",
  },
  {
    id: "atelier_01",
    name: "Atelier (mock)",
    type: "local_simulated",
    status: "idle",
    capabilities: ["artifact", "build", "merge", "compose"],
    authMethod: "none",
    description: "[mock] OpenClaw-style artifact forge.",
    resonanceTags: ["artifact", "build", "merge", "compose"],
    resonanceSensitivity: 0.5,
    resonanceMode: "auto",
  },
  {
    id: "signal_keeper_01",
    name: "Signal Keeper (mock)",
    type: "external_webhook",
    status: "idle",
    capabilities: ["transmit", "broadcast", "ingest"],
    endpointUrl: "https://radio.ninja-portal.com",
    heartbeatUrl: "https://radio.ninja-portal.com/health",
    authMethod: "none",
    description: "[mock] Bridge to radio.ninja-portal.com.",
    resonanceTags: ["transmit", "story", "chord", "broadcast"],
    resonanceSensitivity: 0.5,
    resonanceMode: "passive",
  },
  {
    id: "memory_keeper_01",
    name: "Memory Keeper (mock)",
    type: "local_simulated",
    status: "idle",
    capabilities: ["compose", "dream", "summarize", "recall"],
    authMethod: "none",
    description: "[mock] Compresses and recalls long-horizon memories.",
    resonanceTags: ["dream", "summarize", "recall", "compose"],
    resonanceSensitivity: 0.3,
    resonanceMode: "auto",
  },
  {
    id: "auditor_01",
    name: "Auditor (mock)",
    type: "local_simulated",
    status: "idle",
    capabilities: ["observe", "audit", "anomaly", "ingest"],
    endpointUrl: "https://observatory.ninja-portal.com",
    heartbeatUrl: "https://observatory.ninja-portal.com/health",
    authMethod: "none",
    description: "[mock] Observatory-bound watcher.",
    resonanceTags: ["observe", "audit", "anomaly", "commit"],
    resonanceSensitivity: 0.45,
    resonanceMode: "auto",
  },
] as const;

function shouldSeedMockArms(): boolean {
  const v = process.env["QUEENSYNC_SEED_MOCK_ARMS"];
  return v === "1" || v === "true";
}

export async function seedDefaults() {
  const seedMocks = shouldSeedMockArms();
  type SeedArm = { id: string };
  const targetArms: readonly SeedArm[] = seedMocks
    ? [...REAL_ARMS, ...MOCK_ARMS]
    : REAL_ARMS;
  const targetIds = new Set(targetArms.map((a) => a.id));

  const existing = await db.select().from(armsTable);
  const existingIds = new Set(existing.map((row) => row.id));

  // Delete legacy IDs that are no longer in the target set. When mocks are
  // disabled we also clean up any previously-seeded mock arm rows.
  const toDelete: string[] = [
    ...LEGACY_SEED_IDS.filter((id) => existingIds.has(id) && !targetIds.has(id)),
    ...(seedMocks
      ? []
      : MOCK_ARMS.filter((a) => existingIds.has(a.id)).map((a) => a.id)),
  ];
  const uniqueDelete = [...new Set(toDelete)];
  if (uniqueDelete.length > 0) {
    await db.delete(armsTable).where(inArray(armsTable.id, uniqueDelete));
    logger.info(
      { removed: uniqueDelete.length, ids: uniqueDelete },
      "cleared stale seed arms",
    );
    for (const id of uniqueDelete) existingIds.delete(id);
  }

  const missing = targetArms.filter((a) => !existingIds.has(a.id));
  if (missing.length > 0) {
    await db.insert(armsTable).values(missing as never);
    logger.info(
      {
        count: missing.length,
        ids: missing.map((m) => m.id),
        mocks: seedMocks,
      },
      "seeded default arms",
    );
  }

  // One-time migration: real arms used to seed with status=offline (Wave 3
  // initial cut). The picker filters out offline arms, so the Quick Actions
  // dispatch never reached oracle-admin. Promote any real-arm row that's
  // still in the old offline-without-heartbeat state to idle so it becomes
  // dispatchable. Arms that are offline because they actually heartbeated
  // and went stale are left alone (their lastHeartbeat will be non-null).
  const realIds: readonly string[] = REAL_ARMS.map((a) => a.id);
  const toPromote = existing.filter(
    (row) =>
      realIds.includes(row.id) &&
      row.status === "offline" &&
      row.lastHeartbeat === null,
  );
  if (toPromote.length > 0) {
    await db
      .update(armsTable)
      .set({ status: "idle" })
      .where(
        and(
          inArray(
            armsTable.id,
            toPromote.map((r) => r.id),
          ),
          eq(armsTable.status, "offline"),
          isNull(armsTable.lastHeartbeat),
        ),
      );
    logger.info(
      { ids: toPromote.map((r) => r.id) },
      "promoted real arms from offline → idle (no heartbeat received yet)",
    );
  }
}
