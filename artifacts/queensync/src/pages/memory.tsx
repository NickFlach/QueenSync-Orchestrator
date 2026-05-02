import { useMemo, useState } from "react";
import {
  useListMemory,
  MemoryEvent,
  getListMemoryQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BrainCircuit, Layers, Trash2 } from "lucide-react";

function MemoryRow({ event }: { event: MemoryEvent }) {
  const isCompression = event.type === "dream_lite_compression";
  const decision = event.decision;
  return (
    <Card
      data-decision={decision}
      data-compacted={event.compacted ? "true" : "false"}
      data-compression={isCompression ? "true" : "false"}
      className={`bg-card border-border/50 rounded-none border-l-2 ${
        decision === "approved"
          ? "border-l-primary"
          : decision === "rejected"
          ? "border-l-destructive"
          : "border-l-muted"
      } ${event.compacted ? "opacity-60" : ""} ${
        isCompression ? "bg-primary/5 border-l-4 border-l-primary" : ""
      }`}
    >
      <CardContent className="p-4 flex gap-4 items-start">
        <div className="flex flex-col items-center justify-center p-3 bg-background border border-border/50 rounded w-16 shrink-0">
          <span className="text-xs text-muted-foreground font-mono mb-1">
            IMP
          </span>
          <span className="text-lg font-bold text-primary">
            {(event.importance * 100).toFixed(0)}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between mb-1 flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              {isCompression && (
                <Layers className="w-4 h-4 text-primary" />
              )}
              <span className="text-sm font-bold text-foreground">
                {event.tag}
              </span>
              <Badge
                variant="outline"
                className="text-[10px] uppercase text-muted-foreground"
              >
                {event.type}
              </Badge>
              {event.tags?.slice(0, 6).map((t) => (
                <Badge
                  key={t}
                  variant="outline"
                  className="text-[10px] text-primary/80 border-primary/20"
                >
                  #{t}
                </Badge>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {event.compacted && (
                <Badge
                  variant="outline"
                  className="text-[10px] uppercase text-muted-foreground border-muted/30"
                >
                  compacted
                </Badge>
              )}
              <Badge
                variant="outline"
                className={`text-[10px] uppercase ${
                  decision === "approved"
                    ? "text-primary border-primary/30"
                    : decision === "rejected"
                    ? "text-destructive border-destructive/30"
                    : "text-muted-foreground"
                }`}
              >
                {decision}
              </Badge>
            </div>
          </div>
          {event.summary && (
            <p className="text-xs text-foreground/90 italic mb-1">
              {event.summary}
            </p>
          )}
          <p className="text-sm text-foreground/80 line-clamp-3">
            {event.content}
          </p>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground font-mono">
            {event.sourceAttribution && (
              <span>src: {event.sourceAttribution}</span>
            )}
            {event.reason && (
              <span className="text-destructive/80">reason: {event.reason}</span>
            )}
            {event.compactedIntoId && (
              <span>→ {event.compactedIntoId}</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MemoryGate() {
  const [includeCompacted, setIncludeCompacted] = useState(false);
  const [includeRejected, setIncludeRejected] = useState(false);

  const { data: memory, isLoading } = useListMemory(
    { includeCompacted, includeRejected },
    {
      query: {
        refetchInterval: 5000,
        queryKey: getListMemoryQueryKey({ includeCompacted, includeRejected }),
      },
    },
  );

  const grouped = useMemo(() => {
    if (!memory) return [] as Array<{ parent: MemoryEvent; children: MemoryEvent[] }>;
    const byId = new Map<string, MemoryEvent>(memory.map((m) => [m.id, m]));
    const childrenByParent = new Map<string, MemoryEvent[]>();
    const orphans: MemoryEvent[] = [];
    for (const m of memory) {
      if (m.compactedIntoId && byId.has(m.compactedIntoId)) {
        const arr = childrenByParent.get(m.compactedIntoId) ?? [];
        arr.push(m);
        childrenByParent.set(m.compactedIntoId, arr);
      } else {
        orphans.push(m);
      }
    }
    return orphans.map((parent) => ({
      parent,
      children: childrenByParent.get(parent.id) ?? [],
    }));
  }, [memory]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-12 w-64 bg-card" />
        <Skeleton className="h-24 w-full bg-card" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary uppercase drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]">
            Memory Gate
          </h1>
          <p className="text-xs text-muted-foreground uppercase tracking-widest mt-1">
            governance v1.0 · Dream Lite compression + audit trail
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={includeCompacted ? "default" : "outline"}
            onClick={() => setIncludeCompacted((v) => !v)}
            data-testid="toggle-compacted"
          >
            <Layers className="w-3 h-3 mr-1" />
            {includeCompacted ? "Hide compacted" : "Show compacted"}
          </Button>
          <Button
            size="sm"
            variant={includeRejected ? "destructive" : "outline"}
            onClick={() => setIncludeRejected((v) => !v)}
            data-testid="toggle-rejected"
          >
            <Trash2 className="w-3 h-3 mr-1" />
            {includeRejected ? "Hide rejected" : "Show rejected"}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {grouped.map(({ parent, children }) => (
          <div key={parent.id} className="space-y-2">
            <MemoryRow event={parent} />
            {children.length > 0 && (
              <div className="ml-8 pl-4 border-l border-primary/20 space-y-2">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  compacted into above ({children.length})
                </p>
                {children.map((c) => (
                  <MemoryRow key={c.id} event={c} />
                ))}
              </div>
            )}
          </div>
        ))}
        {grouped.length === 0 && (
          <div className="text-center p-12 border border-dashed border-border/50">
            <BrainCircuit className="w-8 h-8 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">Memory bank is empty.</p>
          </div>
        )}
      </div>
    </div>
  );
}
