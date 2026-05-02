import { logger } from "./logger";
import { safeFetch, BlockedUrlError } from "./safe-fetch";
import {
  getLastSuccess,
  setLastSuccess,
  touchLastSuccess,
} from "./adapter-cache";
import type { AdapterEventOut, AdapterMode } from "./adapters-shared";

export type { AdapterEventOut, AdapterMode } from "./adapters-shared";

const RADIO_BASE_URL =
  process.env["RADIO_BASE_URL"] ?? "https://radio.ninja-portal.com";
const OBSERVATORY_BASE_URL =
  process.env["OBSERVATORY_BASE_URL"] ??
  "https://observatory.ninja-portal.com";
const QUEENSYNC_API_KEY = process.env["QUEENSYNC_API_KEY"] ?? "";

function isForceMock(): boolean {
  const v = process.env["QUEENSYNC_FORCE_MOCK"];
  return v === "true" || v === "1";
}

interface FetchResult {
  ok: boolean;
  status: number;
  body: string;
  latencyMs: number;
  blockedReason?: string;
}

async function tryFetch(url: string, init?: RequestInit): Promise<FetchResult> {
  const start = Date.now();
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...((init?.headers as Record<string, string>) ?? {}),
    };
    if (QUEENSYNC_API_KEY) headers["Authorization"] = `Bearer ${QUEENSYNC_API_KEY}`;
    const res = await safeFetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(4000),
      context: "adapter",
    });
    const body = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      body,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    if (err instanceof BlockedUrlError) {
      logger.warn({ url, reason: err.reason }, "adapter fetch blocked by url-guard");
      return {
        ok: false,
        status: 0,
        body: "",
        latencyMs: Date.now() - start,
        blockedReason: err.reason,
      };
    }
    logger.warn({ err, url }, "adapter fetch failed");
    return { ok: false, status: 0, body: "", latencyMs: Date.now() - start };
  }
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["items", "data", "events", "results"]) {
      const v = obj[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

// ─── Health ────────────────────────────────────────────────────────────────

export interface AdapterHealthOut {
  name: string;
  baseUrl: string;
  ok: boolean;
  mode: AdapterMode;
  message: string;
  latencyMs: number;
  stale: boolean;
  lastSuccessAt: string | null;
  metricsSuppressed: boolean;
  forceMock: boolean;
}

function lastSuccessIso(key: string): string | null {
  const cached = getLastSuccess(key);
  return cached ? new Date(cached.fetchedAt).toISOString() : null;
}

export async function radioHealth(): Promise<AdapterHealthOut> {
  if (isForceMock()) {
    return {
      name: "radio",
      baseUrl: RADIO_BASE_URL,
      ok: true,
      mode: "forced_mock",
      message: "QUEENSYNC_FORCE_MOCK=true — radio mock data",
      latencyMs: 0,
      stale: false,
      lastSuccessAt: lastSuccessIso("radio"),
      metricsSuppressed: false,
      forceMock: true,
    };
  }
  const r = await tryFetch(`${RADIO_BASE_URL}/api/now-playing`);
  if (r.ok) {
    return {
      name: "radio",
      baseUrl: RADIO_BASE_URL,
      ok: true,
      mode: "live",
      message: `Radio online (${r.status})`,
      latencyMs: r.latencyMs,
      stale: false,
      lastSuccessAt: lastSuccessIso("radio"),
      metricsSuppressed: false,
      forceMock: false,
    };
  }
  const cached = getLastSuccess("radio");
  if (cached && isCacheUsable(cached.fetchedAt)) {
    return {
      name: "radio",
      baseUrl: RADIO_BASE_URL,
      ok: false,
      mode: "stale",
      message: `Radio unreachable — serving cached snapshot from ${new Date(cached.fetchedAt).toISOString()}`,
      latencyMs: r.latencyMs,
      stale: true,
      lastSuccessAt: new Date(cached.fetchedAt).toISOString(),
      metricsSuppressed: false,
      forceMock: false,
    };
  }
  return {
    name: "radio",
    baseUrl: RADIO_BASE_URL,
    ok: false,
    mode: "mock",
    message: r.blockedReason
      ? `Radio blocked by url-guard: ${r.blockedReason} — mock fallback`
      : "Radio unreachable, no cache yet — mock fallback active",
    latencyMs: r.latencyMs,
    stale: false,
    lastSuccessAt: null,
    metricsSuppressed: false,
    forceMock: false,
  };
}

export async function observatoryHealth(): Promise<AdapterHealthOut> {
  if (isForceMock()) {
    return {
      name: "observatory",
      baseUrl: OBSERVATORY_BASE_URL,
      ok: true,
      mode: "forced_mock",
      message: "QUEENSYNC_FORCE_MOCK=true — observatory mock data",
      latencyMs: 0,
      stale: false,
      lastSuccessAt: lastSuccessIso("observatory"),
      metricsSuppressed: false,
      forceMock: true,
    };
  }
  const r = await tryFetch(`${OBSERVATORY_BASE_URL}/api/state`);
  if (r.ok) {
    const parsed = safeJson(r.body) as Record<string, unknown> | null;
    const swarm = (parsed?.["swarm"] as Record<string, unknown>) ?? {};
    const consciousness =
      (swarm["consciousness"] as Record<string, unknown>) ?? {};
    const queen = (swarm["queen"] as Record<string, unknown>) ?? {};
    const phi = Number(consciousness["phi"] ?? queen["phi"] ?? 0);
    const xi = Number(consciousness["xi"] ?? 0);
    const order = Number(consciousness["order"] ?? queen["orderParameter"] ?? 0);
    const suppressed = phi === 0 && xi === 0 && order === 0;
    return {
      name: "observatory",
      baseUrl: OBSERVATORY_BASE_URL,
      ok: true,
      mode: "live",
      message: suppressed
        ? `Observatory online (${r.status}) — metrics suppressed (phi/xi/order all zero, likely bloated HRM)`
        : `Observatory online (${r.status})`,
      latencyMs: r.latencyMs,
      stale: false,
      lastSuccessAt: lastSuccessIso("observatory"),
      metricsSuppressed: suppressed,
      forceMock: false,
    };
  }
  const cached = getLastSuccess("observatory");
  if (cached && isCacheUsable(cached.fetchedAt)) {
    return {
      name: "observatory",
      baseUrl: OBSERVATORY_BASE_URL,
      ok: false,
      mode: "stale",
      message: `Observatory unreachable — serving cached snapshot from ${new Date(cached.fetchedAt).toISOString()}`,
      latencyMs: r.latencyMs,
      stale: true,
      lastSuccessAt: new Date(cached.fetchedAt).toISOString(),
      metricsSuppressed: cached.metricsSuppressed ?? false,
      forceMock: false,
    };
  }
  return {
    name: "observatory",
    baseUrl: OBSERVATORY_BASE_URL,
    ok: false,
    mode: "mock",
    message: r.blockedReason
      ? `Observatory blocked by url-guard: ${r.blockedReason} — mock fallback`
      : "Observatory unreachable, no cache yet — mock fallback active",
    latencyMs: r.latencyMs,
    stale: false,
    lastSuccessAt: null,
    metricsSuppressed: false,
    forceMock: false,
  };
}

// ─── Mock generators ───────────────────────────────────────────────────────

const RADIO_MOCK_TYPES = [
  "transmission.ping",
  "transmission.story",
  "transmission.chord",
];
const OBS_MOCK_TYPES = [
  "observation.commit",
  "observation.dream",
  "observation.anomaly",
];

function mockEvents(types: string[], n = 3): AdapterEventOut[] {
  const now = Date.now();
  return Array.from({ length: n }, (_, i) => {
    const t = types[i % types.length];
    return {
      id: `mock-${now}-${i}`,
      type: t,
      summary: `[mock] ${t} #${i + 1}`,
      raw: { mock: true, type: t, ts: now - i * 1000 },
      createdAt: new Date(now - i * 1000).toISOString(),
    };
  });
}

// ─── Radio: real endpoint mappers ──────────────────────────────────────────

interface RadioPullOptions {
  limit?: number;
}

async function fetchRadioEndpoint<T>(
  path: string,
): Promise<{ ok: boolean; data: T | null; status: number; blockedReason?: string }> {
  const r = await tryFetch(`${RADIO_BASE_URL}${path}`);
  if (!r.ok) return { ok: false, data: null, status: r.status, blockedReason: r.blockedReason };
  const parsed = safeJson(r.body);
  return { ok: true, data: parsed as T, status: r.status };
}

function nowPlayingEvent(np: unknown): AdapterEventOut | null {
  if (!np || typeof np !== "object") return null;
  const obj = np as Record<string, unknown>;
  const title = String(obj["title"] ?? obj["track"] ?? "now playing");
  const album = obj["album"] != null ? String(obj["album"]) : null;
  const summary = album ? `Now playing: ${title} — ${album}` : `Now playing: ${title}`;
  return {
    id: `radio-now-${String(obj["file"] ?? title)}`,
    type: "transmission.now_playing",
    summary,
    raw: obj,
    createdAt: new Date().toISOString(),
  };
}

function stateEvent(state: unknown): AdapterEventOut | null {
  if (!state || typeof state !== "object") return null;
  const obj = state as Record<string, unknown>;
  const channel = obj["channel"] != null ? String(obj["channel"]) : null;
  const isLive = Boolean(obj["isLive"]);
  const listeners = Number(obj["listeners"] ?? 0);
  return {
    id: `radio-state-${Date.now()}`,
    type: "transmission.state",
    summary: `Channel ${channel ?? "?"} ${isLive ? "live" : "offline"} · ${listeners} listeners`,
    raw: obj,
    createdAt: new Date().toISOString(),
  };
}

function floorReactionEvents(floor: unknown, limit: number): AdapterEventOut[] {
  const arr = asArray(floor);
  return arr.slice(0, limit).map((item, i) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    const reaction = obj["reaction"] ?? obj["emoji"] ?? obj["type"] ?? "🪶";
    const listener = obj["listener"] ?? obj["user"] ?? obj["id"] ?? "anon";
    const track = obj["track"] ?? obj["title"] ?? obj["file"] ?? "current";
    const ts = obj["ts"] ?? obj["timestamp"] ?? obj["createdAt"];
    return {
      id: String(obj["id"] ?? `floor-${ts ?? Date.now()}-${i}`),
      type: "reaction.floor",
      summary: `Floor reaction ${reaction} on ${track} from ${listener}`,
      raw: obj,
      createdAt:
        typeof ts === "string"
          ? ts
          : typeof ts === "number"
            ? new Date(ts).toISOString()
            : new Date().toISOString(),
    };
  });
}

function historyEvents(history: unknown, limit: number): AdapterEventOut[] {
  const arr = asArray(history);
  return arr.slice(0, limit).map((item, i) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    const title = obj["title"] ?? obj["track"] ?? "transmission";
    const ts = obj["ts"] ?? obj["timestamp"] ?? obj["playedAt"];
    return {
      id: String(obj["id"] ?? `radio-hist-${ts ?? Date.now()}-${i}`),
      type: "transmission.history",
      summary: `Played: ${title}`,
      raw: obj,
      createdAt:
        typeof ts === "string"
          ? ts
          : typeof ts === "number"
            ? new Date(ts).toISOString()
            : new Date().toISOString(),
    };
  });
}

function dreamsEvents(dreams: unknown, limit: number): AdapterEventOut[] {
  const arr = asArray(dreams);
  return arr.slice(0, limit).map((item, i) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    const strengthened = Number(obj["memories_strengthened"] ?? 0);
    const pruned = Number(obj["memories_pruned"] ?? 0);
    const hallucinated = Number(obj["memories_hallucinated"] ?? 0);
    const ts = obj["ts"] ?? obj["timestamp"] ?? obj["completedAt"];
    return {
      id: String(obj["id"] ?? `radio-dream-${ts ?? Date.now()}-${i}`),
      type: "dream.report",
      summary: `Dream cycle: +${strengthened} strengthened, -${pruned} pruned, ${hallucinated} hallucinated`,
      raw: obj,
      createdAt:
        typeof ts === "string"
          ? ts
          : typeof ts === "number"
            ? new Date(ts).toISOString()
            : new Date().toISOString(),
    };
  });
}

function scheduleEvent(schedule: unknown): AdapterEventOut | null {
  if (!schedule || typeof schedule !== "object") return null;
  const obj = schedule as Record<string, unknown>;
  const current =
    (obj["current"] as Record<string, unknown> | undefined) ??
    (obj["now"] as Record<string, unknown> | undefined) ??
    null;
  const blocks = asArray(obj["blocks"] ?? obj["schedule"] ?? []);
  const label =
    current && (current["name"] ?? current["title"] ?? current["block"]);
  const summary = label
    ? `Radio schedule: now → ${String(label)} (${blocks.length} blocks)`
    : `Radio schedule: ${blocks.length} blocks`;
  return {
    id: `radio-schedule-${Date.now()}`,
    type: "transmission.schedule",
    summary,
    raw: obj,
    createdAt: new Date().toISOString(),
  };
}

function swarmPeerEvents(peers: unknown, limit: number): AdapterEventOut[] {
  const arr = asArray(peers);
  return arr.slice(0, limit).map((item, i) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    const id = obj["id"] ?? obj["agentId"] ?? obj["name"] ?? `peer-${i}`;
    const status = obj["status"] ?? obj["state"] ?? "connected";
    return {
      id: `radio-peer-${String(id)}`,
      type: "swarm.peer",
      summary: `Swarm peer ${String(id)} — ${String(status)}`,
      raw: obj,
      createdAt: new Date().toISOString(),
    };
  });
}

function swarmEvents(swarm: unknown): AdapterEventOut[] {
  if (!swarm || typeof swarm !== "object") return [];
  const obj = swarm as Record<string, unknown>;
  const agents = obj["agents"] ?? obj["count"];
  const order = obj["order"] ?? obj["orderParameter"];
  return [
    {
      id: `radio-swarm-${Date.now()}`,
      type: "swarm.snapshot",
      summary: `Swarm: ${agents ?? "?"} agents, order=${
        typeof order === "number" ? order.toFixed(3) : order ?? "?"
      }`,
      raw: obj,
      createdAt: new Date().toISOString(),
    },
  ];
}

export interface AdapterPullOut {
  mode: AdapterMode;
  events: AdapterEventOut[];
  stale: boolean;
  lastSuccessAt: string | null;
  metricsSuppressed: boolean;
  note: string | null;
}

export async function radioPullEvents(
  opts: RadioPullOptions = {},
): Promise<AdapterPullOut> {
  const limit = opts.limit ?? 5;
  if (isForceMock()) {
    return {
      mode: "forced_mock",
      events: mockEvents(RADIO_MOCK_TYPES),
      stale: false,
      lastSuccessAt: lastSuccessIso("radio"),
      metricsSuppressed: false,
      note: "QUEENSYNC_FORCE_MOCK=true",
    };
  }

  const [nowPlaying, state, schedule, floor, history, dreams, swarm, peers] =
    await Promise.all([
      fetchRadioEndpoint<unknown>("/api/now-playing"),
      fetchRadioEndpoint<unknown>("/api/state"),
      fetchRadioEndpoint<unknown>("/api/schedule"),
      fetchRadioEndpoint<unknown>(`/api/floor?limit=${limit}`),
      fetchRadioEndpoint<unknown>(`/api/history?limit=${limit}`),
      fetchRadioEndpoint<unknown>(`/api/dreams?limit=${limit}`),
      fetchRadioEndpoint<unknown>("/api/swarm"),
      fetchRadioEndpoint<unknown>("/api/swarm/peers"),
    ]);

  const events: AdapterEventOut[] = [];
  if (nowPlaying.ok) {
    const e = nowPlayingEvent(nowPlaying.data);
    if (e) events.push(e);
  }
  if (state.ok) {
    const e = stateEvent(state.data);
    if (e) events.push(e);
  }
  if (schedule.ok) {
    const e = scheduleEvent(schedule.data);
    if (e) events.push(e);
  }
  if (floor.ok) events.push(...floorReactionEvents(floor.data, limit));
  if (history.ok) events.push(...historyEvents(history.data, limit));
  if (dreams.ok) events.push(...dreamsEvents(dreams.data, limit));
  if (swarm.ok) events.push(...swarmEvents(swarm.data));
  if (peers.ok) events.push(...swarmPeerEvents(peers.data, limit));

  const anyOk = [
    nowPlaying,
    state,
    schedule,
    floor,
    history,
    dreams,
    swarm,
    peers,
  ].some((r) => r.ok);

  if (anyOk) {
    // Successful fetch (even if every endpoint returned an empty array) is
    // still "live" — never silently fall back to mock data on a healthy
    // endpoint. Cache events when present; otherwise just touch
    // lastSuccessAt so a later failure can still serve the previous
    // non-empty snapshot.
    if (events.length > 0) setLastSuccess("radio", events);
    else touchLastSuccess("radio");
    return {
      mode: "live",
      events,
      stale: false,
      lastSuccessAt: new Date().toISOString(),
      metricsSuppressed: false,
      note: events.length === 0 ? "Radio reachable but returned no events" : null,
    };
  }

  const cached = getLastSuccess("radio");
  if (cached && isCacheUsable(cached.fetchedAt)) {
    return {
      mode: "stale",
      events: cached.events,
      stale: true,
      lastSuccessAt: new Date(cached.fetchedAt).toISOString(),
      metricsSuppressed: false,
      note: "Radio unreachable — serving cached snapshot",
    };
  }
  return {
    mode: "mock",
    events: mockEvents(RADIO_MOCK_TYPES),
    stale: false,
    lastSuccessAt: null,
    metricsSuppressed: false,
    note: "Radio unreachable, no cache — using mock data",
  };
}

// ─── Observatory: real endpoint mapper ─────────────────────────────────────

function observatoryEventsFromState(state: unknown): {
  events: AdapterEventOut[];
  metricsSuppressed: boolean;
} {
  if (!state || typeof state !== "object") {
    return { events: [], metricsSuppressed: false };
  }
  const obj = state as Record<string, unknown>;
  const swarm = (obj["swarm"] as Record<string, unknown>) ?? {};
  const consciousness =
    (swarm["consciousness"] as Record<string, unknown>) ?? {};
  const queen = (swarm["queen"] as Record<string, unknown>) ?? {};
  const phi = Number(consciousness["phi"] ?? queen["phi"] ?? 0);
  const xi = Number(consciousness["xi"] ?? 0);
  const order = Number(
    consciousness["order"] ?? queen["orderParameter"] ?? 0,
  );
  const agents = Number(queen["agentCount"] ?? 0);
  const level = consciousness["level"] ?? "dormant";
  const metricsSuppressed = phi === 0 && xi === 0 && order === 0;
  const events: AdapterEventOut[] = [];
  if (metricsSuppressed) {
    events.push({
      id: `obs-suppressed-${Date.now()}`,
      type: "observation.metrics_suppressed",
      summary:
        "Observatory metrics suppressed — phi/xi/order all zero (likely bloated HRM)",
      raw: { phi, xi, order, agents, level, raw: obj },
      createdAt: new Date().toISOString(),
    });
  } else {
    events.push({
      id: `obs-state-${Date.now()}`,
      type: "observation.state",
      summary: `Observatory state: phi=${phi.toFixed(3)} xi=${xi.toFixed(3)} order=${order.toFixed(3)} (${agents} agents)`,
      raw: { phi, xi, order, agents, level, raw: obj },
      createdAt: new Date().toISOString(),
    });
  }
  // Also surface notable per-agent presence as discrete events
  const agentMap = (swarm["agents"] as Record<string, unknown>) ?? {};
  let i = 0;
  for (const [agentId, payload] of Object.entries(agentMap)) {
    if (i >= 4) break;
    events.push({
      id: `obs-agent-${agentId}-${Date.now()}`,
      type: "observation.agent_presence",
      summary: `Agent presence: ${agentId}`,
      raw: { agentId, payload },
      createdAt: new Date().toISOString(),
    });
    i++;
  }
  return { events, metricsSuppressed };
}

export async function observatoryPullEvents(): Promise<AdapterPullOut> {
  if (isForceMock()) {
    return {
      mode: "forced_mock",
      events: mockEvents(OBS_MOCK_TYPES),
      stale: false,
      lastSuccessAt: lastSuccessIso("observatory"),
      metricsSuppressed: false,
      note: "QUEENSYNC_FORCE_MOCK=true",
    };
  }
  const r = await tryFetch(`${OBSERVATORY_BASE_URL}/api/state`);
  if (r.ok) {
    const parsed = safeJson(r.body);
    const { events, metricsSuppressed } = observatoryEventsFromState(parsed);
    // Successful fetch is "live" even when no events are derived. Never
    // silently fall back to mock on a healthy endpoint.
    if (events.length > 0) {
      setLastSuccess("observatory", events, { metricsSuppressed });
    } else {
      touchLastSuccess("observatory", { metricsSuppressed });
    }
    return {
      mode: "live",
      events,
      stale: false,
      lastSuccessAt: new Date().toISOString(),
      metricsSuppressed,
      note: metricsSuppressed
        ? "Observatory online but reporting all-zero consciousness metrics"
        : events.length === 0
          ? "Observatory reachable but returned no events"
          : null,
    };
  }
  const cached = getLastSuccess("observatory");
  if (cached && isCacheUsable(cached.fetchedAt)) {
    return {
      mode: "stale",
      events: cached.events,
      stale: true,
      lastSuccessAt: new Date(cached.fetchedAt).toISOString(),
      metricsSuppressed: cached.metricsSuppressed ?? false,
      note: "Observatory unreachable — serving cached snapshot",
    };
  }
  return {
    mode: "mock",
    events: mockEvents(OBS_MOCK_TYPES),
    stale: false,
    lastSuccessAt: null,
    metricsSuppressed: false,
    note: r.blockedReason
      ? `Observatory blocked by url-guard: ${r.blockedReason}`
      : "Observatory unreachable, no cache — using mock data",
  };
}

// ─── Floor reactions poller (Wave 1: ~1s polling until NATS in Wave 2) ────

export type FloorPollResult =
  | { ok: true; events: AdapterEventOut[] }
  | { ok: false; reason: "force_mock" | "fetch_failed" };

export async function pollFloorReactions(limit = 5): Promise<FloorPollResult> {
  if (isForceMock()) return { ok: false, reason: "force_mock" };
  const r = await fetchRadioEndpoint<unknown>(`/api/floor?limit=${limit}`);
  if (!r.ok) return { ok: false, reason: "fetch_failed" };
  return { ok: true, events: floorReactionEvents(r.data, limit) };
}

// ─── Staleness policy ──────────────────────────────────────────────────────

export function maxStaleAgeMs(): number {
  const raw = process.env["QUEENSYNC_STALE_MAX_AGE_MS"];
  if (!raw) return 5 * 60_000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 5 * 60_000;
  return n;
}

export function isCacheUsable(fetchedAt: number): boolean {
  const max = maxStaleAgeMs();
  if (max === 0) return true; // 0 = unbounded
  return Date.now() - fetchedAt <= max;
}
