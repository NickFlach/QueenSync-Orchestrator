import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createInMemoryNatsClient,
  SUBJECTS,
  type NatsMessage,
} from "@workspace/nats";

describe("nats in-memory client (integration test substrate)", () => {
  it("subscribe → publish → handler is invoked with decoded JSON", async () => {
    const client = createInMemoryNatsClient();
    await client.connect();
    const seen: NatsMessage[] = [];
    client.subscribe(SUBJECTS.DREAMS, (msg) => {
      seen.push(msg);
    });
    client.publish(SUBJECTS.DREAMS, {
      memories_strengthened: 7,
      memories_pruned: 2,
      memories_hallucinated: 1,
    });
    // Handlers fire synchronously in the in-memory bus.
    assert.equal(seen.length, 1);
    assert.equal(seen[0].subject, SUBJECTS.DREAMS);
    assert.deepEqual(seen[0].data, {
      memories_strengthened: 7,
      memories_pruned: 2,
      memories_hallucinated: 1,
    });
    await client.disconnect();
  });

  it("unsubscribe drops the handler and decrements the subscriber count", async () => {
    const client = createInMemoryNatsClient();
    await client.connect();
    const subject = SUBJECTS.REACTIONS;
    let count = 0;
    const unsub = client.subscribe(subject, () => {
      count++;
    });
    client.publish(subject, { reaction: "🪶" });
    assert.equal(count, 1);
    assert.equal(client._subscriberCount(subject), 1);
    unsub();
    assert.equal(client._subscriberCount(subject), 0);
    client.publish(subject, { reaction: "💧" });
    assert.equal(count, 1, "handler must not fire after unsubscribe");
    await client.disconnect();
  });

  it("multiple subscribers on the same subject all receive each message", async () => {
    const client = createInMemoryNatsClient();
    await client.connect();
    const subject = SUBJECTS.CONSCIOUSNESS;
    let a = 0;
    let b = 0;
    client.subscribe(subject, () => {
      a++;
    });
    client.subscribe(subject, () => {
      b++;
    });
    client.publish(subject, { phi: 0.1, xi: 0.2, order: 0.3 });
    client.publish(subject, { phi: 0.4, xi: 0.5, order: 0.6 });
    assert.equal(a, 2);
    assert.equal(b, 2);
    await client.disconnect();
  });

  it("REQ/REPLY routes the response to the requester", async () => {
    const client = createInMemoryNatsClient();
    await client.connect();
    const armId = "arm-123";
    const subject = `${SUBJECTS.ASK_PREFIX}.${armId}`;
    // Respond to ping with pong.
    client.subscribe(subject, (msg) => {
      if (msg.reply) {
        client.publish(msg.reply, { pong: true, armId });
      }
    });
    const reply = await client.request(subject, { ping: true }, { timeoutMs: 500 });
    assert.deepEqual(reply.data, { pong: true, armId });
    await client.disconnect();
  });

  it("REQ/REPLY rejects on timeout when nobody answers", async () => {
    const client = createInMemoryNatsClient();
    await client.connect();
    await assert.rejects(
      () =>
        client.request(`${SUBJECTS.ASK_PREFIX}.nobody`, { ping: true }, { timeoutMs: 50 }),
      /timeout/i,
    );
    await client.disconnect();
  });

  it("status() reports connected mode + subscribed subjects after subscribe", async () => {
    const client = createInMemoryNatsClient();
    await client.connect();
    client.subscribe(SUBJECTS.DREAMS, () => {});
    client.subscribe(SUBJECTS.REACTIONS, () => {});
    const s = client.status();
    assert.equal(s.state, "connected");
    assert.equal(s.mode, "live");
    assert.deepEqual(
      s.subscribedSubjects.sort(),
      [SUBJECTS.DREAMS, SUBJECTS.REACTIONS].sort(),
    );
    await client.disconnect();
    const after = client.status();
    assert.equal(after.state, "closed");
    assert.equal(after.mode, "mock");
  });

  it("onStateChange fires for connect and disconnect transitions", async () => {
    const client = createInMemoryNatsClient();
    const states: string[] = [];
    client.onStateChange((s) => states.push(s.state));
    await client.connect();
    await client.disconnect();
    assert.deepEqual(states, ["connected", "closed"]);
  });
});
