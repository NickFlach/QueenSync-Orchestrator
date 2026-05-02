import type pino from "pino";

/**
 * Self-heartbeat poster — POSTs to QueenSync's
 * `/api/arms/:armId/heartbeat` endpoint on a fixed interval so the Queen
 * Console reflects this shim as `idle` within a minute of boot, and demotes
 * it back to `offline` (via the QueenSync staleness sweep) within ~3 minutes
 * of this process exiting.
 *
 * QueenSync also actively probes the shim's `/healthz` from its scheduler,
 * so this client is a *secondary* signal — useful when the shim sits behind
 * a NAT or firewall that QueenSync can't reach back into. When both paths
 * are wired the freshest signal wins.
 *
 * Configuration is environment-driven so the systemd unit can opt in
 * without code changes:
 *   QUEENSYNC_BASE_URL          Required. e.g. https://queensync.example.com
 *   QUEENSYNC_OPERATOR_TOKEN    Required. Bearer token with operator role.
 *   QUEENSYNC_ARM_ID            Optional. Defaults to "oracle-admin".
 *   QUEENSYNC_HEARTBEAT_MS      Optional. Defaults to 30_000.
 */

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
export const DEFAULT_ARM_ID = "oracle-admin";

export interface HeartbeatClientOptions {
  baseUrl: string;
  token: string;
  armId?: string;
  intervalMs?: number;
  log: pino.Logger;
  /** Inject a custom HTTP fetcher (tests). */
  fetcher?: typeof fetch;
}

export interface HeartbeatHandle {
  stop: () => void;
  /** Trigger a single beat manually (used by tests + the boot kick). */
  beatOnce: () => Promise<boolean>;
}

/**
 * Post one heartbeat. Returns true on 2xx, false otherwise. Never throws —
 * QueenSync going offline must NOT crash the shim.
 */
export async function postHeartbeat(
  opts: Omit<HeartbeatClientOptions, "intervalMs"> & { timeoutMs?: number },
): Promise<boolean> {
  const armId = opts.armId ?? DEFAULT_ARM_ID;
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/arms/${encodeURIComponent(armId)}/heartbeat`;
  const fetcher = opts.fetcher ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5_000;
  try {
    const r = await fetcher(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.token}`,
      },
      body: JSON.stringify({ source: "oracle-admin-self-heartbeat" }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) {
      opts.log.warn(
        { armId, status: r.status, url },
        "heartbeat post non-2xx",
      );
      return false;
    }
    opts.log.debug({ armId, url }, "heartbeat posted");
    return true;
  } catch (err) {
    opts.log.warn(
      { armId, err: (err as Error).message, url },
      "heartbeat post failed",
    );
    return false;
  }
}

/**
 * Start the periodic heartbeat poster. Returns a handle with stop() and
 * beatOnce() (mainly for tests). Idempotent — safe to call once at boot.
 */
export function startHeartbeatClient(
  opts: HeartbeatClientOptions,
): HeartbeatHandle {
  const intervalMs = opts.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const armId = opts.armId ?? DEFAULT_ARM_ID;
  const beatOnce = () => postHeartbeat(opts);
  // Kick off immediately so the Console flips to `idle` within seconds, not
  // a full interval.
  void beatOnce();
  const timer = setInterval(() => {
    void beatOnce();
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  opts.log.info(
    { armId, intervalMs, baseUrl: opts.baseUrl },
    "heartbeat client started",
  );
  return {
    stop: () => clearInterval(timer),
    beatOnce,
  };
}

/**
 * Read env, decide whether to start the heartbeat poster. Logs a single
 * INFO when configured, a single WARN when partially configured, and stays
 * silent when entirely unconfigured (the local-dev / off-Replit happy path
 * where QueenSync probes us directly).
 */
export function maybeStartHeartbeatFromEnv(
  log: pino.Logger,
): HeartbeatHandle | null {
  const baseUrl = process.env["QUEENSYNC_BASE_URL"]?.trim();
  const token = process.env["QUEENSYNC_OPERATOR_TOKEN"]?.trim();
  const armId = process.env["QUEENSYNC_ARM_ID"]?.trim() || DEFAULT_ARM_ID;
  const intervalEnv = process.env["QUEENSYNC_HEARTBEAT_MS"];
  if (!baseUrl && !token) return null;
  if (!baseUrl || !token) {
    log.warn(
      { hasBaseUrl: Boolean(baseUrl), hasToken: Boolean(token) },
      "heartbeat client partially configured — both QUEENSYNC_BASE_URL and " +
        "QUEENSYNC_OPERATOR_TOKEN are required. Skipping self-heartbeat.",
    );
    return null;
  }
  const intervalMs = intervalEnv ? Number(intervalEnv) : undefined;
  if (intervalMs !== undefined && (!Number.isFinite(intervalMs) || intervalMs <= 0)) {
    log.warn(
      { raw: intervalEnv },
      "QUEENSYNC_HEARTBEAT_MS is not a positive number — using default",
    );
  }
  return startHeartbeatClient({
    baseUrl,
    token,
    armId,
    intervalMs:
      intervalMs !== undefined && Number.isFinite(intervalMs) && intervalMs > 0
        ? intervalMs
        : undefined,
    log,
  });
}
