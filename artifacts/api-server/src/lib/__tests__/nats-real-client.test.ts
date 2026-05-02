/**
 * Integration tests for the REAL `createNatsClient` (backed by nats.js)
 * driven against an in-process NATS protocol server. These verify wire-level
 * subscribe/publish/REQ-REPLY and the initial-connect retry loop end-to-end.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createNatsClient,
  SUBJECTS,
  type NatsClient,
} from "@workspace/nats";
import { startTestNatsServer, type TestNatsServer } from "./_nats-test-server";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFor(
  cond: () => boolean,
  { timeoutMs = 2000, stepMs = 25 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await sleep(stepMs);
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

describe("createNatsClient ↔ in-process NATS server", () => {
  let server: TestNatsServer;
  let client: NatsClient | null = null;

  before(async () => {
    server = await startTestNatsServer();
  });

  after(async () => {
    if (client) await client.disconnect();
    await server.stop();
  });

  it("subscribe → publish → handler is invoked over real TCP", async () => {
    client = createNatsClient({
      url: server.url,
      name: "qs-test-1",
      reconnectTimeWaitMs: 50,
    });
    const seenSubjects: string[] = [];
    const seenData: unknown[] = [];
    client.subscribe(SUBJECTS.DREAMS, (msg) => {
      seenSubjects.push(msg.subject);
      seenData.push(msg.data);
    });
    await client.connect();
    await waitFor(() => client!.status().state === "connected");
    // Allow the SUB frame to round-trip before publishing.
    await sleep(50);
    client.publish(SUBJECTS.DREAMS, {
      memories_strengthened: 9,
      memories_pruned: 1,
    });
    await waitFor(() => seenData.length === 1);
    assert.equal(seenSubjects[0], SUBJECTS.DREAMS);
    assert.deepEqual(seenData[0], {
      memories_strengthened: 9,
      memories_pruned: 1,
    });
    assert.equal(client.status().mode, "live");
    assert.ok(client.status().lastConnectedAt);
    await client.disconnect();
    client = null;
  });

  it("REQ/REPLY routes responses back to the requester over the real bus", async () => {
    // Two clients on the same in-process server: one acts as a 'kannaktopus arm'
    // responder, the other issues the request (just like the api-server's
    // arm test-connection flow).
    const responder = createNatsClient({
      url: server.url,
      name: "responder",
      reconnectTimeWaitMs: 50,
    });
    const requester = createNatsClient({
      url: server.url,
      name: "requester",
      reconnectTimeWaitMs: 50,
    });
    const armId = "armtest123";
    const subject = `${SUBJECTS.ASK_PREFIX}.${armId}`;
    responder.subscribe(subject, (msg) => {
      if (msg.reply) {
        responder.publish(msg.reply, { pong: true, armId });
      }
      return;
    });
    try {
      await responder.connect();
      await requester.connect();
      await waitFor(
        () =>
          responder.status().state === "connected" &&
          requester.status().state === "connected",
      );
      // Let the responder's SUB land on the server before we publish.
      await sleep(75);
      const reply = await requester.request(
        subject,
        { ping: true },
        { timeoutMs: 1500 },
      );
      assert.deepEqual(reply.data, { pong: true, armId });
    } finally {
      await responder.disconnect();
      await requester.disconnect();
    }
  });

  it("retries when the initial connect fails and recovers when the broker comes online", async () => {
    // Reserve an ephemeral port by starting and immediately stopping a server.
    const tmp = await startTestNatsServer();
    const port = tmp.port;
    const url = tmp.url;
    await tmp.stop();
    // Give the OS a moment to release the port.
    await sleep(20);

    const states: string[] = [];
    const c = createNatsClient({
      url,
      name: "retry-test",
      reconnectTimeWaitMs: 60, // first retry ~60ms, exp backoff thereafter
    });
    c.onStateChange((s) => states.push(s.state));

    await c.connect();
    // Initial connect should have failed: we expect a disconnected state and
    // a non-null lastError reporting the connection refusal.
    await waitFor(() => states.includes("disconnected"));
    assert.ok(c.status().lastError, "lastError should be populated after a failed initial connect");
    assert.equal(c.status().state, "disconnected");

    // Now bring the broker online on the SAME port — the bridge's retry
    // loop should pick it up without any external nudge.
    const revived = await startTestNatsServer({ port });
    try {
      await waitFor(() => c.status().state === "connected", { timeoutMs: 5000 });
      assert.equal(c.status().state, "connected");
      assert.equal(c.status().mode, "live");
      assert.ok(c.status().lastConnectedAt);
      // Sanity check: a publish/subscribe round-trip works on the recovered link.
      const seen: unknown[] = [];
      c.subscribe(SUBJECTS.REACTIONS, (m) => {
        seen.push(m.data);
      });
      await sleep(50);
      c.publish(SUBJECTS.REACTIONS, { reaction: "🪶" });
      await waitFor(() => seen.length === 1);
      assert.deepEqual(seen[0], { reaction: "🪶" });
    } finally {
      await c.disconnect();
      await revived.stop();
    }
  });

  it("status() reports `disabled` and never attempts a connection when no URL is configured", async () => {
    const c = createNatsClient({ url: null });
    await c.connect();
    const s = c.status();
    assert.equal(s.state, "disabled");
    assert.equal(s.mode, "mock");
    assert.equal(s.url, null);
    await c.disconnect();
  });
});
