import { Router, type IRouter } from "express";
import {
  authenticateWithPassword,
  createSession,
  getRequestAuth,
  inspectAuth,
  isAuthConfigured,
  isPasswordLoginAvailable,
  shouldRequireAuthForReads,
  SESSION_COOKIE,
} from "../lib/auth";
import { recordLog } from "../lib/log";
import { getAuditContext } from "../lib/audit";

const router: IRouter = Router();

router.get("/auth/session", (req, res): void => {
  const ctx = getRequestAuth(req) ?? inspectAuth(req);
  const meta = {
    authConfigured: isAuthConfigured(),
    passwordLoginAvailable: isPasswordLoginAvailable(),
    requireAuthForReads: shouldRequireAuthForReads(),
  };
  if (!isAuthConfigured()) {
    res.json({ role: "operator", source: "open", ...meta });
    return;
  }
  if (!ctx.role) {
    res.status(401).json({ role: null, ...meta });
    return;
  }
  res.json({ role: ctx.role, source: ctx.source, ...meta });
});

router.post("/auth/login", (req, res): void => {
  if (!isAuthConfigured()) {
    res.json({ role: "operator", authConfigured: false });
    return;
  }
  if (!isPasswordLoginAvailable()) {
    res.status(400).json({
      error:
        "password login disabled — set QUEENSYNC_OPERATOR_PASSWORD or QUEENSYNC_VIEWER_PASSWORD",
    });
    return;
  }
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";
  if (!password) {
    res.status(400).json({ error: "missing password" });
    return;
  }
  const role = authenticateWithPassword(password);
  if (!role) {
    // Wave 5 — auth audit. Login failures land in the Execution Log AND
    // the QUEENSYNC_LOG_FILE export sink so post-incident review can
    // spot brute-force attempts even after a redeploy wipes stdout.
    void recordLog({
      eventType: "auth_login_failed",
      source: "auth",
      summary: "Login failed: invalid password",
      audit: getAuditContext(req),
    });
    res.status(401).json({ error: "invalid password" });
    return;
  }
  const { value, maxAgeMs } = createSession(role);
  const isProd = process.env["NODE_ENV"] === "production";
  res.cookie(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
    maxAge: maxAgeMs,
  });
  void recordLog({
    eventType: "auth_login_success",
    source: "auth",
    summary: `Login succeeded as ${role}`,
    metadata: { role },
    audit: getAuditContext(req),
  });
  res.json({ role, authConfigured: true });
});

router.post("/auth/logout", (req, res): void => {
  const ctx = getRequestAuth(req) ?? inspectAuth(req);
  void recordLog({
    eventType: "auth_logout",
    source: "auth",
    summary: `Logout (${ctx.role ?? "anonymous"})`,
    metadata: { role: ctx.role, source: ctx.source },
    audit: getAuditContext(req),
  });
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.status(204).end();
});

export default router;
