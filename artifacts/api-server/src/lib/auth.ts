import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from "express";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Environment configuration
// ---------------------------------------------------------------------------

const ADMIN_TOKEN = process.env["QUEENSYNC_ADMIN_TOKEN"];
const OPERATOR_TOKEN =
  process.env["QUEENSYNC_OPERATOR_TOKEN"] ?? ADMIN_TOKEN ?? null;
const VIEWER_TOKEN = process.env["QUEENSYNC_VIEWER_TOKEN"] ?? null;
const OPERATOR_PASSWORD = process.env["QUEENSYNC_OPERATOR_PASSWORD"] ?? null;
const VIEWER_PASSWORD = process.env["QUEENSYNC_VIEWER_PASSWORD"] ?? null;
const REQUIRE_AUTH_FOR_READS =
  process.env["QUEENSYNC_REQUIRE_AUTH_FOR_READS"] === "1" ||
  process.env["QUEENSYNC_REQUIRE_AUTH_FOR_READS"] === "true";
// Read at call time so operators can rotate without a process restart
// AND so tests can set the env var inside before() hooks. Empty string
// is normalized to null (matches the oracle-admin secret pattern).
function getCallbackSecret(): string | null {
  const v = process.env["QUEENSYNC_CALLBACK_SECRET"];
  if (v === undefined || v === "") return null;
  return v;
}

const AUTH_CONFIGURED = Boolean(
  OPERATOR_TOKEN || VIEWER_TOKEN || OPERATOR_PASSWORD || VIEWER_PASSWORD,
);

const PASSWORD_LOGIN_AVAILABLE = Boolean(
  OPERATOR_PASSWORD || VIEWER_PASSWORD,
);

let SESSION_SECRET = process.env["QUEENSYNC_SESSION_SECRET"] ?? null;
if (!SESSION_SECRET) {
  SESSION_SECRET = randomBytes(32).toString("hex");
  if (PASSWORD_LOGIN_AVAILABLE) {
    logger.warn(
      "QUEENSYNC_SESSION_SECRET not set — generated ephemeral secret. " +
        "Existing sessions will be invalidated when the server restarts.",
    );
  }
}

if (!AUTH_CONFIGURED) {
  logger.warn(
    "QueenSync auth is OPEN — no QUEENSYNC_OPERATOR_TOKEN / QUEENSYNC_OPERATOR_PASSWORD configured. " +
      "All mutating routes are publicly callable. Set one of these env vars before exposing this beyond a private demo.",
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Role = "operator" | "viewer";

export interface AuthContext {
  role: Role | null;
  source: "session" | "bearer" | "open" | "anonymous";
}

const AUTH_KEY = Symbol.for("queensync.auth");

interface RequestWithAuth extends Request {
  [AUTH_KEY]?: AuthContext;
}

export function getRequestAuth(req: Request): AuthContext | undefined {
  return (req as RequestWithAuth)[AUTH_KEY];
}

function setRequestAuth(req: Request, ctx: AuthContext): void {
  (req as RequestWithAuth)[AUTH_KEY] = ctx;
}

export const SESSION_COOKIE = "queensync_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h
export const SIGNATURE_HEADER = "x-queensync-signature";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

interface SessionPayload {
  role: Role;
  iat: number;
  exp: number;
}

function signSession(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", SESSION_SECRET!)
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

function verifySession(value: string): SessionPayload | null {
  const dot = value.indexOf(".");
  if (dot < 0) return null;
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = createHmac("sha256", SESSION_SECRET!)
    .update(body)
    .digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as SessionPayload;
    if (typeof decoded?.exp !== "number" || decoded.exp < Date.now()) {
      return null;
    }
    if (decoded.role !== "operator" && decoded.role !== "viewer") return null;
    return decoded;
  } catch {
    return null;
  }
}

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function bearerRole(token: string): Role | null {
  if (OPERATOR_TOKEN && safeEqual(token, OPERATOR_TOKEN)) return "operator";
  if (VIEWER_TOKEN && safeEqual(token, VIEWER_TOKEN)) return "viewer";
  return null;
}

function passwordRole(password: string): Role | null {
  if (OPERATOR_PASSWORD && safeEqual(password, OPERATOR_PASSWORD)) {
    return "operator";
  }
  if (VIEWER_PASSWORD && safeEqual(password, VIEWER_PASSWORD)) {
    return "viewer";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public auth API
// ---------------------------------------------------------------------------

export function isAuthConfigured(): boolean {
  return AUTH_CONFIGURED;
}

export function isPasswordLoginAvailable(): boolean {
  return PASSWORD_LOGIN_AVAILABLE;
}

export function shouldRequireAuthForReads(): boolean {
  return REQUIRE_AUTH_FOR_READS;
}

export function authenticateWithPassword(password: string): Role | null {
  return passwordRole(password);
}

export function createSession(role: Role): { value: string; maxAgeMs: number } {
  const now = Date.now();
  const payload: SessionPayload = {
    role,
    iat: now,
    exp: now + SESSION_TTL_MS,
  };
  return { value: signSession(payload), maxAgeMs: SESSION_TTL_MS };
}

export function inspectAuthHeaders(headers: {
  cookie?: string | undefined;
  authorization?: string | undefined;
}): AuthContext {
  if (!AUTH_CONFIGURED) {
    return { role: "operator", source: "open" };
  }
  if (headers.cookie) {
    const cookies = parseCookies(headers.cookie);
    const sess = cookies[SESSION_COOKIE];
    if (sess) {
      const payload = verifySession(sess);
      if (payload) return { role: payload.role, source: "session" };
    }
  }
  const authHeader = headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    const role = bearerRole(token);
    if (role) return { role, source: "bearer" };
  }
  return { role: null, source: "anonymous" };
}

export function inspectAuth(req: Request): AuthContext {
  return inspectAuthHeaders({
    cookie: req.headers.cookie,
    authorization: req.header("authorization") ?? undefined,
  });
}

// ---------------------------------------------------------------------------
// Express middleware
// ---------------------------------------------------------------------------

export const attachAuth: RequestHandler = (req, _res, next) => {
  setRequestAuth(req, inspectAuth(req));
  next();
};

function ensureCtx(req: Request): AuthContext {
  const existing = getRequestAuth(req);
  if (existing) return existing;
  const ctx = inspectAuth(req);
  setRequestAuth(req, ctx);
  return ctx;
}

export function requireOperator(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const ctx = ensureCtx(req);
  if (ctx.source === "open") return next();
  if (!ctx.role) {
    res.status(401).json({ error: "authentication required" });
    return;
  }
  if (ctx.role !== "operator") {
    res.status(403).json({ error: "operator role required" });
    return;
  }
  next();
}

export function requireViewer(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const ctx = ensureCtx(req);
  if (ctx.source === "open") return next();
  if (!REQUIRE_AUTH_FOR_READS) return next();
  if (!ctx.role) {
    res.status(401).json({ error: "authentication required" });
    return;
  }
  next();
}

/**
 * Back-compat: legacy admin-token gate. Equivalent to {@link requireOperator}
 * — kept for any external callers still importing it.
 */
export const requireAdminToken: RequestHandler = (req, res, next) => {
  requireOperator(req, res, next);
};

// ---------------------------------------------------------------------------
// Callback authentication (for arm task callbacks)
// ---------------------------------------------------------------------------

export function signCallback(taskId: string, status: string): string | null {
  const secret = getCallbackSecret();
  if (!secret) return null;
  const h = createHmac("sha256", secret);
  h.update(`${taskId}:${status}`);
  return `sha256=${h.digest("hex")}`;
}

/**
 * Verifies callback authenticity in this priority:
 *   1. If QUEENSYNC_CALLBACK_SECRET set, require X-QueenSync-Signature
 *      header matching HMAC-SHA256(taskId:status).
 *   2. Else if an operator bearer token is set, require Authorization: Bearer <token>.
 *   3. Else (dev mode) accept and log a warning.
 */
export function verifyCallbackAuth(
  req: Request,
  taskId: string,
  status: string,
): { ok: boolean; reason?: string } {
  if (getCallbackSecret()) {
    const provided = req.header(SIGNATURE_HEADER);
    if (!provided) return { ok: false, reason: "missing signature" };
    const expected = signCallback(taskId, status);
    if (!expected || !safeEqual(provided, expected)) {
      return { ok: false, reason: "invalid signature" };
    }
    return { ok: true };
  }
  if (OPERATOR_TOKEN) {
    const auth = req.header("authorization");
    if (!auth || !auth.startsWith("Bearer ")) {
      return { ok: false, reason: "missing bearer token" };
    }
    const token = auth.slice(7).trim();
    if (!safeEqual(token, OPERATOR_TOKEN)) {
      return { ok: false, reason: "invalid bearer token" };
    }
    return { ok: true };
  }
  logger.warn(
    { taskId, status },
    "callback accepted unauthenticated — set QUEENSYNC_CALLBACK_SECRET or QUEENSYNC_OPERATOR_TOKEN",
  );
  return { ok: true };
}

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

// ---------------------------------------------------------------------------
// HMAC body signing (oracle-admin shim)
// ---------------------------------------------------------------------------

export const ORACLE_ADMIN_TIMESTAMP_HEADER = "x-queensync-timestamp";
export const ORACLE_ADMIN_SIGNATURE_HEADER = "x-queensync-body-signature";

function getOracleAdminSecret(): string | null {
  // Treat empty string the same as unset so an exported-but-empty
  // QUEENSYNC_ORACLE_ADMIN_HMAC_SECRET surfaces the unconfigured warning
  // (rather than silently signing-as-null and being rejected at the shim).
  const v = process.env["QUEENSYNC_ORACLE_ADMIN_HMAC_SECRET"];
  if (v === undefined || v === "") return null;
  return v;
}

/**
 * Returns true if HMAC signing is configured for the oracle-admin shim.
 * Empty string is treated as unconfigured. When false, dispatches to
 * oracle_admin arms still go through unsigned (which the shim will reject
 * in production — operators should configure the secret).
 */
export function isOracleAdminSigningConfigured(): boolean {
  return getOracleAdminSecret() !== null;
}

/**
 * Sign a request body for the oracle-admin shim. Produces both the
 * timestamp (unix ms, as a decimal string) and the signature
 * (`sha256=<hex of HMAC(timestamp + ":" + body)>`).
 *
 * Returns null when the shared secret env var is unset — callers should
 * skip the headers in that case (and a warning is logged at boot).
 */
export function signOracleAdminBody(
  body: string,
  now: number = Date.now(),
): { timestamp: string; signature: string } | null {
  const secret = getOracleAdminSecret();
  if (!secret) return null;
  const timestamp = String(now);
  const h = createHmac("sha256", secret);
  h.update(`${timestamp}:${body}`);
  return { timestamp, signature: `sha256=${h.digest("hex")}` };
}

/**
 * Verify an inbound oracle-admin request signature. Used by the shim
 * (and by the api-server tests). Rejects timestamps outside ±5 min.
 */
export function verifyOracleAdminBody(opts: {
  body: string;
  timestamp: string | undefined;
  signature: string | undefined;
  secret: string;
  now?: number;
  toleranceMs?: number;
}): { ok: boolean; reason?: string } {
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
