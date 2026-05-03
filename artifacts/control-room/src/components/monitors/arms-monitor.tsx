import { useQuery } from "@tanstack/react-query";
import { api, asArray } from "@/lib/api";

interface Arm {
  id: string;
  name: string;
  status?: string;
  state?: string;
  type?: string;
  lastSeenAt?: string;
}

function statusTone(s?: string): string {
  switch ((s ?? "").toLowerCase()) {
    case "online":
    case "idle":
    case "ok":
    case "ready":
      return "text-emerald-500";
    case "working":
    case "busy":
    case "observing":
    case "running":
      return "text-amber-500";
    case "offline":
    case "error":
    case "down":
      return "text-red-500";
    default:
      return "text-indigo-400";
  }
}

export function ArmsMonitor() {
  const q = useQuery({
    queryKey: ["arms"],
    queryFn: () => api<unknown>("/arms"),
    refetchInterval: 5000,
  });
  const items = asArray<Arm>(q.data, "arms");
  const active = items.filter((a) => {
    const s = (a.status ?? a.state ?? "").toLowerCase();
    return s !== "offline" && s !== "down" && s !== "error";
  }).length;

  return (
    <div className="absolute inset-0 p-2 qs-font-mono text-[10px] qs-scrollbar overflow-y-auto flex flex-col space-y-1.5">
      {q.isLoading && <div className="text-indigo-500">› querying arms…</div>}
      {q.isError && <div className="text-red-400">› arms registry offline</div>}
      {!q.isLoading && items.length === 0 && (
        <div className="text-indigo-500">› no arms registered</div>
      )}
      {items.slice(0, 10).map((arm) => {
        const s = arm.status ?? arm.state ?? "unknown";
        return (
          <div
            key={arm.id}
            className="flex justify-between items-center border-b border-indigo-900/30 pb-1"
            data-testid={`row-arm-${arm.name}`}
          >
            <span className="text-indigo-300 truncate pr-2">{arm.name}</span>
            <span className={statusTone(s)}>{s.toUpperCase()}</span>
          </div>
        );
      })}
      {items.length > 0 && (
        <div className="mt-auto text-indigo-600 text-center pt-1 shrink-0">
          {active}/{items.length} ACTIVE
        </div>
      )}
    </div>
  );
}
