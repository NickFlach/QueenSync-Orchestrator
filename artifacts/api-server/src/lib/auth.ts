import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { logger } from "./logger";

const ADMIN_TOKEN = process.env["QUEENSYNC_ADMIN_TOKEN"];
const CALLBACK_SECRET = process.env["QUEENSYNC_CALLBACK_SECRET"];

export const SIGNATURE_HEADER = "x-queensync-signature";

export function signCallback(taskId: string, status: string): string | null {
  if (!CALLBACK_SECRET) return null;
  const h = createHmac("sha256", CALLBACK_SECRET);
  h.update(`${taskId}:${status}`);
  return `sha256=${h.digest("hex")}`;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verifies callback authenticity in this priority:
 *   1. If QUEENSYNC_CALLBACK_SECRET set, require X-QueenSync-Signature
 *      header matching HMAC-SHA256(taskId:status).
 *   2. Else if QUEENSYNC_ADMIN_TOKEN set, require Authorization: Bearer <token>.
 *   3. Else (dev mode) accept and log a warning.
 */
export function verifyCallbackAuth(
  req: Request,
  taskId: string,
  status: string,
): { ok: boolean; reason?: string } {
  if (CALLBACK_SECRET) {
    const provided = req.header(SIGNATURE_HEADER);
    if (!provided) return { ok: false, reason: "missing signature" };
    const expected = signCallback(taskId, status);
    if (!expected || !safeEqual(provided, expected)) {
      return { ok: false, reason: "invalid signature" };
    }
    return { ok: true };
  }
  if (ADMIN_TOKEN) {
    const auth = req.header("authorization");
    if (!auth || !auth.startsWith("Bearer ")) {
      return { ok: false, reason: "missing bearer token" };
    }
    const token = auth.slice(7).trim();
    if (!safeEqual(token, ADMIN_TOKEN)) {
      return { ok: false, reason: "invalid bearer token" };
    }
    return { ok: true };
  }
  logger.warn(
    { taskId, status },
    "callback accepted unauthenticated — set QUEENSYNC_CALLBACK_SECRET or QUEENSYNC_ADMIN_TOKEN",
  );
  return { ok: true };
}

/**
 * Optional admin-token middleware. When QUEENSYNC_ADMIN_TOKEN is set, mutating
 * routes can be wrapped to require Authorization: Bearer <token>. When unset,
 * the middleware logs once and is a no-op (preserves the open demo plane).
 */
export const requireAdminToken: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!ADMIN_TOKEN) return next();
  const auth = req.header("authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    res.status(401).json({ error: "missing bearer token" });
    return;
  }
  const token = auth.slice(7).trim();
  if (!safeEqual(token, ADMIN_TOKEN)) {
    res.status(403).json({ error: "invalid bearer token" });
    return;
  }
  next();
};

export function applyArmAuthHeaders(
  authMethod: string,
  headers: Record<string, string>,
) {
  const apiKey = process.env["QUEENSYNC_API_KEY"];
  if (!apiKey) return;
  switch (authMethod) {
    case "api_key":
      headers["X-API-Key"] = apiKey;
      break;
    case "bearer":
    case "jwt":
      headers["Authorization"] = `Bearer ${apiKey}`;
      break;
    default:
      // none / unknown — no header
      break;
  }
}
