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

export function getLastSuccess(key: string): CacheEntry | undefined {
  return cache.get(key);
}

export function clearCache(): void {
  cache.clear();
}
