import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { attachAuth } from "./lib/auth";

const app: Express = express();

app.set("trust proxy", true);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// CORS: reflect origin and allow credentials so browser session cookies
// can be sent on cross-origin requests when the API is reached from a
// different host (e.g. an embedded preview).
app.use(
  cors({
    origin: (origin, cb) => cb(null, origin ?? true),
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", attachAuth, router);

export default app;
