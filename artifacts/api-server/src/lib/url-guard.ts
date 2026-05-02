import { logger } from "./logger";

const DEFAULT_BLOCKED_HOSTS = new Set([
  "localhost",
  "0.0.0.0",
  "127.0.0.1",
  "::1",
  "169.254.169.254",
  "metadata.google.internal",
  "metadata",
]);

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isIPv6Private(host: string): boolean {
  if (host.startsWith("::1")) return true;
  if (host.startsWith("fc") || host.startsWith("fd")) return true;
  if (host.startsWith("fe80")) return true;
  return false;
}

export interface UrlGuardResult {
  ok: boolean;
  reason?: string;
}

export function validateOutboundUrl(input: string | null | undefined): UrlGuardResult {
  if (!input) return { ok: false, reason: "URL is empty" };
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: "URL is not parseable" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `Protocol ${url.protocol} not allowed` };
  }
  const allowPrivate = process.env["QUEENSYNC_ALLOW_PRIVATE_HOSTS"] === "true";
  const allowList = (process.env["QUEENSYNC_ALLOWED_HOSTS"] ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (allowList.length > 0) {
    const matches = allowList.some(
      (entry) => host === entry || host.endsWith(`.${entry}`),
    );
    if (!matches) {
      return {
        ok: false,
        reason: `Host ${host} not in QUEENSYNC_ALLOWED_HOSTS allowlist`,
      };
    }
    return { ok: true };
  }

  if (allowPrivate) return { ok: true };

  if (DEFAULT_BLOCKED_HOSTS.has(host)) {
    return { ok: false, reason: `Host ${host} is blocked` };
  }
  if (isPrivateIPv4(host) || isIPv6Private(host)) {
    return { ok: false, reason: `Host ${host} is a private/loopback address` };
  }
  return { ok: true };
}

export function logBlockedUrl(context: string, url: string, reason: string) {
  logger.warn({ context, url, reason }, "outbound URL blocked");
}
