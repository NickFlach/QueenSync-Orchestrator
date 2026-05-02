import {
  useListLogs,
  LogEntry,
  getListLogsQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Terminal, ShieldAlert, User, Globe } from "lucide-react";

export default function ExecutionLog() {
  const { data: logs, isLoading } = useListLogs({
    query: { refetchInterval: 3000, queryKey: getListLogsQueryKey() },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-12 w-64 bg-card" />
        <Skeleton className="h-64 w-full bg-card" />
      </div>
    );
  }

  return (
    <div className="p-6 h-full flex flex-col max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-primary uppercase drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]">
          Execution Log
        </h1>
      </div>

      <div className="flex-1 bg-card border border-border/50 rounded-lg overflow-hidden flex flex-col font-mono text-sm">
        <div className="bg-background px-4 py-2 border-b border-border/50 text-muted-foreground text-xs uppercase flex items-center gap-2">
          <Terminal className="w-4 h-4" /> System Stream Active · audit trail
        </div>
        <div className="p-4 overflow-y-auto flex-1 space-y-1">
          {logs?.map((log: LogEntry) => {
            const meta = (log.metadata ?? {}) as Record<string, unknown>;
            const actor = typeof meta.actor === "string" ? meta.actor : null;
            const ip = typeof meta.ip === "string" ? meta.ip : null;
            const trigger =
              typeof meta.trigger === "string" ? meta.trigger : null;
            const isRateLimited = log.eventType === "rate_limited";
            const isRejected = log.eventType === "callback_rejected";
            return (
              <div
                key={log.id}
                className={`hover:bg-white/5 px-2 py-1 rounded ${
                  isRateLimited
                    ? "border-l-2 border-amber-500/70"
                    : isRejected
                      ? "border-l-2 border-destructive/70"
                      : ""
                }`}
                data-testid={`log-row-${log.id}`}
              >
                <div className="flex gap-4">
                  <span className="text-muted-foreground shrink-0 w-20">
                    {new Date(log.createdAt).toLocaleTimeString([], {
                      hour12: false,
                    })}
                  </span>
                  <span
                    className={`shrink-0 w-32 truncate flex items-center gap-1 ${
                      isRateLimited
                        ? "text-amber-400"
                        : isRejected
                          ? "text-destructive"
                          : "text-primary/70"
                    }`}
                    title={log.eventType}
                  >
                    {(isRateLimited || isRejected) && (
                      <ShieldAlert className="w-3 h-3 shrink-0" />
                    )}
                    {log.eventType}
                  </span>
                  <span className="text-foreground flex-1 min-w-0 break-words">
                    {log.summary}
                  </span>
                  {log.source && (
                    <span className="text-muted-foreground/50 shrink-0">
                      [{log.source}]
                    </span>
                  )}
                </div>
                {(actor || ip || trigger) && (
                  <div className="flex gap-3 mt-0.5 ml-24 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                    {actor && (
                      <span
                        className="flex items-center gap-1"
                        data-testid={`log-actor-${log.id}`}
                      >
                        <User className="w-2.5 h-2.5" /> {actor}
                      </span>
                    )}
                    {ip && (
                      <span
                        className="flex items-center gap-1"
                        data-testid={`log-ip-${log.id}`}
                      >
                        <Globe className="w-2.5 h-2.5" /> {ip}
                      </span>
                    )}
                    {trigger && (
                      <span
                        className="text-muted-foreground/60"
                        data-testid={`log-trigger-${log.id}`}
                      >
                        → {trigger}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {logs?.length === 0 && (
            <div className="text-muted-foreground text-center py-8">
              No log entries found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
