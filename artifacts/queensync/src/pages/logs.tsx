import { useListLogs, LogEntry } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Terminal } from "lucide-react";

export default function ExecutionLog() {
  const { data: logs, isLoading } = useListLogs({ query: { refetchInterval: 3000, queryKey: undefined as never } });

  if (isLoading) {
    return <div className="p-6 space-y-4"><Skeleton className="h-12 w-64 bg-card" /><Skeleton className="h-64 w-full bg-card" /></div>;
  }

  return (
    <div className="p-6 h-full flex flex-col max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-primary uppercase drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]">Execution Log</h1>
      </div>

      <div className="flex-1 bg-card border border-border/50 rounded-lg overflow-hidden flex flex-col font-mono text-sm">
        <div className="bg-background px-4 py-2 border-b border-border/50 text-muted-foreground text-xs uppercase flex items-center gap-2">
          <Terminal className="w-4 h-4" /> System Stream Active
        </div>
        <div className="p-4 overflow-y-auto flex-1 space-y-1">
          {logs?.map((log: LogEntry) => (
            <div key={log.id} className="flex gap-4 hover:bg-white/5 px-2 py-1 rounded">
              <span className="text-muted-foreground shrink-0 w-20">{new Date(log.createdAt).toLocaleTimeString([], { hour12: false })}</span>
              <span className="text-primary/70 shrink-0 w-32 truncate" title={log.eventType}>{log.eventType}</span>
              <span className="text-foreground">{log.summary}</span>
              {log.source && <span className="text-muted-foreground/50 ml-auto">[{log.source}]</span>}
            </div>
          ))}
          {logs?.length === 0 && (
            <div className="text-muted-foreground text-center py-8">No log entries found.</div>
          )}
        </div>
      </div>
    </div>
  );
}