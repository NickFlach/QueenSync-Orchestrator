/**
 * In-process metrics for the oracle-admin shim. Exposed at /metrics in
 * both Prometheus text format (default) and JSON (when the client sends
 * `Accept: application/json`).
 *
 * The shim is small — there's exactly one gauge of interest (uptime)
 * and one counter family (dispatch totals broken out by capability and
 * outcome). We hand-roll the exposition rather than pulling in
 * `prom-client` to keep the privileged binary as small as possible.
 */

export type DispatchStatus =
  | "accepted"
  | "completed"
  | "failed"
  | "rejected_signature"
  | "rejected_ip"
  | "rejected_rate"
  | "rejected_capability"
  | "rejected_payload"
  | "rejected_unconfigured";

const counters = new Map<string, number>();
const startedAt = Date.now();

function key(capability: string, status: DispatchStatus): string {
  return `${capability}\u0000${status}`;
}

export function incrementDispatch(
  capability: string,
  status: DispatchStatus,
): void {
  const cap = capability && capability.length > 0 ? capability : "unknown";
  const k = key(cap, status);
  counters.set(k, (counters.get(k) ?? 0) + 1);
}

export interface CounterRow {
  capability: string;
  status: DispatchStatus;
  count: number;
}

export function snapshot(): CounterRow[] {
  const rows: CounterRow[] = [];
  for (const [k, count] of counters) {
    const [capability, status] = k.split("\u0000");
    rows.push({
      capability: capability!,
      status: status as DispatchStatus,
      count,
    });
  }
  rows.sort(
    (a, b) =>
      a.capability.localeCompare(b.capability) ||
      a.status.localeCompare(b.status),
  );
  return rows;
}

export function uptimeSeconds(): number {
  return Math.floor((Date.now() - startedAt) / 1000);
}

function escapeLabel(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export function renderPrometheus(): string {
  const lines: string[] = [];
  lines.push(
    "# HELP oracle_admin_dispatch_total Dispatches by capability and outcome.",
  );
  lines.push("# TYPE oracle_admin_dispatch_total counter");
  for (const row of snapshot()) {
    lines.push(
      `oracle_admin_dispatch_total{capability="${escapeLabel(row.capability)}",status="${escapeLabel(row.status)}"} ${row.count}`,
    );
  }
  lines.push("# HELP oracle_admin_uptime_seconds Process uptime in seconds.");
  lines.push("# TYPE oracle_admin_uptime_seconds gauge");
  lines.push(`oracle_admin_uptime_seconds ${uptimeSeconds()}`);
  return lines.join("\n") + "\n";
}

export function renderJson(): {
  uptimeSeconds: number;
  dispatches: CounterRow[];
} {
  return {
    uptimeSeconds: uptimeSeconds(),
    dispatches: snapshot(),
  };
}

/** Test-only. Resets the counter table; uptime is unaffected. */
export function __resetForTests(): void {
  counters.clear();
}
