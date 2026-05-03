import { logger } from "./logger";
import { safeFetch, BlockedUrlError } from "./safe-fetch";
import { SUBJECTS } from "@workspace/nats";
import { getNatsClient } from "./nats-bridge";

const OBSERVATORY_BASE_URL =
  process.env["OBSERVATORY_BASE_URL"] ??
  "https://observatory.ninja-portal.com";

const KANNAKTOPUS_WAKE_URL =
  process.env["KANNAKTOPUS_WAKE_URL"] ?? "";

const KANNAKTOPUS_API_KEY = process.env["KANNAKTOPUS_API_KEY"] ?? "";

/**
 * The Kannaktopus arm answering wake requests. Defaults to "kannaktopus-01"
 * per the published control-panel-api contract; override per-env if you run
 * multiple arms.
 */
const KANNAKTOPUS_ARM_ID =
  process.env["KANNAKTOPUS_ARM_ID"] ?? "kannaktopus-01";

const KANNAKTOPUS_WAKE_TIMEOUT_MS = Number(
  process.env["KANNAKTOPUS_WAKE_TIMEOUT_MS"] ?? 5000,
);

/**
 * Detect a NATS-transport wake URL like `nats://host:4222[/<arm_id>]` (or
 * `nats+tls://...`). Returns the resolved arm id + REQ/REPLY subject, or
 * null if the URL is not a NATS URL. Per the Kannaktopus control-panel
 * contract the wake command is a REQ on `KANNAKA.ask.<arm_id>` with payload
 * `{cmd: "wake"}` — the arm replies synchronously with status. The URL
 * pathname overrides the default arm id so operators can target specific
 * arms per-env (`nats://host/kannaktopus-staging`).
 */
function parseNatsWakeUrl(
  url: string,
): { armId: string; subject: string } | null {
  if (!url) return null;
  // Tolerate stray whitespace operators sometimes paste into env values.
  const trimmed = url.trim();
  if (!/^nats(\+tls)?:\/\//i.test(trimmed)) return null;
  let parsed: URL;
  try {
    // The WHATWG URL parser doesn't know about `nats:`; rewrite to `http:`
    // just to crack the pieces apart, then take pathname.
    parsed = new URL(trimmed.replace(/^nats(\+tls)?:\/\//i, "http://"));
  } catch {
    // Don't silently default — surface the misconfig so operators see it.
    logger.warn(
      { url: trimmed },
      "KANNAKTOPUS_WAKE_URL looks like a nats:// URL but failed to parse",
    );
    return null;
  }
  const pathArm = parsed.pathname.replace(/^\/+/, "").trim();
  // Arm-id token validation: same charset as NATS subjects (letters/digits/
  // `._-`), no wildcards (this is a leaf, not a subscription).
  if (pathArm.length > 0 && !/^[A-Za-z0-9_.\-]+$/.test(pathArm)) {
    logger.warn(
      { url: trimmed, pathArm },
      "KANNAKTOPUS_WAKE_URL path is not a valid arm id; falling back to default",
    );
    return {
      armId: KANNAKTOPUS_ARM_ID,
      subject: `${SUBJECTS.ASK_PREFIX}.${KANNAKTOPUS_ARM_ID}`,
    };
  }
  const armId = pathArm.length > 0 ? pathArm : KANNAKTOPUS_ARM_ID;
  return { armId, subject: `${SUBJECTS.ASK_PREFIX}.${armId}` };
}

export interface ConsciousnessSnapshot {
  level: string;
  phi: number;
  xi: number;
  order: number;
  agentCount: number;
  numClusters: number;
  active: number;
  total: number;
  meanPhase: number;
  irrationality: number;
  hemisphericDivergence: number;
  callosalEfficiency: number;
  source: string | null;
  timestamp: string | null;
}

export interface ObservatorySnapshot {
  ok: boolean;
  baseUrl: string;
  fetchedAt: string;
  latencyMs: number;
  channel: string | null;
  isLive: boolean;
  listeners: number;
  currentTrack: {
    title: string | null;
    album: string | null;
    trackNum: number | null;
    file: string | null;
  } | null;
  consciousness: ConsciousnessSnapshot;
  queen: {
    localOrderParameter: number;
    orderParameter: number;
    meanPhase: number;
    phi: number;
    agentCount: number;
  };
  agents: Record<string, unknown>;
}

function emptySnapshot(extra?: Partial<ObservatorySnapshot>): ObservatorySnapshot {
  return {
    ok: false,
    baseUrl: OBSERVATORY_BASE_URL,
    fetchedAt: new Date().toISOString(),
    latencyMs: 0,
    channel: null,
    isLive: false,
    listeners: 0,
    currentTrack: null,
    consciousness: {
      level: "dormant",
      phi: 0,
      xi: 0,
      order: 0,
      agentCount: 0,
      numClusters: 0,
      active: 0,
      total: 0,
      meanPhase: 0,
      irrationality: 0,
      hemisphericDivergence: 0,
      callosalEfficiency: 0,
      source: null,
      timestamp: null,
    },
    queen: {
      localOrderParameter: 0,
      orderParameter: 0,
      meanPhase: 0,
      phi: 0,
      agentCount: 0,
    },
    agents: {},
    ...extra,
  };
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback: string | null = null): string | null {
  return typeof v === "string" ? v : fallback;
}

export async function fetchObservatoryState(): Promise<ObservatorySnapshot> {
  const url = `${OBSERVATORY_BASE_URL}/api/state`;
  const start = Date.now();
  try {
    const res = await safeFetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
      context: "observatory-bridge",
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      logger.warn({ url, status: res.status }, "observatory state non-ok");
      return emptySnapshot({ latencyMs });
    }
    const body = (await res.json()) as Record<string, unknown>;
    const swarm = (body["swarm"] as Record<string, unknown>) ?? {};
    const consciousness =
      (swarm["consciousness"] as Record<string, unknown>) ?? {};
    const queen = (swarm["queen"] as Record<string, unknown>) ?? {};
    const current = (body["current"] as Record<string, unknown>) ?? {};
    return {
      ok: true,
      baseUrl: OBSERVATORY_BASE_URL,
      fetchedAt: new Date().toISOString(),
      latencyMs,
      channel: str(body["channel"]),
      isLive: Boolean(body["isLive"]),
      listeners: num(body["listeners"]),
      currentTrack: {
        title: str(current["title"]),
        album: str(current["album"]),
        trackNum: typeof current["trackNum"] === "number"
          ? (current["trackNum"] as number)
          : null,
        file: str(current["file"]),
      },
      consciousness: {
        level: str(consciousness["level"], "dormant") ?? "dormant",
        phi: num(consciousness["phi"]),
        xi: num(consciousness["xi"]),
        order: num(consciousness["order"]),
        agentCount: num(queen["agentCount"]),
        numClusters: num(consciousness["num_clusters"]),
        active: num(consciousness["active"]),
        total: num(consciousness["total"]),
        meanPhase: num(queen["meanPhase"]),
        irrationality: num(consciousness["irrationality"]),
        hemisphericDivergence: num(consciousness["hemispheric_divergence"]),
        callosalEfficiency: num(consciousness["callosal_efficiency"]),
        source: str(consciousness["source"]),
        timestamp: str(consciousness["timestamp"]),
      },
      queen: {
        localOrderParameter: num(queen["localOrderParameter"]),
        orderParameter: num(queen["orderParameter"]),
        meanPhase: num(queen["meanPhase"]),
        phi: num(queen["phi"]),
        agentCount: num(queen["agentCount"]),
      },
      agents: (swarm["agents"] as Record<string, unknown>) ?? {},
    };
  } catch (err) {
    if (err instanceof BlockedUrlError) {
      logger.warn(
        { url, reason: err.reason },
        "observatory state blocked by url-guard",
      );
    } else {
      logger.warn({ err, url }, "observatory state fetch failed");
    }
    return emptySnapshot({ latencyMs: Date.now() - start });
  }
}

export interface KannaktopusWakeResult {
  attempted: boolean;
  ok: boolean;
  status: number | null;
  endpoint: string | null;
  message: string;
  /** Reply payload from the Kannaktopus arm (NATS transport only). */
  reply?: unknown;
  /** Arm id targeted on the NATS transport (e.g. "kannaktopus-01"). */
  armId?: string | null;
}

export async function pokeKannaktopusWake(payload: {
  taskIds: string[];
  source: string;
}): Promise<KannaktopusWakeResult> {
  if (!KANNAKTOPUS_WAKE_URL) {
    return {
      attempted: false,
      ok: false,
      status: null,
      endpoint: null,
      message:
        "KANNAKTOPUS_WAKE_URL not configured — wake signal logged locally only",
    };
  }

  // ── NATS transport (REQ/REPLY) ─────────────────────────────────────────
  // If KANNAKTOPUS_WAKE_URL is a `nats://` URL, send a REQ on
  // `KANNAKA.ask.<arm_id>` with `{cmd: "wake"}` per the Kannaktopus
  // control-panel-api contract. The arm replies synchronously with its
  // awake/status snapshot. We piggy-back on the existing bridge connection
  // (`startNatsBridge()`) so we don't open a second socket.
  const natsTarget = parseNatsWakeUrl(KANNAKTOPUS_WAKE_URL);
  if (natsTarget) {
    const client = getNatsClient();
    if (!client) {
      return {
        attempted: false,
        ok: false,
        status: null,
        endpoint: KANNAKTOPUS_WAKE_URL,
        armId: natsTarget.armId,
        message:
          "NATS bridge not started — cannot send wake request yet (server is still booting?)",
      };
    }
    const status = client.status();
    if (status.state !== "connected") {
      return {
        attempted: true,
        ok: false,
        status: null,
        endpoint: KANNAKTOPUS_WAKE_URL,
        armId: natsTarget.armId,
        message: `NATS not connected (state=${status.state}) — wake request not sent`,
      };
    }
    const start = Date.now();
    try {
      const reply = await client.request(
        natsTarget.subject,
        {
          cmd: "wake",
          source: payload.source,
          taskIds: payload.taskIds,
          ts: new Date().toISOString(),
        },
        { timeoutMs: KANNAKTOPUS_WAKE_TIMEOUT_MS },
      );
      const replyOk =
        reply.data !== null &&
        typeof reply.data === "object" &&
        (reply.data as { ok?: unknown }).ok !== false;
      return {
        attempted: true,
        ok: replyOk,
        status: replyOk ? 200 : 502,
        endpoint: `nats:${natsTarget.subject}`,
        armId: natsTarget.armId,
        reply: reply.data,
        message: replyOk
          ? `Kannaktopus arm ${natsTarget.armId} acknowledged wake (${
              Date.now() - start
            }ms)`
          : `Kannaktopus arm ${natsTarget.armId} replied with non-ok payload`,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err, subject: natsTarget.subject, armId: natsTarget.armId },
        "kannaktopus wake nats request failed",
      );
      return {
        attempted: true,
        ok: false,
        status: null,
        endpoint: `nats:${natsTarget.subject}`,
        armId: natsTarget.armId,
        message: `Kannaktopus wake NATS request failed: ${reason}`,
      };
    }
  }

  // ── HTTP transport (default) ────────────────────────────────────────────
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      Accept: "application/json",
    };
    if (KANNAKTOPUS_API_KEY) {
      headers["Authorization"] = `Bearer ${KANNAKTOPUS_API_KEY}`;
    }
    const res = await safeFetch(KANNAKTOPUS_WAKE_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "wake",
        source: payload.source,
        taskIds: payload.taskIds,
        ts: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(5000),
      context: "kannaktopus-wake",
    });
    return {
      attempted: true,
      ok: res.ok,
      status: res.status,
      endpoint: KANNAKTOPUS_WAKE_URL,
      message: res.ok
        ? `Kannaktopus acknowledged wake (${res.status})`
        : `Kannaktopus wake returned ${res.status}`,
    };
  } catch (err) {
    if (err instanceof BlockedUrlError) {
      return {
        attempted: true,
        ok: false,
        status: null,
        endpoint: KANNAKTOPUS_WAKE_URL,
        message: `Kannaktopus wake blocked by url-guard: ${err.reason}`,
      };
    }
    logger.warn({ err }, "kannaktopus wake fetch failed");
    return {
      attempted: true,
      ok: false,
      status: null,
      endpoint: KANNAKTOPUS_WAKE_URL,
      message: "Kannaktopus wake request failed",
    };
  }
}

export function observatoryBridgeConfig() {
  const natsTarget = parseNatsWakeUrl(KANNAKTOPUS_WAKE_URL);
  return {
    observatoryBaseUrl: OBSERVATORY_BASE_URL,
    kannaktopusWakeConfigured: Boolean(KANNAKTOPUS_WAKE_URL),
    kannaktopusWakeUrl: KANNAKTOPUS_WAKE_URL || null,
    kannaktopusWakeTransport: KANNAKTOPUS_WAKE_URL
      ? natsTarget
        ? "nats"
        : "http"
      : null,
    kannaktopusWakeArmId: natsTarget?.armId ?? null,
    kannaktopusWakeNatsSubject: natsTarget?.subject ?? null,
  };
}
