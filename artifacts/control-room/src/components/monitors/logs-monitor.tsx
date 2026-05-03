import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api, asArray } from "@/lib/api";

interface LogEntry {
  id: string;
  ts?: string;
  createdAt?: string;
  level?: string;
  eventType?: string;
  message?: string;
  summary?: string;
  source?: string | null;
  scope?: string;
}

function levelClass(level?: string): string {
  switch ((level ?? "").toLowerCase()) {
    case "error":
    case "fatal":
    case "memory_rejected":
    case "task_failed":
      return "text-red-400";
    case "warn":
    case "warning":
    case "absorb_retry":
      return "text-amber-400";
    case "info":
    case "task_completed":
    case "memory_accepted":
      return "text-emerald-400/80";
    case "debug":
      return "text-indigo-400/60";
    default:
      return "text-indigo-300/70";
  }
}

function formatTime(ts?: string): string {
  if (!ts) return "--:--:--";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts.slice(11, 19);
  return d.toTimeString().split(" ")[0];
}

export function LogsMonitor() {
  const q = useQuery({
    queryKey: ["logs"],
    queryFn: () => api<unknown>("/logs?limit=80"),
    refetchInterval: 3000,
  });
  const items = asArray<LogEntry>(q.data, "logs");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  return (
    <div
      ref={scrollRef}
      className="absolute inset-0 p-2 qs-font-mono text-[10px] qs-scrollbar overflow-y-auto flex flex-col space-y-1"
    >
      {q.isLoading && (
        <div className="text-indigo-500">› connecting to log shipper…</div>
      )}
      {q.isError && (
        <div className="text-red-400">› log stream offline</div>
      )}
      {!q.isLoading && items.length === 0 && (
        <div className="text-indigo-500">› buffer empty</div>
      )}
      {items.map((entry) => {
        const tone = levelClass(entry.level ?? entry.eventType);
        const text = entry.message ?? entry.summary ?? entry.eventType ?? "";
        return (
          <div key={entry.id} className={tone}>
            <span className="text-indigo-600">
              {formatTime(entry.ts ?? entry.createdAt)}
            </span>{" "}
            <span className="text-indigo-500">
              {entry.source ?? entry.scope ?? entry.eventType ?? "sys"}:
            </span>{" "}
            <span>{text}</span>
          </div>
        );
      })}
    </div>
  );
}
