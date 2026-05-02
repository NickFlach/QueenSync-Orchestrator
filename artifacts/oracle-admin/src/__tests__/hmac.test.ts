import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyHmacBody } from "../hmac";

const SECRET = "test-secret-do-not-use-in-prod";

function sign(body: string, ts: string): string {
  return (
    "sha256=" +
    createHmac("sha256", SECRET).update(`${ts}:${body}`).digest("hex")
  );
}

describe("verifyHmacBody", () => {
  it("accepts a fresh, well-signed body", () => {
    const body = JSON.stringify({ taskId: "t1", requiredCapability: "restart_radio" });
    const now = Date.now();
    const ts = String(now);
    const sig = sign(body, ts);
    const r = verifyHmacBody({
      body,
      timestamp: ts,
      signature: sig,
      secret: SECRET,
      now,
    });
    assert.deepEqual(r, { ok: true });
  });

  it("rejects when timestamp is missing", () => {
    const r = verifyHmacBody({
      body: "{}",
      timestamp: undefined,
      signature: "sha256=00",
      secret: SECRET,
    });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /missing timestamp/);
  });

  it("rejects when signature is missing", () => {
    const now = Date.now();
    const r = verifyHmacBody({
      body: "{}",
      timestamp: String(now),
      signature: undefined,
      secret: SECRET,
      now,
    });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /missing signature/);
  });

  it("rejects timestamps older than the tolerance window", () => {
    const body = "{}";
    const now = Date.now();
    const oldTs = String(now - 10 * 60_000); // 10min in the past
    const sig = sign(body, oldTs);
    const r = verifyHmacBody({
      body,
      timestamp: oldTs,
      signature: sig,
      secret: SECRET,
      now,
    });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /tolerance/);
  });

  it("rejects when the signature does not match the body", () => {
    const now = Date.now();
    const ts = String(now);
    const sig = sign("{}", ts);
    const r = verifyHmacBody({
      body: '{"tampered":true}',
      timestamp: ts,
      signature: sig,
      secret: SECRET,
      now,
    });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /invalid signature/);
  });

  it("rejects when the signature was made with a different secret", () => {
    const body = "{}";
    const now = Date.now();
    const ts = String(now);
    const wrong =
      "sha256=" +
      createHmac("sha256", "other-secret").update(`${ts}:${body}`).digest("hex");
    const r = verifyHmacBody({
      body,
      timestamp: ts,
      signature: wrong,
      secret: SECRET,
      now,
    });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /invalid signature/);
  });

  it("rejects when the timestamp is non-numeric", () => {
    const r = verifyHmacBody({
      body: "{}",
      timestamp: "not-a-number",
      signature: "sha256=00",
      secret: SECRET,
    });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /invalid timestamp/);
  });
});
