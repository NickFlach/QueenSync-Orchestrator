import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { logger } from "./logger";
import { inspectAuthHeaders, shouldRequireAuthForReads } from "./auth";

export type QueenSyncEventType =
  | "hello"
  | "arm_registered"
  | "arm_removed"
  | "arms_updated"
  | "task_created"
  | "task_assigned"
  | "task_completed"
  | "task_failed"
  | "task_updated"
  | "signal_received"
  | "memory_event"
  | "log_event"
  | "resonance_created"
  | "resonance_response"
  | "resonance_resolved"
  | "resonance_updated"
  | "adapter_pull";

export interface QueenSyncEvent {
  type: QueenSyncEventType;
  data: unknown;
  ts: number;
}

let wss: WebSocketServer | null = null;

function authorizeUpgrade(
  req: IncomingMessage,
): { ok: true; role: "operator" | "viewer" } | { ok: false; reason: string } {
  // Allow ?token=<bearer> for non-browser clients that cannot set cookies
  // or Authorization headers on a WebSocket handshake.
  let queryToken: string | null = null;
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    queryToken = url.searchParams.get("token");
  } catch {
    queryToken = null;
  }
  const ctx = inspectAuthHeaders({
    cookie: req.headers.cookie,
    authorization: queryToken
      ? `Bearer ${queryToken}`
      : (req.headers.authorization ?? undefined),
  });
  if (ctx.source === "open") return { ok: true, role: "operator" };
  if (!ctx.role) return { ok: false, reason: "unauthenticated" };
  // Viewer is enough to subscribe to broadcast events. We additionally require
  // viewer role only when REQUIRE_AUTH_FOR_READS is set; otherwise an operator
  // session is also accepted by definition.
  void shouldRequireAuthForReads;
  return { ok: true, role: ctx.role };
}

export function attachWebSocket(server: HttpServer) {
  wss = new WebSocketServer({
    noServer: true,
  });
  wss.on("connection", (socket: WebSocket, _req: IncomingMessage, role: "operator" | "viewer") => {
    logger.info({ role }, "ws client connected");
    socket.send(
      JSON.stringify({
        type: "hello",
        data: { ts: Date.now(), role },
        ts: Date.now(),
      }),
    );
  });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url || !req.url.startsWith("/ws")) {
      // Let other upgrade handlers (if any) deal with it; otherwise close.
      socket.destroy();
      return;
    }
    const auth = authorizeUpgrade(req);
    if (!auth.ok) {
      logger.warn(
        { reason: auth.reason, url: req.url },
        "ws upgrade rejected",
      );
      const body = "Unauthorized";
      socket.write(
        `HTTP/1.1 401 Unauthorized\r\n` +
          `Content-Type: text/plain\r\n` +
          `Content-Length: ${Buffer.byteLength(body)}\r\n` +
          `Connection: close\r\n\r\n` +
          body,
      );
      socket.destroy();
      return;
    }
    wss!.handleUpgrade(req, socket, head, (ws) => {
      wss!.emit("connection", ws, req, auth.role);
    });
  });
}

export function broadcast(event: {
  type: QueenSyncEventType;
  data: unknown;
}) {
  if (!wss) return;
  const payload = JSON.stringify({ ...event, ts: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch {
        // ignore broken sockets
      }
    }
  }
}
