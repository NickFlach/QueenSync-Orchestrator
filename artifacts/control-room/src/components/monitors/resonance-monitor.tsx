import { useQuery } from "@tanstack/react-query";
import { api, asArray } from "@/lib/api";

interface ResonanceField {
  id: string;
  name?: string;
  symbol?: string;
  strength?: number;
  status?: string;
  tags?: string[];
}

function tone(strength?: number): { color: string; bar: string; label: string } {
  const s = strength ?? 0;
  if (s >= 0.85)
    return { color: "text-emerald-400 qs-glow-green", bar: "bg-emerald-500", label: "STABLE" };
  if (s >= 0.5)
    return { color: "text-amber-400 qs-glow-amber", bar: "bg-amber-500", label: "FLUCTUATING" };
  return { color: "text-red-400 qs-glow-red", bar: "bg-red-500", label: "CRITICAL" };
}

export function ResonanceMonitor() {
  const q = useQuery({
    queryKey: ["resonance-active"],
    queryFn: () => api<unknown>("/resonance/active"),
    refetchInterval: 4000,
  });
  const items = asArray<ResonanceField>(q.data, "fields");

  return (
    <div className="absolute inset-0 p-3 flex flex-col space-y-3 qs-font-mono qs-scrollbar overflow-y-auto">
      {q.isLoading && <div className="text-indigo-500 text-[11px]">› scanning fields…</div>}
      {q.isError && <div className="text-red-400 text-[11px]">› resonance bus offline</div>}
      {!q.isLoading && items.length === 0 && (
        <div className="text-indigo-500 text-[11px]">› no active fields</div>
      )}
      {items.slice(0, 6).map((f) => {
        const t = tone(f.strength);
        const pct = Math.max(0, Math.min(100, Math.round((f.strength ?? 0) * 100)));
        const name = f.symbol
          ? `${f.symbol}-${f.name ?? f.id}`
          : (f.name ?? f.id);
        return (
          <div key={f.id} className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex flex-col min-w-0">
                <span className="text-indigo-200 text-[11px] truncate">{name}</span>
                {f.tags && f.tags.length > 0 && (
                  <span className="text-indigo-500 text-[9px] mt-0.5 truncate">
                    TAGS: {f.tags.map((t) => `[${t}]`).join(" ")}
                  </span>
                )}
              </div>
              <div className="text-right shrink-0 ml-2">
                <div className={`${t.color} text-sm`}>
                  {(f.strength ?? 0).toFixed(3)}
                </div>
                <div className="text-indigo-600 text-[9px]">{t.label}</div>
              </div>
            </div>
            <div className="w-full bg-indigo-950/30 h-1.5 rounded-full overflow-hidden">
              <div
                className={`${t.bar} h-full`}
                style={{
                  width: `${pct}%`,
                  boxShadow: "0 0 5px currentColor",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
