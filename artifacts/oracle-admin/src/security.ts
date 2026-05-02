/**
 * Defense-in-depth helpers for the privileged shim.
 *
 * The shim's primary auth is the HMAC body signature on /dispatch, but a
 * leaked secret would otherwise give an attacker unconditional access to
 * `sudo systemctl …`. The helpers in this file add three independent
 * layers in front of HMAC verification so a single compromise (leaked
 * secret, misconfigured proxy, etc.) can't be turned into unbounded
 * privilege:
 *
 *   1. IP allowlist — drop the connection before we even parse the body.
 *   2. Per-IP rate limit — bound the blast radius of a leaked secret.
 *   3. Per-capability allowlist — let an operator disable individual
 *      handlers (e.g. `dream_trigger`) without redeploying the shim.
 */

/**
 * Strip an IPv4-mapped-IPv6 prefix (`::ffff:1.2.3.4`) so the value
 * compares cleanly against an IPv4 entry in the allowlist. Express
 * routinely produces these mapped addresses on dual-stack hosts.
 */
export function normalizeIp(ip: string): string {
  if (!ip) return ip;
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return mapped[1]!;
  // ::1 and 127.0.0.1 are conceptually the same — keep them distinct so
  // the operator can choose explicitly which loopback family to allow,
  // but trim any zone identifier (`fe80::1%eth0`) and surrounding
  // whitespace.
  return lower.replace(/%.*$/, "").trim();
}

export function parseIpList(input: string | undefined | null): Set<string> {
  if (!input) return new Set();
  const out = new Set<string>();
  for (const raw of input.split(",")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    out.add(normalizeIp(trimmed));
  }
  return out;
}

/**
 * Empty allowlist == disabled (allow-all). When non-empty, the IP must
 * match exactly after normalization.
 */
export function isIpAllowed(
  ip: string | undefined,
  allowed: Set<string>,
): boolean {
  if (allowed.size === 0) return true;
  if (!ip) return false;
  return allowed.has(normalizeIp(ip));
}

/**
 * Returns null when no list is configured (= every capability is
 * permitted). Returns a Set otherwise; capabilities not in the set must
 * be rejected before dispatch.
 */
export function parseCapabilityList(
  input: string | undefined | null,
): Set<string> | null {
  if (input == null) return null;
  const out = new Set<string>();
  for (const raw of input.split(",")) {
    const trimmed = raw.trim();
    if (trimmed) out.add(trimmed);
  }
  // An explicitly-empty value (`ORACLE_ADMIN_ENABLED_CAPABILITIES=`)
  // means "no capabilities are allowed" — treat it the same as "no
  // configuration" so an operator can't accidentally lock out the entire
  // shim by setting an empty value. They have to be explicit.
  if (out.size === 0) return null;
  return out;
}

export function isCapabilityEnabled(
  capability: string,
  enabled: Set<string> | null,
): boolean {
  if (enabled === null) return true;
  return enabled.has(capability);
}

export interface RateLimiterOptions {
  /** Window length in ms (e.g. 60_000 for "per minute"). */
  windowMs: number;
  /** Max requests allowed per window per key. */
  max: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  /**
   * How many ms until the oldest in-window hit ages out. Always 0 when
   * `allowed` is true. Use this to populate `Retry-After`.
   */
  retryAfterMs: number;
  /** Count of in-window hits including the current one (if allowed). */
  count: number;
}

/**
 * In-process sliding-window limiter. We don't need persistence — when
 * the shim restarts, attackers lose any partial budget they'd
 * accumulated. The state is small enough to keep in a Map.
 */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly max: number;
  private readonly nowFn: () => number;

  constructor(opts: RateLimiterOptions) {
    if (opts.windowMs <= 0) throw new Error("windowMs must be > 0");
    if (opts.max < 0) throw new Error("max must be >= 0");
    this.windowMs = opts.windowMs;
    this.max = opts.max;
    this.nowFn = opts.now ?? (() => Date.now());
  }

  check(key: string): RateLimitResult {
    if (this.max === 0) {
      // max=0 means "block everything" — useful as a kill switch.
      return { allowed: false, retryAfterMs: this.windowMs, count: 0 };
    }
    const now = this.nowFn();
    const cutoff = now - this.windowMs;
    const previous = this.hits.get(key) ?? [];
    const fresh: number[] = [];
    for (const t of previous) {
      if (t > cutoff) fresh.push(t);
    }
    if (fresh.length >= this.max) {
      this.hits.set(key, fresh);
      const oldest = fresh[0]!;
      const retryAfterMs = Math.max(1, this.windowMs - (now - oldest));
      return { allowed: false, retryAfterMs, count: fresh.length };
    }
    fresh.push(now);
    this.hits.set(key, fresh);
    return { allowed: true, retryAfterMs: 0, count: fresh.length };
  }

  /**
   * Drop entries whose entire bucket has aged out. Cheap to call on a
   * timer to keep memory bounded for long-lived processes that see many
   * distinct IPs.
   */
  reap(): void {
    const cutoff = this.nowFn() - this.windowMs;
    for (const [key, arr] of this.hits) {
      let keep = false;
      for (const t of arr) {
        if (t > cutoff) {
          keep = true;
          break;
        }
      }
      if (!keep) this.hits.delete(key);
    }
  }

  /** Test helper. */
  size(): number {
    return this.hits.size;
  }
}
