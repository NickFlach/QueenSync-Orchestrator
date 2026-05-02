import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { safeFetch, BlockedUrlError } from "../safe-fetch";

describe("safeFetch", () => {
  it("throws BlockedUrlError for non-https URLs", async () => {
    await assert.rejects(
      () => safeFetch("http://example.com"),
      (err: unknown) => err instanceof BlockedUrlError,
    );
  });

  it("throws BlockedUrlError for cloud metadata IPs", async () => {
    await assert.rejects(
      () => safeFetch("https://169.254.169.254/latest/meta-data/"),
      (err: unknown) => err instanceof BlockedUrlError,
    );
  });

  it("throws BlockedUrlError for loopback hostnames", async () => {
    await assert.rejects(
      () => safeFetch("https://localhost/healthz"),
      (err: unknown) => err instanceof BlockedUrlError,
    );
  });

  it("throws BlockedUrlError for RFC1918 ranges", async () => {
    for (const url of [
      "https://10.0.0.1/x",
      "https://192.168.1.1/x",
      "https://172.16.0.1/x",
    ]) {
      await assert.rejects(
        () => safeFetch(url),
        (err: unknown) => err instanceof BlockedUrlError,
        `expected ${url} to be blocked`,
      );
    }
  });

  it("throws BlockedUrlError for unparseable URL", async () => {
    await assert.rejects(
      () => safeFetch("not-a-url"),
      (err: unknown) => err instanceof BlockedUrlError,
    );
  });

  it("attaches the offending URL and reason on the error", async () => {
    try {
      await safeFetch("http://10.0.0.1/x");
      assert.fail("expected BlockedUrlError");
    } catch (err) {
      assert.ok(err instanceof BlockedUrlError);
      assert.equal(err.url, "http://10.0.0.1/x");
      assert.match(err.reason, /https required|Protocol/);
    }
  });
});
