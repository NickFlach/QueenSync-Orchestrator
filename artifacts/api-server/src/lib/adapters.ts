import { logger } from "./logger";
import { safeFetch, BlockedUrlError } from "./safe-fetch";

export type AdapterMode = "live" | "mock";

export interface AdapterEventOut {
  id: string;
  type: string;
  summary: string;
  raw: Record<string, unknown>;
  createdAt: string;
}

const RADIO_BASE_URL =
  process.env["RADIO_BASE_URL"] ?? "https://radio.ninja-portal.com";
const OBSERVATORY_BASE_URL =
  process.env["OBSERVATORY_BASE_URL"] ??
  "https://observatory.ninja-portal.com";
const QUEENSYNC_API_KEY = process.env["QUEENSYNC_API_KEY"] ?? "";

async function tryFetch(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: string; latencyMs: number }> {
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
    } else {
      logger.warn({ err, url }, "adapter fetch failed");
    }
    return { ok: false, status: 0, body: "", latencyMs: Date.now() - start };
  }
}

export async function radioHealth() {
  const r = await tryFetch(`${RADIO_BASE_URL}/health`);
  if (r.ok) {
    return {
      name: "radio",
      baseUrl: RADIO_BASE_URL,
      ok: true,
      mode: "live" as AdapterMode,
      message: `Radio online (${r.status})`,
      latencyMs: r.latencyMs,
    };
  }
  return {
    name: "radio",
    baseUrl: RADIO_BASE_URL,
    ok: true,
    mode: "mock" as AdapterMode,
    message: "Radio unreachable — mock fallback active",
    latencyMs: r.latencyMs,
  };
}

export async function observatoryHealth() {
  const r = await tryFetch(`${OBSERVATORY_BASE_URL}/health`);
  if (r.ok) {
    return {
      name: "observatory",
      baseUrl: OBSERVATORY_BASE_URL,
      ok: true,
      mode: "live" as AdapterMode,
      message: `Observatory online (${r.status})`,
      latencyMs: r.latencyMs,
    };
  }
  return {
    name: "observatory",
    baseUrl: OBSERVATORY_BASE_URL,
    ok: true,
    mode: "mock" as AdapterMode,
    message: "Observatory unreachable — mock fallback active",
    latencyMs: r.latencyMs,
  };
}

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

export async function radioPullEvents(): Promise<{
  mode: AdapterMode;
  events: AdapterEventOut[];
}> {
  const r = await tryFetch(`${RADIO_BASE_URL}/api/transmissions?limit=5`);
  if (r.ok && r.body) {
    try {
      const parsed = JSON.parse(r.body);
      const arr: unknown[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { items?: unknown[] }).items)
          ? ((parsed as { items: unknown[] }).items)
          : [];
      const events: AdapterEventOut[] = arr.slice(0, 5).map((item, i) => {
        const obj = item as Record<string, unknown>;
        return {
          id: String(obj.id ?? `radio-${Date.now()}-${i}`),
          type: String(obj.type ?? "transmission"),
          summary: String(
            obj.title ?? obj.summary ?? obj.message ?? "radio transmission",
          ),
          raw: obj,
          createdAt: String(
            obj.createdAt ?? obj.created_at ?? new Date().toISOString(),
          ),
        };
      });
      if (events.length > 0) return { mode: "live", events };
    } catch {
      // fall through to mock
    }
  }
  return { mode: "mock", events: mockEvents(RADIO_MOCK_TYPES) };
}

export async function observatoryPullEvents(): Promise<{
  mode: AdapterMode;
  events: AdapterEventOut[];
}> {
  const r = await tryFetch(`${OBSERVATORY_BASE_URL}/api/events?limit=5`);
  if (r.ok && r.body) {
    try {
      const parsed = JSON.parse(r.body);
      const arr: unknown[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { items?: unknown[] }).items)
          ? ((parsed as { items: unknown[] }).items)
          : [];
      const events: AdapterEventOut[] = arr.slice(0, 5).map((item, i) => {
        const obj = item as Record<string, unknown>;
        return {
          id: String(obj.id ?? `obs-${Date.now()}-${i}`),
          type: String(obj.type ?? obj.kind ?? "observation"),
          summary: String(
            obj.title ?? obj.summary ?? obj.message ?? "observation event",
          ),
          raw: obj,
          createdAt: String(
            obj.createdAt ?? obj.created_at ?? new Date().toISOString(),
          ),
        };
      });
      if (events.length > 0) return { mode: "live", events };
    } catch {
      // fall through to mock
    }
  }
  return { mode: "mock", events: mockEvents(OBS_MOCK_TYPES) };
}
