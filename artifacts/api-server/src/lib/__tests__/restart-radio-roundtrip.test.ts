import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  signOracleAdminBody,
  verifyOracleAdminBody,
  signCallback,
} from "../auth";

const HMAC_SECRET = "restart-radio-roundtrip-hmac";
const CALLBACK_SECRET = "restart-radio-roundtrip-callback";

describe("Restart Radio dispatch round-trip (api-server ↔ oracle-admin)", () => {
  let prevHmac: string | undefined;
  let prevCb: string | undefined;
  before(() => {
    prevHmac = process.env["QUEENSYNC_ORACLE_ADMIN_HMAC_SECRET"];
    prevCb = process.env["QUEENSYNC_CALLBACK_SECRET"];
    process.env["QUEENSYNC_ORACLE_ADMIN_HMAC_SECRET"] = HMAC_SECRET;
    process.env["QUEENSYNC_CALLBACK_SECRET"] = CALLBACK_SECRET;
  });
  after(() => {
    if (prevHmac === undefined)
      delete process.env["QUEENSYNC_ORACLE_ADMIN_HMAC_SECRET"];
    else process.env["QUEENSYNC_ORACLE_ADMIN_HMAC_SECRET"] = prevHmac;
    if (prevCb === undefined) delete process.env["QUEENSYNC_CALLBACK_SECRET"];
    else process.env["QUEENSYNC_CALLBACK_SECRET"] = prevCb;
  });

  it("dispatch HMAC verifies on the shim and per-task callback signatures match the shared formula", () => {
    const taskId = "tk_restart_radio_e2e";
    const body = JSON.stringify({
      taskId,
      intent: "Restart radio",
      requiredCapability: "restart_radio",
      priority: "normal",
      context: {},
      callbackUrl: `https://queensync.test/api/tasks/${taskId}/callback`,
      armId: "oracle-admin",
    });

    const dispatchSig = signOracleAdminBody(body);
    assert.ok(dispatchSig);

    const verified = verifyOracleAdminBody({
      body,
      timestamp: dispatchSig.timestamp,
      signature: dispatchSig.signature,
      secret: HMAC_SECRET,
    });
    assert.ok(verified.ok, verified.reason);

    const completedSig = signCallback(taskId, "completed");
    const failedSig = signCallback(taskId, "failed");
    assert.ok(completedSig);
    assert.ok(failedSig);

    const expectedCompleted = `sha256=${createHmac("sha256", CALLBACK_SECRET)
      .update(`${taskId}:completed`)
      .digest("hex")}`;
    assert.equal(completedSig, expectedCompleted);
  });

  it("rejects a tampered dispatch body", () => {
    const original = JSON.stringify({ taskId: "t2", capability: "restart_radio" });
    const tampered = JSON.stringify({ taskId: "t2", capability: "setOverride" });
    const sig = signOracleAdminBody(original);
    assert.ok(sig);
    const verified = verifyOracleAdminBody({
      body: tampered,
      timestamp: sig.timestamp,
      signature: sig.signature,
      secret: HMAC_SECRET,
    });
    assert.equal(verified.ok, false);
  });

  it("signCallback returns null without QUEENSYNC_CALLBACK_SECRET", () => {
    const prev = process.env["QUEENSYNC_CALLBACK_SECRET"];
    delete process.env["QUEENSYNC_CALLBACK_SECRET"];
    try {
      assert.equal(signCallback("tk_x", "completed"), null);
    } finally {
      if (prev === undefined) delete process.env["QUEENSYNC_CALLBACK_SECRET"];
      else process.env["QUEENSYNC_CALLBACK_SECRET"] = prev;
    }
  });
});
