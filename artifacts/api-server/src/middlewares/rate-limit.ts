import type { Request, Response, NextFunction, RequestHandler } from "express";
import { logger } from "../lib/logger";
import { recordLog } from "../lib/log";
import { getAuditContext } from "../lib/audit";

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  name: string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const stores = new Map<string, Map<string, Bucket>>();

function getStore(name: string): Map<string, Bucket> {
  let store = stores.get(name);
  if (!store) {
    store = new Map();
    stores.set(name, store);
  }
  return store;
}

function clientKey(req: Request): string {
  const fwd = req.header("x-forwarded-for");
  const first = fwd ? fwd.split(",")[0]?.trim() : undefined;
  return first || req.ip || req.socket.remoteAddress || "unknown";
}

export function rateLimit(opts: RateLimitOptions): RequestHandler {
  const { windowMs, max, name } = opts;
  const store = getStore(name);

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = clientKey(req);
    const now = Date.now();
    let bucket = store.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      store.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      res.setHeader("Retry-After", String(retryAfterSec));
      const audit = getAuditContext(req);
      logger.warn(
        { name, key, path: req.originalUrl, count: bucket.count, max },
        "rate limit exceeded",
      );
      void recordLog({
        eventType: "rate_limited",
        source: "rate-limiter",
        summary: `Rate limit exceeded on ${audit.trigger} (${bucket.count}/${max} per ${Math.round(windowMs / 1000)}s)`,
        metadata: {
          actor: audit.actor,
          ip: audit.ip,
          trigger: audit.trigger,
          limiter: name,
          max,
          windowMs,
        },
      }).catch((err) => logger.error({ err }, "failed to record rate_limited log"));
      res.status(429).json({
        error: "rate limit exceeded",
        retryAfter: retryAfterSec,
        limit: max,
        windowMs,
      });
      return;
    }

    next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const store of stores.values()) {
    for (const [key, bucket] of store.entries()) {
      if (bucket.resetAt <= now) store.delete(key);
    }
  }
}, 60_000).unref?.();
