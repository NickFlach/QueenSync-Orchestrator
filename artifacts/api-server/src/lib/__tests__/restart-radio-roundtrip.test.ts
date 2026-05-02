import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  signOracleAdminBody,
  verifyOracleAdminBody,
  signCallback,
  ORACLE_ADMIN_SIGNATURE_HEADER,
  ORACLE_ADMIN_TIMESTAMP_HEADER,
} from "../auth";

const HMAC_SECRET = "restart-radio-roundtrip-hmac";
const CALLBACK_SECRET = "restart-radio-roundtrip-callback";

describe("Restart Radio end-to-end signature round-trip (api-server ↔ oracle-admin)", () => {
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

  it("dispatch HMAC verifies on the shim AND the per-task callback signature is echo-able", () => {
    // Simulate a Restart Radio dispatch payload built by router.ts.
    const taskId = "tk_restart_radio_e2e";
    const payload = {
      taskId,
      intent: "Restart radio",
      requiredCapability: "restart_radio",
      priority: "normal",
      context: {},
      callbackUrl: "https://queensync.test/api/tasks/tk_restart_radio_e2e/callback",
      armId: "oracle-admin",
    };
    const body = JSON.stringify(payload);

    // 1. api-server signs the dispatch body.
    const dispatchSig = signOracleAdminBody(body);
    assert.ok(dispatchSig, "router must produce a signature when secret is set");

    // 2. shim verifies the same body bytes with the shared secret. We
    //    re-implement verify here using the api-server helpers so the
    //    test exercises both sides without importing the shim package.
    const verified = verifyOracleAdminBody({
      body,
      timestamp: dispatchSig.timestamp,
      signature: dispatchSig.signature,
      secret: HMAC_SECRET,
    });
    assert.ok(verified.ok, `verify failed: ${verified.reason}`);

    // 3. api-server also writes per-task callback signatures on the
    //    dispatch (X-QueenSync-Completed-Signature / -Failed-Signature)
    //    that the shim echoes back unchanged on the callback. The
    //    callback handler must accept the echoed signature, so we
    //    confirm signCallback() produces a value (i.e. CALLBACK_SECRET
    //    is honored) and that it matches an independent HMAC.
    const completedSig = signCallback(taskId, "completed");
    const failedSig = signCallback(taskId, "failed");
    assert.ok(completedSig, "completed callback signature must be produced");
    assert.ok(failedSig, "failed callback signature must be produced");

    const independentCompleted = `sha256=${createHmac("sha256", CALLBACK_SECRET)
      .update(`${taskId}:completed`)
      .digest("hex")}`;
    assert.equal(completedSig, independentCompleted);
  });

  it("a tampered body fails dispatch verification (privileged dispatch is rejected)", () => {
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

  it("callback signing returns null when QUEENSYNC_CALLBACK_SECRET is absent — making the deployment requirement observable", () => {
    const prev = process.env["QUEENSYNC_CALLBACK_SECRET"];
    delete process.env["QUEENSYNC_CALLBACK_SECRET"];
    try {
      const sig = signCallback("tk_x", "completed");
      assert.equal(
        sig,
        null,
        "without QUEENSYNC_CALLBACK_SECRET, no callback signature is produced — operators MUST set this before enabling Restart Radio",
      );
    } finally {
      if (prev === undefined) delete process.env["QUEENSYNC_CALLBACK_SECRET"];
      else process.env["QUEENSYNC_CALLBACK_SECRET"] = prev;
    }
  });
});

// Suppress unused-import lint when ORACLE_ADMIN_*_HEADER constants would
// otherwise be unused — they are exercised by auth-oracle.test.ts but
// referenced here for documentation alignment.
void ORACLE_ADMIN_SIGNATURE_HEADER;
void ORACLE_ADMIN_TIMESTAMP_HEADER;
