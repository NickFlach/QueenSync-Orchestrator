import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  __resetForTests,
  incrementDispatch,
  renderJson,
  renderPrometheus,
  snapshot,
} from "../metrics";

beforeEach(() => {
  __resetForTests();
});

describe("metrics", () => {
  it("starts empty", () => {
    assert.deepEqual(snapshot(), []);
    const text = renderPrometheus();
    assert.match(text, /^# HELP oracle_admin_dispatch_total/);
    assert.match(text, /oracle_admin_uptime_seconds \d+/);
  });

  it("accumulates counts per (capability, status)", () => {
    incrementDispatch("restart_radio", "accepted");
    incrementDispatch("restart_radio", "accepted");
    incrementDispatch("restart_radio", "completed");
    incrementDispatch("dream_trigger", "rejected_capability");

    const rows = snapshot();
    assert.equal(rows.length, 3);
    const radioAccepted = rows.find(
      (r) => r.capability === "restart_radio" && r.status === "accepted",
    );
    assert.equal(radioAccepted?.count, 2);
    const radioCompleted = rows.find(
      (r) => r.capability === "restart_radio" && r.status === "completed",
    );
    assert.equal(radioCompleted?.count, 1);
    const dreamRejected = rows.find(
      (r) => r.capability === "dream_trigger" && r.status === "rejected_capability",
    );
    assert.equal(dreamRejected?.count, 1);
  });

  it("renders Prometheus exposition with labels", () => {
    incrementDispatch("restart_radio", "completed");
    incrementDispatch("setOverride", "failed");

    const text = renderPrometheus();
    assert.match(
      text,
      /oracle_admin_dispatch_total\{capability="restart_radio",status="completed"\} 1/,
    );
    assert.match(
      text,
      /oracle_admin_dispatch_total\{capability="setOverride",status="failed"\} 1/,
    );
  });

  it("renders JSON snapshot", () => {
    incrementDispatch("kannaka_status", "completed");
    const json = renderJson();
    assert.equal(typeof json.uptimeSeconds, "number");
    assert.equal(json.dispatches.length, 1);
    assert.deepEqual(json.dispatches[0], {
      capability: "kannaka_status",
      status: "completed",
      count: 1,
    });
  });

  it("buckets empty capability under 'unknown' (e.g. pre-payload rejections)", () => {
    incrementDispatch("", "rejected_signature");
    const rows = snapshot();
    assert.equal(rows[0]?.capability, "unknown");
    assert.equal(rows[0]?.status, "rejected_signature");
  });
});
