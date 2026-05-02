import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db, armsTable } from "@workspace/db";
import { seedDefaults } from "../seed";

const REAL_IDS = [
  "radio",
  "observatory",
  "kannaka-prime",
  "swarm-worker",
  "oracle-admin",
];
const MOCK_IDS = [
  "architect_01",
  "atelier_01",
  "signal_keeper_01",
  "memory_keeper_01",
  "auditor_01",
];

async function clean() {
  await db.delete(armsTable).where(inArray(armsTable.id, [...REAL_IDS, ...MOCK_IDS]));
}

let prevFlag: string | undefined;
before(async () => {
  prevFlag = process.env["QUEENSYNC_SEED_MOCK_ARMS"];
  await clean();
});
afterEach(async () => {
  await clean();
});
after(() => {
  if (prevFlag === undefined) delete process.env["QUEENSYNC_SEED_MOCK_ARMS"];
  else process.env["QUEENSYNC_SEED_MOCK_ARMS"] = prevFlag;
});

async function ids(): Promise<string[]> {
  const rows = await db
    .select({ id: armsTable.id })
    .from(armsTable)
    .where(inArray(armsTable.id, [...REAL_IDS, ...MOCK_IDS]));
  return rows.map((r) => r.id).sort();
}

describe("seedDefaults", () => {
  it("seeds only the real arms when QUEENSYNC_SEED_MOCK_ARMS is unset", async () => {
    delete process.env["QUEENSYNC_SEED_MOCK_ARMS"];
    await seedDefaults();
    const got = await ids();
    for (const id of REAL_IDS) assert.ok(got.includes(id), `missing ${id}`);
    for (const id of MOCK_IDS) assert.ok(!got.includes(id), `unexpected mock ${id}`);
  });

  it("also seeds mock arms when QUEENSYNC_SEED_MOCK_ARMS=true", async () => {
    process.env["QUEENSYNC_SEED_MOCK_ARMS"] = "true";
    await seedDefaults();
    const got = await ids();
    for (const id of [...REAL_IDS, ...MOCK_IDS]) {
      assert.ok(got.includes(id), `missing ${id}`);
    }
  });

  it("removes mock arms when the flag is flipped back off", async () => {
    process.env["QUEENSYNC_SEED_MOCK_ARMS"] = "true";
    await seedDefaults();
    delete process.env["QUEENSYNC_SEED_MOCK_ARMS"];
    await seedDefaults();
    const got = await ids();
    for (const id of REAL_IDS) assert.ok(got.includes(id), `missing ${id}`);
    for (const id of MOCK_IDS) assert.ok(!got.includes(id), `lingering mock ${id}`);
  });

  it("oracle-admin is seeded with type=oracle_admin and the six capabilities", async () => {
    delete process.env["QUEENSYNC_SEED_MOCK_ARMS"];
    await seedDefaults();
    const [row] = await db
      .select()
      .from(armsTable)
      .where(eq(armsTable.id, "oracle-admin"));
    assert.ok(row, "oracle-admin row missing");
    assert.equal(row.type, "oracle_admin");
    for (const cap of [
      "restart_radio",
      "restart_observatory",
      "trigger_oration_now",
      "setOverride",
      "dream_trigger",
      "kannaka_status",
    ]) {
      assert.ok(row.capabilities.includes(cap), `missing capability ${cap}`);
    }
  });

  it("real arms default to status=idle; arms with heartbeatUrl get a baseline lastHeartbeat (so the staleness sweep can later demote them); NATS-only arms stay NULL", async () => {
    delete process.env["QUEENSYNC_SEED_MOCK_ARMS"];
    await seedDefaults();
    const rows = await db
      .select({
        id: armsTable.id,
        status: armsTable.status,
        heartbeatUrl: armsTable.heartbeatUrl,
        lastHeartbeat: armsTable.lastHeartbeat,
      })
      .from(armsTable)
      .where(inArray(armsTable.id, REAL_IDS));
    for (const r of rows) {
      assert.equal(r.status, "idle", `${r.id} expected idle, got ${r.status}`);
      if (r.heartbeatUrl) {
        assert.ok(
          r.lastHeartbeat instanceof Date,
          `${r.id} has heartbeatUrl=${r.heartbeatUrl} so lastHeartbeat should be bootstrapped to now()`,
        );
      } else {
        // kannaktopus arms (kannaka-prime, swarm-worker) have no
        // heartbeatUrl — their availability is tracked via the NATS bridge
        // (follow-up #20), not the HTTP probe.
        assert.equal(
          r.lastHeartbeat,
          null,
          `${r.id} has no heartbeatUrl so lastHeartbeat should stay NULL`,
        );
      }
    }
  });
});
