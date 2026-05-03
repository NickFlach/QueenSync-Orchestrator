import { useQuery } from "@tanstack/react-query";
import { api, asArray } from "@/lib/api";

interface Signal {
  id: string;
  type?: string;
  source?: string;
  summary?: string;
  createdAt?: string;
  ts?: string;
}

function fmt(ts?: string): string {
  if (!ts) return "--:--:--";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts.slice(11, 19);
  return d.toTimeString().split(" ")[0];
}

export function SignalsMonitor() {
  const q = useQuery({
    queryKey: ["signals"],
    queryFn: () => api<unknown>("/signals?limit=15"),
    refetchInterval: 3000,
  });
  const items = asArray<Signal>(q.data, "signals");

  return (
    <div className="absolute inset-0 p-2 qs-font-mono text-[10px] qs-scrollbar overflow-y-auto flex flex-col space-y-1">
      {q.isLoading && <div className="text-indigo-500">› listening for signals…</div>}
      {q.isError && <div className="text-red-400">› signal bus offline</div>}
      {!q.isLoading && items.length === 0 && (
        <div className="text-indigo-500">› no inbound signals</div>
      )}
      {items.slice(0, 18).map((s) => (
        <div key={s.id} className="text-indigo-300/80">
          <span className="text-indigo-600">{fmt(s.ts ?? s.createdAt)}</span>{" "}
          <span className="text-violet-400">{s.type ?? "signal"}</span>
          {s.source && <span className="text-indigo-500"> ← {s.source}</span>}
          {s.summary && (
            <span className="text-indigo-300/60"> · {s.summary.slice(0, 80)}</span>
          )}
        </div>
      ))}
    </div>
  );
}
