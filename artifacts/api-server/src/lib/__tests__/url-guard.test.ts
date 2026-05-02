import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { validateOutboundUrl } from "../url-guard";

const SAVED_ENV: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "QUEENSYNC_ALLOW_HTTP",
  "QUEENSYNC_ALLOW_PRIVATE_HOSTS",
  "QUEENSYNC_ALLOWED_HOSTS",
] as const;

before(() => {
  for (const k of ENV_KEYS) SAVED_ENV[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
});

after(() => {
  for (const k of ENV_KEYS) {
    if (SAVED_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_ENV[k];
  }
});

describe("validateOutboundUrl", () => {
  it("accepts plain https URL on a public host", () => {
    const r = validateOutboundUrl("https://radio.ninja-portal.com/health");
    assert.equal(r.ok, true, r.reason);
  });

  it("rejects empty / null / undefined input", () => {
    assert.equal(validateOutboundUrl("").ok, false);
    assert.equal(validateOutboundUrl(null).ok, false);
    assert.equal(validateOutboundUrl(undefined).ok, false);
  });

  it("rejects unparseable URLs", () => {
    assert.equal(validateOutboundUrl("not a url").ok, false);
    assert.equal(validateOutboundUrl("javascript:alert(1)").ok, false);
  });

  it("rejects non-https schemes by default", () => {
    assert.equal(validateOutboundUrl("http://example.com").ok, false);
    assert.equal(validateOutboundUrl("ftp://example.com").ok, false);
    assert.equal(validateOutboundUrl("file:///etc/passwd").ok, false);
    assert.equal(validateOutboundUrl("gopher://example.com").ok, false);
  });

  it("rejects loopback addresses and hostnames", () => {
    assert.equal(validateOutboundUrl("https://localhost/x").ok, false);
    assert.equal(validateOutboundUrl("https://127.0.0.1/x").ok, false);
    assert.equal(validateOutboundUrl("https://127.5.5.5/x").ok, false);
    assert.equal(validateOutboundUrl("https://[::1]/x").ok, false);
    assert.equal(validateOutboundUrl("https://0.0.0.0/x").ok, false);
  });

  it("rejects RFC1918 private IPv4 ranges", () => {
    for (const host of [
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.20.5.5",
      "172.31.255.254",
      "192.168.1.1",
    ]) {
      const r = validateOutboundUrl(`https://${host}/x`);
      assert.equal(r.ok, false, `${host} should be blocked`);
    }
  });

  it("rejects link-local and cloud metadata addresses", () => {
    assert.equal(validateOutboundUrl("https://169.254.169.254/latest/meta-data/").ok, false);
    assert.equal(validateOutboundUrl("https://169.254.0.1/x").ok, false);
    assert.equal(validateOutboundUrl("https://metadata.google.internal/x").ok, false);
    assert.equal(validateOutboundUrl("https://metadata/x").ok, false);
    assert.equal(validateOutboundUrl("https://metadata.azure.com/x").ok, false);
  });

  it("rejects IPv6 link-local, ULA, and IPv4-mapped private addresses", () => {
    assert.equal(validateOutboundUrl("https://[fe80::1]/x").ok, false);
    assert.equal(validateOutboundUrl("https://[fc00::1]/x").ok, false);
    assert.equal(validateOutboundUrl("https://[fd00::1]/x").ok, false);
    assert.equal(validateOutboundUrl("https://[::ffff:127.0.0.1]/x").ok, false);
    assert.equal(validateOutboundUrl("https://[::ffff:10.0.0.1]/x").ok, false);
  });

  it("rejects CGNAT and multicast/reserved ranges", () => {
    assert.equal(validateOutboundUrl("https://100.64.0.1/x").ok, false);
    assert.equal(validateOutboundUrl("https://224.0.0.1/x").ok, false);
    assert.equal(validateOutboundUrl("https://255.255.255.255/x").ok, false);
  });

  it("allows http only when QUEENSYNC_ALLOW_HTTP=true", () => {
    assert.equal(validateOutboundUrl("http://example.com").ok, false);
    process.env["QUEENSYNC_ALLOW_HTTP"] = "true";
    try {
      assert.equal(validateOutboundUrl("http://example.com").ok, true);
    } finally {
      delete process.env["QUEENSYNC_ALLOW_HTTP"];
    }
  });

  it("allows private hosts when QUEENSYNC_ALLOW_PRIVATE_HOSTS=true", () => {
    assert.equal(validateOutboundUrl("https://127.0.0.1/x").ok, false);
    process.env["QUEENSYNC_ALLOW_PRIVATE_HOSTS"] = "true";
    try {
      assert.equal(validateOutboundUrl("https://127.0.0.1/x").ok, true);
      assert.equal(validateOutboundUrl("https://10.0.0.1/x").ok, true);
    } finally {
      delete process.env["QUEENSYNC_ALLOW_PRIVATE_HOSTS"];
    }
  });

  it("still rejects private hosts when allow-private is on but cloud metadata sneaks through allowlist", () => {
    process.env["QUEENSYNC_ALLOWED_HOSTS"] = "ninja-portal.com";
    try {
      assert.equal(
        validateOutboundUrl("https://radio.ninja-portal.com/health").ok,
        true,
      );
      assert.equal(
        validateOutboundUrl("https://169.254.169.254/").ok,
        false,
        "metadata host must not match allowlist entry",
      );
      assert.equal(
        validateOutboundUrl("https://attacker.example.com/").ok,
        false,
      );
    } finally {
      delete process.env["QUEENSYNC_ALLOWED_HOSTS"];
    }
  });

  it("rejects metadata hosts even if explicitly listed in the allowlist", () => {
    process.env["QUEENSYNC_ALLOWED_HOSTS"] =
      "169.254.169.254,localhost,metadata.google.internal";
    try {
      for (const u of [
        "https://169.254.169.254/latest/meta-data/",
        "https://localhost/admin",
        "https://metadata.google.internal/x",
      ]) {
        assert.equal(
          validateOutboundUrl(u).ok,
          false,
          `${u} must remain blocked even when allowlisted`,
        );
      }
    } finally {
      delete process.env["QUEENSYNC_ALLOWED_HOSTS"];
    }
  });

  it("rejects private IP allowlist entries unless allow-private is set", () => {
    process.env["QUEENSYNC_ALLOWED_HOSTS"] = "10.0.0.5,192.168.1.1";
    try {
      assert.equal(validateOutboundUrl("https://10.0.0.5/x").ok, false);
      assert.equal(validateOutboundUrl("https://192.168.1.1/x").ok, false);
      process.env["QUEENSYNC_ALLOW_PRIVATE_HOSTS"] = "true";
      assert.equal(validateOutboundUrl("https://10.0.0.5/x").ok, true);
      assert.equal(validateOutboundUrl("https://192.168.1.1/x").ok, true);
      // Metadata host is still blocked even with both flags on.
      assert.equal(validateOutboundUrl("https://169.254.169.254/").ok, false);
    } finally {
      delete process.env["QUEENSYNC_ALLOWED_HOSTS"];
      delete process.env["QUEENSYNC_ALLOW_PRIVATE_HOSTS"];
    }
  });

  it("rejects metadata hosts even when QUEENSYNC_ALLOW_PRIVATE_HOSTS=true", () => {
    process.env["QUEENSYNC_ALLOW_PRIVATE_HOSTS"] = "true";
    try {
      // Loopback is permitted under the dev override...
      assert.equal(validateOutboundUrl("https://localhost/admin").ok, true);
      assert.equal(validateOutboundUrl("https://127.0.0.1/x").ok, true);
      // ...but cloud metadata endpoints remain blocked.
      assert.equal(validateOutboundUrl("https://169.254.169.254/").ok, false);
      assert.equal(validateOutboundUrl("https://metadata/x").ok, false);
      assert.equal(
        validateOutboundUrl("https://metadata.google.internal/x").ok,
        false,
      );
    } finally {
      delete process.env["QUEENSYNC_ALLOW_PRIVATE_HOSTS"];
    }
  });
});
