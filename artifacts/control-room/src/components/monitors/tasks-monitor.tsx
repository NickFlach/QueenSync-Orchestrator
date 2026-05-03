import { useQuery } from "@tanstack/react-query";
import { api, asArray } from "@/lib/api";

interface Task {
  id: string;
  intent?: string;
  type?: string;
  kind?: string;
  requiredCapability?: string;
  status?: string;
  state?: string;
  assignedArmId?: string | null;
  armName?: string;
  createdAt?: string;
}

function tone(s?: string): string {
  switch ((s ?? "").toLowerCase()) {
    case "completed":
    case "done":
    case "ok":
    case "success":
      return "text-emerald-500";
    case "running":
    case "in_progress":
    case "assigned":
      return "text-amber-500";
    case "pending":
    case "queued":
      return "text-violet-400";
    case "failed":
    case "error":
      return "text-red-500";
    default:
      return "text-indigo-400";
  }
}

export function TasksMonitor() {
  const q = useQuery({
    queryKey: ["tasks"],
    queryFn: () => api<unknown>("/tasks?limit=12"),
    refetchInterval: 4000,
  });
  const items = asArray<Task>(q.data, "tasks");

  return (
    <div className="absolute inset-0 p-2 qs-font-mono text-[10px] qs-scrollbar overflow-y-auto flex flex-col space-y-1.5">
      {q.isLoading && <div className="text-indigo-500">› fetching task queue…</div>}
      {q.isError && <div className="text-red-400">› task service offline</div>}
      {!q.isLoading && items.length === 0 && (
        <div className="text-indigo-500">› queue empty</div>
      )}
      {items.slice(0, 10).map((t) => {
        const status = t.status ?? t.state ?? "unknown";
        const label =
          t.intent ?? t.type ?? t.kind ?? t.requiredCapability ?? "task";
        return (
          <div
            key={t.id}
            className="flex justify-between items-center border-b border-indigo-900/30 pb-1"
          >
            <span className="text-indigo-300 truncate pr-2">
              <span className="text-indigo-500">▸</span> {label}
              {t.requiredCapability && t.intent && (
                <span className="text-indigo-600"> · {t.requiredCapability}</span>
              )}
            </span>
            <span className={tone(status)}>{status.toUpperCase()}</span>
          </div>
        );
      })}
    </div>
  );
}
