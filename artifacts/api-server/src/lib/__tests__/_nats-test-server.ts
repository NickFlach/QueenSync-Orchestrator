/**
 * Minimal in-process NATS server for integration tests.
 *
 * Implements just enough of the wire protocol (INFO/CONNECT/PING/PONG/
 * SUB/UNSUB/PUB → MSG) to exercise the real `createNatsClient` end-to-end
 * over real TCP. No wildcard subjects, no JetStream, no auth — exact
 * subject equality only.
 *
 * Reference: https://docs.nats.io/reference/reference-protocols/nats-protocol
 */
import net from "node:net";
import type { AddressInfo } from "node:net";

interface Sub {
  subject: string;
  sid: string;
}

interface ClientState {
  socket: net.Socket;
  subs: Map<string, Sub>;
  buf: Buffer;
  pendingPub: { subject: string; reply: string | undefined; size: number } | null;
}

export interface TestNatsServer {
  url: string;
  port: number;
  /** Number of currently connected clients (debug aid). */
  clientCount(): number;
  stop(): Promise<void>;
}

export interface StartTestNatsOptions {
  /** Bind to a specific port (default: ephemeral). */
  port?: number;
}

export async function startTestNatsServer(
  opts: StartTestNatsOptions = {},
): Promise<TestNatsServer> {
  const clients = new Set<ClientState>();

  /**
   * NATS subject wildcard match:
   *   `*` matches a single token; `>` matches one or more trailing tokens.
   * (Required for nats.js's default REQ/REPLY mux which subscribes to
   * `_INBOX.<id>.*` and routes responses by suffix.)
   */
  function subjectMatches(pattern: string, subject: string): boolean {
    if (pattern === subject) return true;
    const ps = pattern.split(".");
    const ss = subject.split(".");
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p === ">") return ss.length >= i + 1;
      if (i >= ss.length) return false;
      if (p === "*") continue;
      if (p !== ss[i]) return false;
    }
    return ps.length === ss.length;
  }

  function dispatch(
    subject: string,
    payload: Buffer,
    reply: string | undefined,
  ): void {
    for (const c of clients) {
      for (const sub of c.subs.values()) {
        if (!subjectMatches(sub.subject, subject)) continue;
        const header = reply
          ? `MSG ${subject} ${sub.sid} ${reply} ${payload.length}\r\n`
          : `MSG ${subject} ${sub.sid} ${payload.length}\r\n`;
        try {
          c.socket.write(header);
          c.socket.write(payload);
          c.socket.write("\r\n");
        } catch {
          // socket may have closed mid-iteration; ignore
        }
      }
    }
  }

  function processClient(c: ClientState): void {
    // Loop until we can't make progress with the buffered bytes.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (c.pendingPub) {
        if (c.buf.length < c.pendingPub.size + 2) return;
        const payload = c.buf.subarray(0, c.pendingPub.size);
        c.buf = c.buf.subarray(c.pendingPub.size + 2); // skip trailing \r\n
        const { subject, reply } = c.pendingPub;
        c.pendingPub = null;
        dispatch(subject, payload, reply);
        continue;
      }
      const idx = c.buf.indexOf("\r\n");
      if (idx < 0) return;
      const line = c.buf.subarray(0, idx).toString("utf8");
      c.buf = c.buf.subarray(idx + 2);
      if (line.length === 0) continue;
      const verbEnd = line.indexOf(" ");
      const verb = (verbEnd === -1 ? line : line.slice(0, verbEnd)).toUpperCase();
      switch (verb) {
        case "CONNECT":
          // Ignore client capabilities / options.
          break;
        case "PING":
          try {
            c.socket.write("PONG\r\n");
          } catch {
            /* ignore */
          }
          break;
        case "PONG":
          break;
        case "SUB": {
          // SUB <subject> [queue] <sid>
          const parts = line.split(/\s+/);
          if (parts.length < 3) break;
          const subject = parts[1];
          const sid = parts[parts.length - 1];
          c.subs.set(sid, { subject, sid });
          break;
        }
        case "UNSUB": {
          const parts = line.split(/\s+/);
          const sid = parts[1];
          if (sid) c.subs.delete(sid);
          break;
        }
        case "PUB": {
          // PUB <subject> [reply] <bytes>
          const parts = line.split(/\s+/);
          const subject = parts[1];
          let reply: string | undefined;
          let size: number;
          if (parts.length === 4) {
            reply = parts[2];
            size = Number(parts[3]);
          } else {
            size = Number(parts[2]);
          }
          if (!subject || !Number.isFinite(size) || size < 0) break;
          c.pendingPub = { subject, reply, size };
          break;
        }
        default:
          // Unknown verb — ignore (servers reply -ERR; nats.js tolerates silence).
          break;
      }
    }
  }

  const server: net.Server = net.createServer((socket) => {
    const c: ClientState = {
      socket,
      subs: new Map(),
      buf: Buffer.alloc(0),
      pendingPub: null,
    };
    clients.add(c);
    const addr = server.address() as AddressInfo;
    const info = {
      server_id: "test-nats",
      server_name: "test-nats",
      version: "2.10.0-test",
      proto: 1,
      go: "n/a",
      host: "127.0.0.1",
      port: addr.port,
      max_payload: 1024 * 1024,
      client_id: clients.size,
      headers: false,
    };
    try {
      socket.write(`INFO ${JSON.stringify(info)}\r\n`);
    } catch {
      /* ignore */
    }
    socket.on("data", (chunk: Buffer) => {
      c.buf = Buffer.concat([c.buf, chunk]);
      try {
        processClient(c);
      } catch {
        // protocol errors should not crash the test bus
      }
    });
    const cleanup = () => {
      clients.delete(c);
    };
    socket.on("close", cleanup);
    socket.on("end", cleanup);
    socket.on("error", () => {
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      cleanup();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const addr = server.address() as AddressInfo;

  return {
    port: addr.port,
    url: `nats://127.0.0.1:${addr.port}`,
    clientCount: () => clients.size,
    stop: () =>
      new Promise<void>((resolve) => {
        for (const c of Array.from(clients)) {
          try {
            c.socket.destroy();
          } catch {
            /* ignore */
          }
        }
        clients.clear();
        server.close(() => resolve());
      }),
  };
}
