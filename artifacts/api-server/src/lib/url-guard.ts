import { logger } from "./logger";

// Hosts that are blocked even with QUEENSYNC_ALLOW_PRIVATE_HOSTS=true or
// when the operator adds them to QUEENSYNC_ALLOWED_HOSTS. These reach cloud
// metadata services or otherwise have no legitimate destination from this app.
const ALWAYS_BLOCKED_HOSTS = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata",
  "metadata.azure.com",
  "instance-data",
  "instance-data.ec2.internal",
]);

// Loopback hostname aliases. They are blocked by default but may be unlocked
// for development with QUEENSYNC_ALLOW_PRIVATE_HOSTS=true.
const LOOPBACK_HOST_ALIASES = new Set(["localhost", "0.0.0.0", "127.0.0.1", "::1"]);

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => n < 0 || n > 255)) {
    return true; // malformed octet — treat as unsafe
  }
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function ipv4MappedToDotted(host: string): string | null {
  // Accept the dotted form ::ffff:a.b.c.d
  const dotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1];
  // Accept the hex form ::ffff:7f00:1 emitted by URL parsing
  const hex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
  }
  return null;
}

function isIPv6Private(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::" || h === "::1") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique local
  if (h.startsWith("fe80")) return true; // link-local
  if (h.startsWith("ff")) return true; // multicast
  const mapped = ipv4MappedToDotted(h);
  if (mapped) {
    // IPv4-mapped IPv6 — never let a private IPv4 hide behind v6 syntax
    if (isPrivateIPv4(mapped)) return true;
  }
  return false;
}

export interface UrlGuardResult {
  ok: boolean;
  reason?: string;
}

function envFlag(name: string): boolean {
  return process.env[name] === "true" || process.env[name] === "1";
}

export function validateOutboundUrl(input: string | null | undefined): UrlGuardResult {
  if (!input) return { ok: false, reason: "URL is empty" };
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: "URL is not parseable" };
  }
  const allowHttp = envFlag("QUEENSYNC_ALLOW_HTTP");
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    return { ok: false, reason: `Protocol ${url.protocol} not allowed (https required)` };
  }
  const allowPrivate = envFlag("QUEENSYNC_ALLOW_PRIVATE_HOSTS");
  const allowList = (process.env["QUEENSYNC_ALLOWED_HOSTS"] ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  // Cloud metadata endpoints are NEVER allowed, regardless of allowlist or
  // QUEENSYNC_ALLOW_PRIVATE_HOSTS, to avoid configuration mistakes opening an
  // SSRF hole onto the IMDS surface.
  if (ALWAYS_BLOCKED_HOSTS.has(host)) {
    return { ok: false, reason: `Host ${host} is blocked` };
  }

  const isPrivate =
    LOOPBACK_HOST_ALIASES.has(host) ||
    isPrivateIPv4(host) ||
    isIPv6Private(host);

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
    // Allowlist matched, but private/loopback/link-local IPs still require
    // the explicit dev override. The allowlist narrows public hosts; it does
    // not unlock internal networks.
    if (isPrivate && !allowPrivate) {
      return {
        ok: false,
        reason: `Host ${host} is a private/loopback address`,
      };
    }
    return { ok: true };
  }

  if (allowPrivate) return { ok: true };

  if (isPrivate) {
    return { ok: false, reason: `Host ${host} is a private/loopback address` };
  }
  return { ok: true };
}

export function logBlockedUrl(context: string, url: string, reason: string) {
  logger.warn({ context, url, reason }, "outbound URL blocked");
}
