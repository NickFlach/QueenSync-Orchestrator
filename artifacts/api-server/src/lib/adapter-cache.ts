import type { AdapterEventOut } from "./adapters-shared";

interface CacheEntry {
  events: AdapterEventOut[];
  fetchedAt: number;
  metricsSuppressed?: boolean;
}

const cache = new Map<string, CacheEntry>();

export function setLastSuccess(
  key: string,
  events: AdapterEventOut[],
  extras?: { metricsSuppressed?: boolean },
): void {
  cache.set(key, {
    events,
    fetchedAt: Date.now(),
    metricsSuppressed: extras?.metricsSuppressed,
  });
}

/**
 * Touch the cache's fetchedAt without overwriting cached events. Used when a
 * live endpoint succeeds but yields no events — we want lastSuccessAt to
 * reflect the successful contact while still serving the previously cached
 * snapshot if the endpoint goes down later.
 */
export function touchLastSuccess(
  key: string,
  extras?: { metricsSuppressed?: boolean },
): void {
  const existing = cache.get(key);
  if (existing) {
    existing.fetchedAt = Date.now();
    if (extras?.metricsSuppressed !== undefined) {
      existing.metricsSuppressed = extras.metricsSuppressed;
    }
  } else {
    cache.set(key, {
      events: [],
      fetchedAt: Date.now(),
      metricsSuppressed: extras?.metricsSuppressed,
    });
  }
}

export function getLastSuccess(key: string): CacheEntry | undefined {
  return cache.get(key);
}

export function clearCache(): void {
  cache.clear();
}
