import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db, armsTable } from "@workspace/db";
import {
  sweepStaleHeartbeats,
  startHeartbeatScheduler,
  stopHeartbeatScheduler,
  DEFAULT_HEARTBEAT_STALE_MS,
} from "../heartbeat-scheduler";

const SEED_IDS = [
  "__hb_test_stale__",
  "__hb_test_fresh__",
  "__hb_test_already_offline__",
  "__hb_test_failed__",
  "__hb_test_never__",
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
) {
  await db.insert(armsTable).values({
    id,
    name: id,
    type: "external_webhook",
    status,
    capabilities: ["test"],
    authMethod: "none",
    lastHeartbeat,
  } as never);
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

describe("startHeartbeatScheduler", () => {
  it("is idempotent — calling start twice does not double-schedule", () => {
    const stop1 = startHeartbeatScheduler({ intervalMs: 60_000 });
    const stop2 = startHeartbeatScheduler({ intervalMs: 60_000 });
    // Both stop fns refer to the same underlying timer; calling either is safe.
    stop1();
    stop2();
  });
});
