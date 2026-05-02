import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { logger } from "./logger";

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

export function attachWebSocket(server: HttpServer) {
  wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (socket) => {
    logger.info("ws client connected");
    socket.send(
      JSON.stringify({ type: "hello", data: { ts: Date.now() }, ts: Date.now() }),
    );
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
