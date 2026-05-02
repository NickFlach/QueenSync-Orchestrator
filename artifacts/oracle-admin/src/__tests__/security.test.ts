import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isCapabilityEnabled,
  isIpAllowed,
  normalizeIp,
  parseCapabilityList,
  parseIpList,
  SlidingWindowRateLimiter,
} from "../security";

describe("normalizeIp", () => {
  it("strips IPv4-mapped-IPv6 prefix", () => {
    assert.equal(normalizeIp("::ffff:1.2.3.4"), "1.2.3.4");
    assert.equal(normalizeIp("::FFFF:10.0.0.1"), "10.0.0.1");
  });

  it("lowercases and trims zone identifiers", () => {
    assert.equal(normalizeIp("FE80::1%eth0"), "fe80::1");
  });

  it("leaves bare IPv4 alone", () => {
    assert.equal(normalizeIp("127.0.0.1"), "127.0.0.1");
  });
});

describe("parseIpList / isIpAllowed", () => {
  it("empty allowlist allows everyone", () => {
    const set = parseIpList(undefined);
    assert.equal(set.size, 0);
    assert.equal(isIpAllowed("8.8.8.8", set), true);
    assert.equal(isIpAllowed(undefined, set), true);
  });

  it("non-empty allowlist requires exact normalized match", () => {
    const set = parseIpList("1.2.3.4, 5.6.7.8 , ::ffff:9.9.9.9");
    assert.equal(set.size, 3);
    assert.equal(isIpAllowed("1.2.3.4", set), true);
    assert.equal(isIpAllowed("::ffff:1.2.3.4", set), true);
    assert.equal(isIpAllowed("9.9.9.9", set), true);
    assert.equal(isIpAllowed("8.8.8.8", set), false);
    assert.equal(isIpAllowed(undefined, set), false);
  });

  it("ignores blank entries", () => {
    const set = parseIpList(",, ,1.1.1.1,,");
    assert.deepEqual(Array.from(set), ["1.1.1.1"]);
  });
});

describe("parseCapabilityList / isCapabilityEnabled", () => {
  it("returns null when unset (all capabilities allowed)", () => {
    assert.equal(parseCapabilityList(undefined), null);
    assert.equal(isCapabilityEnabled("dream_trigger", null), true);
  });

  it("treats explicit-empty as 'no configuration' (fail-open) for safety", () => {
    // Operator that exports an empty value shouldn't accidentally lock
    // out the entire shim.
    assert.equal(parseCapabilityList(""), null);
    assert.equal(parseCapabilityList(" , , "), null);
  });

  it("only the listed capabilities are enabled", () => {
    const set = parseCapabilityList("restart_radio,kannaka_status");
    assert.ok(set);
    assert.equal(isCapabilityEnabled("restart_radio", set), true);
    assert.equal(isCapabilityEnabled("kannaka_status", set), true);
    assert.equal(isCapabilityEnabled("dream_trigger", set), false);
  });
});

describe("SlidingWindowRateLimiter", () => {
  it("allows up to max within the window, then blocks", () => {
    let now = 1_000_000;
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 60_000,
      max: 3,
      now: () => now,
    });
    assert.equal(limiter.check("a").allowed, true);
    assert.equal(limiter.check("a").allowed, true);
    assert.equal(limiter.check("a").allowed, true);
    const blocked = limiter.check("a");
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterMs > 0);
    assert.ok(blocked.retryAfterMs <= 60_000);
  });

  it("isolates separate keys", () => {
    let now = 1_000_000;
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 60_000,
      max: 1,
      now: () => now,
    });
    assert.equal(limiter.check("a").allowed, true);
    assert.equal(limiter.check("a").allowed, false);
    assert.equal(limiter.check("b").allowed, true);
  });

  it("oldest hit ages out so a new one is admitted", () => {
    let now = 1_000_000;
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 60_000,
      max: 2,
      now: () => now,
    });
    assert.equal(limiter.check("a").allowed, true); // t=1_000_000
    now += 30_000;
    assert.equal(limiter.check("a").allowed, true); // t=1_030_000
    now += 5_000;
    assert.equal(limiter.check("a").allowed, false);
    now += 30_000; // first hit now 65s old → expired
    assert.equal(limiter.check("a").allowed, true);
  });

  it("max=0 blocks everything (kill switch)", () => {
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 60_000,
      max: 0,
    });
    const r = limiter.check("a");
    assert.equal(r.allowed, false);
  });

  it("reap drops stale buckets to bound memory", () => {
    let now = 1_000_000;
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 60_000,
      max: 5,
      now: () => now,
    });
    limiter.check("a");
    limiter.check("b");
    assert.equal(limiter.size(), 2);
    now += 120_000;
    limiter.reap();
    assert.equal(limiter.size(), 0);
  });
});
