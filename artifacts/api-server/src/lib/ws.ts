import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { logger } from "./logger";

let wss: WebSocketServer | null = null;

export function attachWebSocket(server: HttpServer) {
  wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (socket) => {
    logger.info("ws client connected");
    socket.send(JSON.stringify({ kind: "hello", data: { ts: Date.now() } }));
  });
}

export function broadcast(message: { kind: string; data: unknown }) {
  if (!wss) return;
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch {
        // ignore
      }
    }
  }
}
