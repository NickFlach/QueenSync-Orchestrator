import { createHmac, timingSafeEqual } from "node:crypto";

export const TIMESTAMP_HEADER = "x-queensync-timestamp";
export const SIGNATURE_HEADER = "x-queensync-body-signature";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface VerifyOptions {
  body: string;
  timestamp: string | undefined;
  signature: string | undefined;
  secret: string;
  now?: number;
  toleranceMs?: number;
}

/**
 * Verify the inbound dispatch signature. Mirrors
 * `verifyOracleAdminBody` in `@workspace/api-server` so the two stay in
 * lockstep (we keep them duplicated rather than introducing a workspace
 * dependency, since the shim is deployed off-Replit).
 *
 *   sha256( <unix_ms_timestamp> + ":" + <body> )
 */
export function verifyHmacBody(opts: VerifyOptions): {
  ok: boolean;
  reason?: string;
} {
  const { body, timestamp, signature, secret } = opts;
  const now = opts.now ?? Date.now();
  const tolerance = opts.toleranceMs ?? 5 * 60_000;
  if (!timestamp) return { ok: false, reason: "missing timestamp" };
  if (!signature) return { ok: false, reason: "missing signature" };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "invalid timestamp" };
  if (Math.abs(now - ts) > tolerance) {
    return { ok: false, reason: "timestamp outside tolerance window" };
  }
  const h = createHmac("sha256", secret);
  h.update(`${timestamp}:${body}`);
  const expected = `sha256=${h.digest("hex")}`;
  if (!safeEqual(signature, expected)) {
    return { ok: false, reason: "invalid signature" };
  }
  return { ok: true };
}

/**
 * Sign the callback we POST back to QueenSync. QueenSync expects:
 *   X-QueenSync-Signature: sha256=HMAC(taskId:status)
 *
 * In production, QueenSync ships the expected signature in the dispatch
 * request via X-QueenSync-Completed-Signature / X-QueenSync-Failed-Signature
 * headers, so the shim doesn't need its own copy of the callback secret —
 * see `dispatch.ts` for the echo-back flow.
 */
export function signCallback(
  secret: string,
  taskId: string,
  status: string,
): string {
  const h = createHmac("sha256", secret);
  h.update(`${taskId}:${status}`);
  return `sha256=${h.digest("hex")}`;
}
