export type AdapterMode = "live" | "mock" | "stale" | "forced_mock";

export interface AdapterEventOut {
  id: string;
  type: string;
  summary: string;
  raw: Record<string, unknown>;
  createdAt: string;
}
