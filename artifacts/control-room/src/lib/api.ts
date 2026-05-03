export async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.text();
      detail = body.slice(0, 240);
    } catch {
      /* ignore */
    }
    throw new Error(
      `${init?.method ?? "GET"} /api${path} → ${res.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

/**
 * Some endpoints return raw arrays, others return `{items: [...]}` envelopes.
 * Normalise both so monitor components don't have to care.
 */
export function asArray<T>(data: unknown, key?: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (key && Array.isArray(obj[key])) return obj[key] as T[];
    if (Array.isArray(obj["items"])) return obj["items"] as T[];
    if (Array.isArray(obj["data"])) return obj["data"] as T[];
  }
  return [];
}
