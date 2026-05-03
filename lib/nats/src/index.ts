/**
 * @workspace/nats — typed wrapper around the official nats.js client
 *
 * Provides:
 *   - SUBJECTS: canonical subject names from ADR-002.
 *   - NatsClient: minimal abstract interface (subscribe/publish/request/state).
 *   - createNatsClient(opts): real client backed by `nats` (npm).
 *   - createInMemoryNatsClient(): in-process pub/sub used by tests.
 *
 * Both implementations expose the same surface so consumers can switch
 * transparently.
 */

export const SUBJECTS = {
  DREAMS: "KANNAKA.dreams",
  CONSCIOUSNESS: "KANNAKA.consciousness",
  REACTIONS: "KANNAKA.reactions",
  EXEMPLARS: "KANNAKA.exemplars",
  /**
   * Wave 4: outbound Memory Gate → kannaka-memory absorb requests.
   * Approved memory events the operator escalates with "Absorb to HRM"
   * publish here with an idempotency key (the existing 24h dedupe hash).
   */
  ABSORB: "KANNAKA.absorb",
  /** Wave 4: HRM acks for absorb attempts (success / rejection / failure). */
  ABSORB_ACK: "KANNAKA.absorb.ack",
  /**
   * Wave 4: outbound Memory Gate → swarm dream-cycle dispatch. QueenSync
   * publishes the operator-triggered "Dream Lite" intent here for
   * kannaka-prime / the swarm to pick up. The swarm reports progress via
   * `queen.event.dream.start` / `queen.event.dream.end`, both of which
   * carry the dispatched `taskId` so QueenSync can correlate.
   */
  DREAM_DISPATCH: "KANNAKA.dream.dispatch",
  QUEEN_DREAM_START: "queen.event.dream.start",
  QUEEN_DREAM_END: "queen.event.dream.end",
  QUEEN_JOIN: "queen.event.join",
  QUEEN_LEAVE: "queen.event.leave",
  /**
   * Per-agent phase signals from the queen sync layer. Documented at
   * https://radio.ninja-portal.com/agent as `QUEEN.phase.*` — wildcard
   * subscription so we capture every agent's phase update.
   */
  QUEEN_PHASE: "QUEEN.phase.*",
  /**
   * Prefix for REQ/REPLY arm commands: `KANNAKA.ask.<armId>`. Per the
   * Kannaktopus control-panel-api contract, every arm subscribes here and
   * answers commands like `{cmd:"wake"}`, `{cmd:"ping"}`, `{cmd:"status"}`,
   * etc. with a synchronous reply.
   */
  ASK_PREFIX: "KANNAKA.ask",
} as const;

export const ALL_SUBSCRIBE_SUBJECTS: readonly string[] = [
  SUBJECTS.DREAMS,
  SUBJECTS.CONSCIOUSNESS,
  SUBJECTS.REACTIONS,
  SUBJECTS.EXEMPLARS,
  SUBJECTS.ABSORB_ACK,
  SUBJECTS.QUEEN_DREAM_START,
  SUBJECTS.QUEEN_DREAM_END,
  SUBJECTS.QUEEN_JOIN,
  SUBJECTS.QUEEN_LEAVE,
  SUBJECTS.QUEEN_PHASE,
];

export type NatsConnectionState =
  | "disabled"
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed";

export interface NatsMessage {
  subject: string;
  /** Decoded JSON payload, or null if the body was not valid JSON. */
  data: unknown;
  /** Raw bytes (for logging / non-JSON payloads). */
  raw: Uint8Array;
  /** Reply subject for REQ/REPLY messages, if present. */
  reply?: string;
}

export interface NatsConnectionStatus {
  state: NatsConnectionState;
  url: string | null;
  lastError: string | null;
  lastConnectedAt: string | null;
  subscribedSubjects: string[];
  mode: "live" | "mock";
}

export type NatsHandler = (msg: NatsMessage) => void | Promise<void>;

export interface NatsClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Returns an unsubscribe function. Idempotent per (subject, handler). */
  subscribe(subject: string, handler: NatsHandler): () => void;
  publish(subject: string, data: unknown, opts?: { reply?: string }): void;
  request(
    subject: string,
    data: unknown,
    opts?: { timeoutMs?: number },
  ): Promise<NatsMessage>;
  status(): NatsConnectionStatus;
  onStateChange(cb: (status: NatsConnectionStatus) => void): () => void;
}

export interface NatsClientOptions {
  /**
   * `nats://host:port` URL. If null/empty/undefined the client will not
   * attempt to connect and stays in "disabled" state — callers should treat
   * this as "mock" mode.
   */
  url?: string | null | undefined;
  reconnectTimeWaitMs?: number;
  maxReconnectAttempts?: number;
  name?: string;
  /** Logger callback; defaults to console.warn. */
  onWarn?: (event: string, detail: Record<string, unknown>) => void;
}

const TEXT_DEC = new TextDecoder();
const TEXT_ENC = new TextEncoder();

function tryDecodeJson(bytes: Uint8Array): unknown {
  try {
    const txt = TEXT_DEC.decode(bytes);
    if (txt.length === 0) return null;
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function encodePayload(data: unknown): Uint8Array {
  if (data == null) return new Uint8Array();
  if (data instanceof Uint8Array) return data;
  return TEXT_ENC.encode(JSON.stringify(data));
}

// ───────────────────────────────────────────────────────────────────────────
// In-memory client (tests)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Match a concrete NATS subject against a possibly-wildcarded pattern
 * (`*` matches a single token, `>` matches one or more trailing tokens).
 * Exported for tests; mirrors NATS server semantics closely enough for
 * the in-memory bus to route `QUEEN.phase.*` style subscriptions.
 */
export function subjectMatches(pattern: string, subject: string): boolean {
  if (pattern === subject) return true;
  if (!pattern.includes("*") && !pattern.includes(">")) return false;
  const pp = pattern.split(".");
  const ss = subject.split(".");
  for (let i = 0; i < pp.length; i++) {
    const p = pp[i]!;
    if (p === ">") return ss.length >= i + 1;
    const s = ss[i];
    if (s === undefined) return false;
    if (p === "*") continue;
    if (p !== s) return false;
  }
  return pp.length === ss.length;
}

export function createInMemoryNatsClient(): NatsClient & {
  /** Test helper: returns the count of currently registered handlers per subject. */
  _subscriberCount(subject: string): number;
} {
  const handlers = new Map<string, Set<NatsHandler>>();
  const stateListeners = new Set<(s: NatsConnectionStatus) => void>();
  let state: NatsConnectionState = "disconnected";
  let lastConnectedAt: string | null = null;

  function status(): NatsConnectionStatus {
    return {
      state,
      url: "memory://",
      lastError: null,
      lastConnectedAt,
      subscribedSubjects: Array.from(handlers.keys()).sort(),
      mode: state === "connected" ? "live" : "mock",
    };
  }

  function emitState(): void {
    const snap = status();
    for (const cb of stateListeners) {
      try {
        cb(snap);
      } catch {
        // ignore listener failures
      }
    }
  }

  return {
    async connect(): Promise<void> {
      state = "connected";
      lastConnectedAt = new Date().toISOString();
      emitState();
    },
    async disconnect(): Promise<void> {
      state = "closed";
      handlers.clear();
      emitState();
    },
    subscribe(subject, handler): () => void {
      let set = handlers.get(subject);
      if (!set) {
        set = new Set();
        handlers.set(subject, set);
      }
      set.add(handler);
      return () => {
        const s = handlers.get(subject);
        if (!s) return;
        s.delete(handler);
        if (s.size === 0) handlers.delete(subject);
      };
    },
    publish(subject, data, opts): void {
      const raw = encodePayload(data);
      const msg: NatsMessage = {
        subject,
        data: data instanceof Uint8Array ? tryDecodeJson(data) : data,
        raw,
        reply: opts?.reply,
      };
      // Walk every registered subscription and dispatch when its
      // pattern matches the published subject. This makes wildcard
      // subscriptions like `QUEEN.phase.*` route correctly under the
      // in-memory client (tests + dev fake bus), matching real NATS
      // server semantics.
      for (const [pattern, set] of Array.from(handlers.entries())) {
        if (!subjectMatches(pattern, subject)) continue;
        for (const h of Array.from(set)) {
          try {
            void h(msg);
          } catch {
            // handler errors should not crash the bus
          }
        }
      }
    },
    async request(subject, data, opts): Promise<NatsMessage> {
      const reply = `_INBOX.${Math.random().toString(36).slice(2)}`;
      const timeoutMs = opts?.timeoutMs ?? 1000;
      return new Promise<NatsMessage>((resolve, reject) => {
        const t = setTimeout(() => {
          unsub();
          reject(new Error(`NATS request timeout on ${subject}`));
        }, timeoutMs);
        const unsub = this.subscribe(reply, (msg) => {
          clearTimeout(t);
          unsub();
          resolve(msg);
        });
        // Schedule publish so the subscriber is registered first.
        queueMicrotask(() => this.publish(subject, data, { reply }));
      });
    },
    status,
    onStateChange(cb): () => void {
      stateListeners.add(cb);
      return () => stateListeners.delete(cb);
    },
    _subscriberCount(subject): number {
      return handlers.get(subject)?.size ?? 0;
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Real client (nats.js)
// ───────────────────────────────────────────────────────────────────────────

interface NatsJsLike {
  connect(opts: Record<string, unknown>): Promise<NatsConnectionLike>;
}
interface NatsConnectionLike {
  subscribe(subject: string, opts: { callback: (err: unknown, msg: NatsMsgLike) => void }): { unsubscribe(): void };
  publish(subject: string, data: Uint8Array, opts?: { reply?: string }): void;
  request(subject: string, data: Uint8Array, opts: { timeout: number }): Promise<NatsMsgLike>;
  drain(): Promise<void>;
  close(): Promise<void>;
  closed(): Promise<void | Error>;
  status(): AsyncIterable<{ type: string; data?: unknown }>;
}
interface NatsMsgLike {
  subject: string;
  data: Uint8Array;
  reply?: string;
}

interface PendingSubscription {
  subject: string;
  handler: NatsHandler;
  sub: { unsubscribe(): void } | null;
}

export function createNatsClient(opts: NatsClientOptions): NatsClient {
  const url = opts.url && opts.url.trim() !== "" ? opts.url.trim() : null;
  const onWarn =
    opts.onWarn ??
    ((evt, detail) => {
      // eslint-disable-next-line no-console
      console.warn(`[nats] ${evt}`, detail);
    });

  let nc: NatsConnectionLike | null = null;
  let state: NatsConnectionState = url ? "disconnected" : "disabled";
  let lastError: string | null = null;
  let lastConnectedAt: string | null = null;
  const subs: PendingSubscription[] = [];
  const stateListeners = new Set<(s: NatsConnectionStatus) => void>();
  let connecting = false;
  let stopped = false;
  let connectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const baseRetryMs = opts.reconnectTimeWaitMs ?? 2000;
  const maxRetryMs = 30_000;

  function scheduleReconnect(): void {
    if (stopped || !url) return;
    if (reconnectTimer || nc) return;
    const exp = Math.min(maxRetryMs, baseRetryMs * 2 ** Math.min(connectAttempts, 5));
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (stopped || nc) return;
      void connect();
    }, exp);
    // Don't keep the event loop alive solely for reconnect attempts.
    if (typeof reconnectTimer.unref === "function") reconnectTimer.unref();
  }

  function setState(next: NatsConnectionState, err?: string | null): void {
    if (state === next && (err ?? null) === lastError) return;
    state = next;
    if (err !== undefined) lastError = err;
    const snap = statusSnap();
    for (const cb of stateListeners) {
      try {
        cb(snap);
      } catch {
        /* ignore */
      }
    }
  }

  function statusSnap(): NatsConnectionStatus {
    return {
      state,
      url,
      lastError,
      lastConnectedAt,
      subscribedSubjects: Array.from(new Set(subs.map((s) => s.subject))).sort(),
      mode: state === "connected" ? "live" : "mock",
    };
  }

  function bindSubscription(s: PendingSubscription): void {
    if (!nc) return;
    if (s.sub) return;
    s.sub = nc.subscribe(s.subject, {
      callback: (err: unknown, msg: NatsMsgLike) => {
        if (err) {
          onWarn("subscription_error", { subject: s.subject, err: String(err) });
          return;
        }
        const out: NatsMessage = {
          subject: msg.subject,
          data: tryDecodeJson(msg.data),
          raw: msg.data,
          reply: msg.reply,
        };
        try {
          const r = s.handler(out);
          if (r && typeof (r as Promise<unknown>).then === "function") {
            (r as Promise<unknown>).catch((herr) =>
              onWarn("handler_error", { subject: s.subject, err: String(herr) }),
            );
          }
        } catch (herr) {
          onWarn("handler_error", { subject: s.subject, err: String(herr) });
        }
      },
    });
  }

  function rebindAll(): void {
    for (const s of subs) {
      s.sub = null;
      bindSubscription(s);
    }
  }

  async function connect(): Promise<void> {
    if (!url) {
      setState("disabled");
      return;
    }
    if (stopped || nc || connecting) return;
    connecting = true;
    setState("connecting");
    try {
      const mod = (await import("nats")) as unknown as NatsJsLike;
      nc = await mod.connect({
        servers: url,
        name: opts.name ?? "queensync",
        reconnect: true,
        reconnectTimeWait: baseRetryMs,
        maxReconnectAttempts:
          opts.maxReconnectAttempts ?? -1, // infinite
        // We implement our own initial-connect retry below; nats.js's
        // waitOnFirstConnect would block this Promise indefinitely if the
        // broker is down at boot.
        waitOnFirstConnect: false,
      });
      connectAttempts = 0;
      lastConnectedAt = new Date().toISOString();
      setState("connected", null);
      // Re-bind any subscriptions registered before connect succeeded.
      rebindAll();
      // Watch status events for reconnect / disconnect.
      void (async () => {
        try {
          for await (const ev of nc!.status()) {
            switch (ev.type) {
              case "disconnect":
                setState("reconnecting");
                break;
              case "reconnecting":
                setState("reconnecting");
                break;
              case "reconnect":
                lastConnectedAt = new Date().toISOString();
                setState("connected", null);
                // nats.js preserves subscriptions across reconnects, so no
                // rebind is needed here. We still snapshot the new
                // lastConnectedAt for the UI.
                break;
              case "error":
                onWarn("nats_error", { detail: String(ev.data ?? "") });
                lastError = String(ev.data ?? "error");
                break;
              default:
                break;
            }
          }
        } catch (err) {
          onWarn("status_iter_error", { err: String(err) });
        }
      })();
      // When the connection closes for good, mark closed.
      void nc.closed().then((maybeErr) => {
        nc = null;
        setState("closed", maybeErr ? String(maybeErr) : lastError);
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      connectAttempts++;
      setState("disconnected", lastError);
      onWarn("connect_failed", { url, err: lastError, attempt: connectAttempts });
      // nats.js only auto-reconnects AFTER a first successful connect.
      // For the initial-connect-failure case (broker down at boot), drive
      // our own exponential-backoff retry loop so the bridge eventually
      // recovers without requiring an api-server restart.
      scheduleReconnect();
    } finally {
      connecting = false;
    }
  }

  async function disconnect(): Promise<void> {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    const c = nc;
    nc = null;
    if (!c) {
      setState("closed");
      return;
    }
    try {
      await c.drain();
    } catch {
      try {
        await c.close();
      } catch {
        /* ignore */
      }
    }
    setState("closed");
  }

  function subscribe(subject: string, handler: NatsHandler): () => void {
    const entry: PendingSubscription = { subject, handler, sub: null };
    subs.push(entry);
    bindSubscription(entry);
    return () => {
      const idx = subs.indexOf(entry);
      if (idx >= 0) subs.splice(idx, 1);
      try {
        entry.sub?.unsubscribe();
      } catch {
        /* ignore */
      }
      entry.sub = null;
    };
  }

  function publish(
    subject: string,
    data: unknown,
    pubOpts?: { reply?: string },
  ): void {
    if (!nc) {
      onWarn("publish_dropped", { subject, reason: "not_connected" });
      return;
    }
    nc.publish(subject, encodePayload(data), pubOpts);
  }

  async function request(
    subject: string,
    data: unknown,
    reqOpts?: { timeoutMs?: number },
  ): Promise<NatsMessage> {
    if (!nc) throw new Error("NATS not connected");
    const msg = await nc.request(subject, encodePayload(data), {
      timeout: reqOpts?.timeoutMs ?? 2000,
    });
    return {
      subject: msg.subject,
      data: tryDecodeJson(msg.data),
      raw: msg.data,
      reply: msg.reply,
    };
  }

  return {
    connect,
    disconnect,
    subscribe,
    publish,
    request,
    status: statusSnap,
    onStateChange(cb): () => void {
      stateListeners.add(cb);
      return () => stateListeners.delete(cb);
    },
  };
}
