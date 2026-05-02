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
  res.json({ role, authConfigured: true });
});

router.post("/auth/logout", (_req, res): void => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.status(204).end();
});

export default router;
