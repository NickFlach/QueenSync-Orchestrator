import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  signOracleAdminBody,
  verifyOracleAdminBody,
  isOracleAdminSigningConfigured,
  ORACLE_ADMIN_SIGNATURE_HEADER,
  ORACLE_ADMIN_TIMESTAMP_HEADER,
} from "../auth";

const SECRET = "hmac-test-secret-please-rotate";

describe("oracle-admin HMAC body signing", () => {
  let prev: string | undefined;
  before(() => {
    prev = process.env["QUEENSYNC_ORACLE_ADMIN_HMAC_SECRET"];
    process.env["QUEENSYNC_ORACLE_ADMIN_HMAC_SECRET"] = SECRET;
  });
  after(() => {
    if (prev === undefined) delete process.env["QUEENSYNC_ORACLE_ADMIN_HMAC_SECRET"];
    else process.env["QUEENSYNC_ORACLE_ADMIN_HMAC_SECRET"] = prev;
  });

  it("isOracleAdminSigningConfigured reflects env state", () => {
    assert.equal(isOracleAdminSigningConfigured(), true);
  });

  it("exposes lowercase header constants matching the shim", () => {
    assert.equal(ORACLE_ADMIN_TIMESTAMP_HEADER, "x-queensync-timestamp");
    assert.equal(ORACLE_ADMIN_SIGNATURE_HEADER, "x-queensync-body-signature");
  });

  it("signOracleAdminBody produces a verifiable signature", () => {
    const body = JSON.stringify({ taskId: "t1", x: 1 });
    const now = Date.now();
    const out = signOracleAdminBody(body, now);
    assert.ok(out, "expected a signature when secret is configured");
    assert.equal(out!.timestamp, String(now));

    // Round-trip through the verifier.
    const v = verifyOracleAdminBody({
      body,
      timestamp: out!.timestamp,
      signature: out!.signature,
      secret: SECRET,
      now,
    });
    assert.deepEqual(v, { ok: true });
  });

  it("signature uses sha256(timestamp:body) format", () => {
    const body = "{}";
    const out = signOracleAdminBody(body, 1700000000000);
    const expected =
      "sha256=" +
      createHmac("sha256", SECRET)
        .update(`1700000000000:${body}`)
        .digest("hex");
    assert.equal(out!.signature, expected);
  });

  it("verifier rejects a body that has been tampered with", () => {
    const original = JSON.stringify({ taskId: "t1" });
    const now = Date.now();
    const out = signOracleAdminBody(original, now);
    const v = verifyOracleAdminBody({
      body: JSON.stringify({ taskId: "t1", evil: true }),
      timestamp: out!.timestamp,
      signature: out!.signature,
      secret: SECRET,
      now,
    });
    assert.equal(v.ok, false);
    assert.match(v.reason ?? "", /invalid signature/);
  });

  it("verifier rejects timestamps outside the ±5min window", () => {
    const body = "{}";
    const now = Date.now();
    const old = now - 10 * 60_000;
    const out = signOracleAdminBody(body, old);
    const v = verifyOracleAdminBody({
      body,
      timestamp: out!.timestamp,
      signature: out!.signature,
      secret: SECRET,
      now,
    });
    assert.equal(v.ok, false);
    assert.match(v.reason ?? "", /tolerance/);
  });

  it("returns null + skips signing when secret is unset", () => {
    delete process.env["QUEENSYNC_ORACLE_ADMIN_HMAC_SECRET"];
    assert.equal(isOracleAdminSigningConfigured(), false);
    assert.equal(signOracleAdminBody("{}"), null);
    process.env["QUEENSYNC_ORACLE_ADMIN_HMAC_SECRET"] = SECRET;
  });
});
