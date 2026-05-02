import { describe, it } from "node:test";
import assert from "node:assert/strict";
import pino from "pino";
import { runDispatch, type DispatchPayload } from "../dispatch";

const silentLog = pino({ level: "silent" });

function fakeFetcherOk(): {
  fetch: typeof fetch;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: fetcher, calls };
}

describe("runDispatch", () => {
  it("trigger_oration_now → posts to radio and acks completed", async () => {
    const { fetch: fakeFetch, calls } = fakeFetcherOk();
    const payload: DispatchPayload = {
      taskId: "t-orate",
      requiredCapability: "trigger_oration_now",
      callbackUrl: "https://queen.example.com/api/tasks/t-orate/callback",
      intent: "Sing the chord",
    };
    await runDispatch(payload, silentLog, {
      fetcher: fakeFetch,
      headers: {
        completedSignature: "sha256=expected-completed",
        failedSignature: "sha256=expected-failed",
      },
    });

    // Two calls: oration trigger + callback.
    assert.equal(calls.length, 2);
    assert.match(calls[0]!.url, /\/admin\/oration\/now$/);
    const cb = calls[1]!;
    assert.match(cb.url, /\/api\/tasks\/t-orate\/callback$/);
    const cbBody = JSON.parse(String(cb.init?.body ?? "{}"));
    assert.equal(cbBody.status, "completed");
    assert.match(cbBody.result, /oration triggered/);
    const cbHeaders = cb.init?.headers as Record<string, string>;
    assert.equal(cbHeaders["X-QueenSync-Signature"], "sha256=expected-completed");
  });

  it("unknown capability → acks failed with explanation", async () => {
    const { fetch: fakeFetch, calls } = fakeFetcherOk();
    const payload: DispatchPayload = {
      taskId: "t-bogus",
      requiredCapability: "nope_not_real",
      callbackUrl: "https://queen.example.com/api/tasks/t-bogus/callback",
    };
    await runDispatch(payload, silentLog, {
      fetcher: fakeFetch,
      headers: {
        completedSignature: "sha256=ok",
        failedSignature: "sha256=fail",
      },
    });
    assert.equal(calls.length, 1);
    const cb = calls[0]!;
    const cbBody = JSON.parse(String(cb.init?.body ?? "{}"));
    assert.equal(cbBody.status, "failed");
    assert.match(cbBody.error, /unsupported capability/);
    const cbHeaders = cb.init?.headers as Record<string, string>;
    assert.equal(cbHeaders["X-QueenSync-Signature"], "sha256=fail");
  });

  it("setOverride without context.target → acks failed", async () => {
    const { fetch: fakeFetch, calls } = fakeFetcherOk();
    const payload: DispatchPayload = {
      taskId: "t-ovr",
      requiredCapability: "setOverride",
      callbackUrl: "https://queen.example.com/api/tasks/t-ovr/callback",
      context: {},
    };
    await runDispatch(payload, silentLog, { fetcher: fakeFetch });
    assert.equal(calls.length, 1);
    const cbBody = JSON.parse(String(calls[0]!.init?.body ?? "{}"));
    assert.equal(cbBody.status, "failed");
    assert.match(cbBody.error, /requires context\.target/);
  });

  it("kannaka_status → forwards body content", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("/status")) {
        return new Response("kannaka up — 7 arms reachable", { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const payload: DispatchPayload = {
      taskId: "t-status",
      requiredCapability: "kannaka_status",
      callbackUrl: "https://queen.example.com/api/tasks/t-status/callback",
    };
    await runDispatch(payload, silentLog, { fetcher });
    const cb = calls[1]!;
    const cbBody = JSON.parse(String(cb.init?.body ?? "{}"));
    assert.equal(cbBody.status, "completed");
    assert.match(cbBody.result, /kannaka up/);
  });
});
