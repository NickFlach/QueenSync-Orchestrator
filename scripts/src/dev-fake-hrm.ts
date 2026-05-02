/**
 * Dev-only fake `kannaka-memory` HRM consumer.
 *
 * Wave 4 of ADR-002 has the api-server publish approved memory events on
 * `KANNAKA.absorb` and listen on `KANNAKA.absorb.ack` for the result. In
 * production that loop is closed by kannaka-memory's swarm-worker. In the
 * Replit dev workspace there is no such worker, so absorb attempts hang
 * forever in the `pending` state and no exemplars ever flow back.
 *
 * This script stands in for the real HRM in dev:
 *   1. Subscribes to KANNAKA.absorb. For every request it publishes an
 *      `{ status: "absorbed", memoryId, idempotencyKey, hrmId }` ack on
 *      KANNAKA.absorb.ack after a short delay.
 *   2. Periodically (default every 45s) publishes a synthetic exemplar
 *      candidate on KANNAKA.exemplars so the "Inbound Exemplars" section
 *      of the Memory Gate page shows real activity.
 *
 * Configuration (env):
 *   NATS_URL              default nats://127.0.0.1:4222
 *   FAKE_HRM_ACK_DELAY_MS default 600
 *   FAKE_HRM_EXEMPLAR_MS  default 45000  (set to 0 to disable)
 *
 * Run via `pnpm --filter @workspace/scripts run dev-fake-hrm`.
 */

import { connect, JSONCodec, type NatsConnection } from "nats";

const URL = process.env["NATS_URL"] ?? "nats://127.0.0.1:4222";
const ACK_DELAY_MS = Number(process.env["FAKE_HRM_ACK_DELAY_MS"] ?? "600");
const EXEMPLAR_INTERVAL_MS = Number(
  process.env["FAKE_HRM_EXEMPLAR_MS"] ?? "45000",
);

const ABSORB = "KANNAKA.absorb";
const ABSORB_ACK = "KANNAKA.absorb.ack";
const EXEMPLARS = "KANNAKA.exemplars";

const codec = JSONCodec<Record<string, unknown>>();

function log(msg: string, extra?: Record<string, unknown>): void {
  const stamp = new Date().toISOString();
  if (extra) {
    console.log(`[fake-hrm ${stamp}] ${msg}`, extra);
  } else {
    console.log(`[fake-hrm ${stamp}] ${msg}`);
  }
}

async function connectWithRetry(): Promise<NatsConnection> {
  for (let attempt = 1; ; attempt++) {
    try {
      const nc = await connect({
        servers: URL,
        name: "dev-fake-hrm",
        reconnect: true,
        maxReconnectAttempts: -1,
        reconnectTimeWait: 2000,
        waitOnFirstConnect: false,
      });
      log(`connected to ${URL}`);
      return nc;
    } catch (err) {
      const wait = Math.min(10_000, 500 * attempt);
      log(
        `connect attempt ${attempt} failed: ${(err as Error).message} — retry in ${wait}ms`,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

function decodeAbsorb(raw: Uint8Array): Record<string, unknown> | null {
  try {
    return codec.decode(raw);
  } catch (err) {
    log(`failed to decode absorb payload: ${(err as Error).message}`);
    return null;
  }
}

async function handleAbsorb(
  nc: NatsConnection,
  raw: Uint8Array,
): Promise<void> {
  const payload = decodeAbsorb(raw);
  if (!payload) return;
  const memoryId = typeof payload["memoryId"] === "string"
    ? (payload["memoryId"] as string)
    : null;
  const idempotencyKey = typeof payload["idempotencyKey"] === "string"
    ? (payload["idempotencyKey"] as string)
    : null;
  if (!memoryId && !idempotencyKey) {
    log("absorb missing memoryId and idempotencyKey; skipping ack");
    return;
  }
  log("absorb received", {
    memoryId,
    idempotencyKey,
    summary: payload["summary"],
  });
  if (ACK_DELAY_MS > 0) {
    await new Promise((r) => setTimeout(r, ACK_DELAY_MS));
  }
  const ack = {
    status: "absorbed" as const,
    memoryId: memoryId ?? undefined,
    idempotencyKey: idempotencyKey ?? undefined,
    hrmId: `hrm_${Math.random().toString(36).slice(2, 10)}`,
  };
  nc.publish(ABSORB_ACK, codec.encode(ack));
  log("absorb acked", ack);
}

function publishExemplar(nc: NatsConnection): void {
  const seed = Math.random().toString(36).slice(2, 10);
  const cluster = `cluster_${Math.floor(Math.random() * 16)
    .toString(16)
    .padStart(2, "0")}`;
  const exemplar = {
    id: `exemplar_${seed}`,
    cluster,
    summary: `Synthetic exemplar from ${cluster}`,
    content:
      "Dev-only HRM heartbeat: a representative sample replayed from a fake cluster so the operator UI has something to triage.",
    score: Number((0.6 + Math.random() * 0.4).toFixed(3)),
    sampledAt: new Date().toISOString(),
  };
  nc.publish(EXEMPLARS, codec.encode(exemplar));
  log("exemplar published", { id: exemplar.id, cluster });
}

async function main(): Promise<void> {
  const nc = await connectWithRetry();

  const sub = nc.subscribe(ABSORB);
  log(`subscribed to ${ABSORB}`);
  void (async () => {
    for await (const m of sub) {
      void handleAbsorb(nc, m.data).catch((err) =>
        log(`absorb handler error: ${(err as Error).message}`),
      );
    }
  })();

  let exemplarTimer: ReturnType<typeof setInterval> | null = null;
  if (EXEMPLAR_INTERVAL_MS > 0) {
    log(`will publish a synthetic exemplar every ${EXEMPLAR_INTERVAL_MS}ms`);
    // Fire one shortly after boot so the UI shows activity quickly.
    setTimeout(() => publishExemplar(nc), 5_000);
    exemplarTimer = setInterval(
      () => publishExemplar(nc),
      EXEMPLAR_INTERVAL_MS,
    );
  } else {
    log("exemplar replay disabled (FAKE_HRM_EXEMPLAR_MS=0)");
  }

  const shutdown = async (sig: string): Promise<void> => {
    log(`received ${sig}, draining`);
    if (exemplarTimer) clearInterval(exemplarTimer);
    try {
      await nc.drain();
    } catch (err) {
      log(`drain error: ${(err as Error).message}`);
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Surface unexpected close so the parent supervisor can react.
  void nc.closed().then((err) => {
    if (err) log(`nats connection closed with error: ${err.message}`);
    else log("nats connection closed");
    process.exit(err ? 1 : 0);
  });
}

main().catch((err) => {
  console.error("[fake-hrm] fatal", err);
  process.exit(1);
});
