import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db, armsTable } from "@workspace/db";
import {
  sweepStaleHeartbeats,
  startHeartbeatScheduler,
  stopHeartbeatScheduler,
  probeHeartbeatUrls,
  DEFAULT_HEARTBEAT_STALE_MS,
} from "../heartbeat-scheduler";

const SEED_IDS = [
  "__hb_test_stale__",
  "__hb_test_fresh__",
  "__hb_test_already_offline__",
  "__hb_test_failed__",
  "__hb_test_never__",
  "__hb_test_probe_ok__",
  "__hb_test_probe_offline_recover__",
  "__hb_test_probe_fail__",
  "__hb_test_seeded_baseline__",
];

async function clean() {
  await db.delete(armsTable).where(inArray(armsTable.id, SEED_IDS));
}

before(async () => {
  await clean();
});
afterEach(async () => {
  await clean();
  stopHeartbeatScheduler();
});
after(async () => {
  await clean();
  stopHeartbeatScheduler();
});

async function insertArm(
  id: string,
  status: string,
  lastHeartbeat: Date | null,
  heartbeatUrl: string | null = null,
) {
  await db.insert(armsTable).values({
    id,
    name: id,
    type: "external_webhook",
    status,
    capabilities: ["test"],
    authMethod: "none",
    lastHeartbeat,
    heartbeatUrl,
  } as never);
}

async function lastHeartbeatOf(id: string): Promise<Date | null> {
  const [row] = await db
    .select({ lastHeartbeat: armsTable.lastHeartbeat })
    .from(armsTable)
    .where(eq(armsTable.id, id));
  return row?.lastHeartbeat ?? null;
}

async function statusOf(id: string): Promise<string | null> {
  const [row] = await db
    .select({ status: armsTable.status })
    .from(armsTable)
    .where(eq(armsTable.id, id));
  return row?.status ?? null;
}

describe("sweepStaleHeartbeats", () => {
  it("demotes stale (idle/active) arms to offline and leaves fresh arms alone", async () => {
    const stale = new Date(Date.now() - DEFAULT_HEARTBEAT_STALE_MS - 5_000);
    const fresh = new Date(Date.now() - 1_000);
    await insertArm("__hb_test_stale__", "idle", stale);
    await insertArm("__hb_test_fresh__", "idle", fresh);

    const demoted = await sweepStaleHeartbeats();

    assert.ok(demoted.includes("__hb_test_stale__"));
    assert.ok(!demoted.includes("__hb_test_fresh__"));
    assert.equal(await statusOf("__hb_test_stale__"), "offline");
    assert.equal(await statusOf("__hb_test_fresh__"), "idle");
  });

  it("never touches arms whose status is already offline or failed", async () => {
    const stale = new Date(Date.now() - DEFAULT_HEARTBEAT_STALE_MS - 5_000);
    await insertArm("__hb_test_already_offline__", "offline", stale);
    await insertArm("__hb_test_failed__", "failed", stale);

    const demoted = await sweepStaleHeartbeats();

    assert.ok(!demoted.includes("__hb_test_already_offline__"));
    assert.ok(!demoted.includes("__hb_test_failed__"));
    assert.equal(await statusOf("__hb_test_already_offline__"), "offline");
    assert.equal(await statusOf("__hb_test_failed__"), "failed");
  });

  it("ignores arms that have never heartbeated (lastHeartbeat IS NULL)", async () => {
    await insertArm("__hb_test_never__", "idle", null);
    const demoted = await sweepStaleHeartbeats();
    assert.ok(!demoted.includes("__hb_test_never__"));
    assert.equal(await statusOf("__hb_test_never__"), "idle");
  });

  it("respects the staleMs override", async () => {
    // Arm only 2s stale; default window is 180s, but we ask for 1s.
    const stale = new Date(Date.now() - 2_000);
    await insertArm("__hb_test_stale__", "idle", stale);
    const demoted = await sweepStaleHeartbeats({ staleMs: 1_000 });
    assert.ok(demoted.includes("__hb_test_stale__"));
    assert.equal(await statusOf("__hb_test_stale__"), "offline");
  });
});

describe("probeHeartbeatUrls", () => {
  it("refreshes lastHeartbeat when the GET returns 2xx", async () => {
    await insertArm(
      "__hb_test_probe_ok__",
      "idle",
      new Date(Date.now() - 120_000),
      "https://example.test/healthz",
    );
    const before = await lastHeartbeatOf("__hb_test_probe_ok__");
    const fakeFetch: typeof fetch = async () =>
      new Response("ok", { status: 200 });
    const refreshed = await probeHeartbeatUrls({ fetcher: fakeFetch });
    assert.ok(refreshed.includes("__hb_test_probe_ok__"));
    const after = await lastHeartbeatOf("__hb_test_probe_ok__");
    assert.ok(after && before && after.getTime() > before.getTime());
  });

  it("brings an offline arm back to idle on probe success", async () => {
    await insertArm(
      "__hb_test_probe_offline_recover__",
      "offline",
      new Date(Date.now() - 600_000),
      "https://example.test/healthz",
    );
    const fakeFetch: typeof fetch = async () =>
      new Response("ok", { status: 200 });
    await probeHeartbeatUrls({ fetcher: fakeFetch });
    assert.equal(
      await statusOf("__hb_test_probe_offline_recover__"),
      "idle",
    );
  });

  it("does NOT refresh lastHeartbeat on probe failure (lets sweep demote)", async () => {
    const original = new Date(Date.now() - 120_000);
    await insertArm(
      "__hb_test_probe_fail__",
      "idle",
      original,
      "https://example.test/healthz",
    );
    const fakeFetch: typeof fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    const refreshed = await probeHeartbeatUrls({ fetcher: fakeFetch });
    assert.ok(!refreshed.includes("__hb_test_probe_fail__"));
    const after = await lastHeartbeatOf("__hb_test_probe_fail__");
    assert.equal(after?.getTime(), original.getTime());
  });

  it("a freshly-seeded arm whose probe never succeeds gets demoted by the sweep after staleMs", async () => {
    // Simulate the seed-bootstrap path: lastHeartbeat = a moment ago,
    // probe will fail (no real endpoint), sweep with a tight staleMs.
    await insertArm(
      "__hb_test_seeded_baseline__",
      "idle",
      new Date(Date.now() - 5_000),
      "https://example.test/healthz",
    );
    const fakeFetch: typeof fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    await probeHeartbeatUrls({ fetcher: fakeFetch });
    const demoted = await sweepStaleHeartbeats({ staleMs: 1_000 });
    assert.ok(
      demoted.includes("__hb_test_seeded_baseline__"),
      `expected seeded baseline arm to be demoted; demoted=${JSON.stringify(demoted)}`,
    );
    assert.equal(await statusOf("__hb_test_seeded_baseline__"), "offline");
  });
});

describe("startHeartbeatScheduler", () => {
  it("is idempotent — calling start twice does not double-schedule", () => {
    const stop1 = startHeartbeatScheduler({ intervalMs: 60_000 });
    const stop2 = startHeartbeatScheduler({ intervalMs: 60_000 });
    // Both stop fns refer to the same underlying timer; calling either is safe.
    stop1();
    stop2();
  });
});
