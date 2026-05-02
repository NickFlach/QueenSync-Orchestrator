import http from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { attachWebSocket } from "./lib/ws";
import { seedDefaults } from "./lib/seed";
import { expireOldResonance } from "./lib/resonance";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);
attachWebSocket(server);

server.listen(port, () => {
  logger.info({ port }, "Server listening (HTTP + WS)");
  void seedDefaults().catch((err) =>
    logger.error({ err }, "seed failed"),
  );
  setInterval(() => {
    void expireOldResonance().catch((err) =>
      logger.error({ err }, "expire failed"),
    );
  }, 5000);
});
