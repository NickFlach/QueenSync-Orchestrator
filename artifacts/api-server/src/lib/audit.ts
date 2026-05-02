import type { Request } from "express";

export interface AuditContext {
  ip: string;
  actor: string;
  trigger: string;
}

const ADMIN_TOKEN = process.env["QUEENSYNC_ADMIN_TOKEN"];
const CALLBACK_SECRET = process.env["QUEENSYNC_CALLBACK_SECRET"];

function clientIp(req: Request): string {
  const fwd = req.header("x-forwarded-for");
  const first = fwd ? fwd.split(",")[0]?.trim() : undefined;
  return first || req.ip || req.socket.remoteAddress || "unknown";
}

function detectActor(req: Request): string {
  const auth = req.header("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (ADMIN_TOKEN && token === ADMIN_TOKEN) return "admin:token";
    return "bearer:unverified";
  }
  if (CALLBACK_SECRET && req.header("x-queensync-signature")) {
    return "arm:signed-callback";
  }
  const ua = req.header("user-agent") ?? "";
  if (ua) return `anon:${ua.split(/[/\s]/)[0]?.slice(0, 24) || "ua"}`;
  return "anon";
}

export function getAuditContext(req: Request): AuditContext {
  return {
    ip: clientIp(req),
    actor: detectActor(req),
    trigger: `${req.method} ${req.originalUrl.split("?")[0] || req.originalUrl}`,
  };
}
