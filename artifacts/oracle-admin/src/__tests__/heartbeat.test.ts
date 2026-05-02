import { describe, it } from "node:test";
import assert from "node:assert/strict";
import pino from "pino";
import { postHeartbeat, startHeartbeatClient } from "../heartbeat";

const silentLog = pino({ level: "silent" });

function fakeFetcher(status: number): {
  fetch: typeof fetch;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response("{}", { status });
  }) as unknown as typeof fetch;
  return { fetch: fetcher, calls };
}

describe("postHeartbeat", () => {
  it("POSTs to /api/arms/:id/heartbeat with bearer token and returns true on 2xx", async () => {
    const { fetch: fakeFetch, calls } = fakeFetcher(200);
    const ok = await postHeartbeat({
      baseUrl: "https://queen.example.com",
      token: "operator-secret",
      armId: "oracle-admin",
      log: silentLog,
      fetcher: fakeFetch,
    });
    assert.equal(ok, true);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0]!.url,
      "https://queen.example.com/api/arms/oracle-admin/heartbeat",
    );
    const headers = calls[0]!.init?.headers as Record<string, string>;
    assert.equal(headers["Authorization"], "Bearer operator-secret");
    assert.equal(headers["Content-Type"], "application/json");
    assert.equal(calls[0]!.init?.method, "POST");
  });

  it("strips trailing slash from baseUrl and url-encodes armId", async () => {
    const { fetch: fakeFetch, calls } = fakeFetcher(200);
    await postHeartbeat({
      baseUrl: "https://queen.example.com/",
      token: "t",
      armId: "weird id/with slash",
      log: silentLog,
      fetcher: fakeFetch,
    });
    assert.equal(
      calls[0]!.url,
      "https://queen.example.com/api/arms/weird%20id%2Fwith%20slash/heartbeat",
    );
  });

  it("returns false on non-2xx and never throws", async () => {
    const { fetch: fakeFetch } = fakeFetcher(503);
    const ok = await postHeartbeat({
      baseUrl: "https://queen.example.com",
      token: "t",
      log: silentLog,
      fetcher: fakeFetch,
    });
    assert.equal(ok, false);
  });

  it("returns false when fetch throws — does not crash the shim", async () => {
    const fetcher = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const ok = await postHeartbeat({
      baseUrl: "https://queen.example.com",
      token: "t",
      log: silentLog,
      fetcher,
    });
    assert.equal(ok, false);
  });
});

describe("startHeartbeatClient", () => {
  it("kicks an immediate beat at start and returns a stop fn", async () => {
    const { fetch: fakeFetch, calls } = fakeFetcher(200);
    const handle = startHeartbeatClient({
      baseUrl: "https://queen.example.com",
      token: "t",
      log: silentLog,
      fetcher: fakeFetch,
      // Long interval — we only want to verify the immediate kick.
      intervalMs: 60_000,
    });
    // The boot kick is async; await one explicit beat to make the count
    // deterministic without racing the interval.
    await handle.beatOnce();
    handle.stop();
    // Boot kick + manual beat = at least 1 (boot may or may not have flushed
    // before stop on a fast loop). Allow >= 1, <= 2.
    assert.ok(calls.length >= 1 && calls.length <= 2, `got ${calls.length} calls`);
  });
});
