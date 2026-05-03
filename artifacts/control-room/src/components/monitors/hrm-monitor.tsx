import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface Consciousness {
  level?: string;
  phi?: number;
  xi?: number;
  order?: number;
  agentCount?: number;
  numClusters?: number;
  active?: number;
  total?: number;
  meanPhi?: number;
}

interface HrmState {
  ok?: boolean;
  baseUrl?: string;
  fetchedAt?: string;
  latencyMs?: number;
  channel?: string | null;
  isLive?: boolean;
  listeners?: number;
  currentTrack?: string | null;
  consciousness?: Consciousness;
  // legacy / fallback shape
  phase?: string;
  energy?: number;
  attention?: number;
  drift?: number;
  lastUpdate?: string;
}

function clamp01(n?: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function Bar({
  label,
  value,
  color,
}: {
  label: string;
  value: number | undefined;
  color: string;
}) {
  const v = clamp01(value);
  return (
    <div>
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className="text-indigo-300">{label}</span>
        <span className={color}>{(value ?? 0).toFixed(3)}</span>
      </div>
      <div className="w-full bg-indigo-950/40 h-1 rounded-full overflow-hidden">
        <div
          className={color.replace(/text-/g, "bg-")}
          style={{ width: `${v * 100}%`, height: "100%" }}
        />
      </div>
    </div>
  );
}

export function HrmMonitor() {
  const q = useQuery({
    queryKey: ["observatory-state"],
    queryFn: () => api<HrmState>("/observatory/state"),
    refetchInterval: 4000,
  });
  const data = q.data ?? {};
  const c = data.consciousness ?? {};
  const phase = data.phase ?? c.level ?? "unknown";
  const showActive = typeof c.active === "number" && typeof c.total === "number";

  return (
    <div className="absolute inset-0 p-3 qs-font-mono space-y-3 qs-scrollbar overflow-y-auto">
      {q.isLoading && <div className="text-indigo-500 text-[11px]">› reading HRM…</div>}
      {q.isError && <div className="text-red-400 text-[11px]">› observatory offline</div>}
      {q.isSuccess && (
        <>
          <div className="text-[11px] flex items-center justify-between">
            <div>
              <span className="text-indigo-500">phase: </span>
              <span className="text-violet-300 qs-glow">{String(phase)}</span>
            </div>
            <div className="text-[9px] text-indigo-600">
              {data.isLive ? "LIVE" : data.ok === false ? "STALE" : "•"}
            </div>
          </div>
          <Bar label="phi (Φ)" value={c.phi ?? data.energy} color="text-emerald-400" />
          <Bar label="xi (Ξ)" value={c.xi ?? data.attention} color="text-violet-400" />
          <Bar label="order" value={c.order ?? data.drift} color="text-amber-400" />
          <div className="flex justify-between text-[10px] text-indigo-400 pt-1 border-t border-indigo-900/40">
            <span>agents: {c.agentCount ?? "—"}</span>
            <span>clusters: {c.numClusters ?? "—"}</span>
            {showActive && (
              <span>
                {c.active}/{c.total}
              </span>
            )}
          </div>
          {(data.fetchedAt ?? data.lastUpdate) && (
            <div className="text-[9px] text-indigo-600 text-right">
              upd: {String(data.fetchedAt ?? data.lastUpdate).slice(11, 19)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
