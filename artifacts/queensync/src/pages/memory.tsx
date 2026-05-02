import { useListMemory, MemoryEvent } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BrainCircuit } from "lucide-react";

export default function MemoryGate() {
  const { data: memory, isLoading } = useListMemory({ query: { refetchInterval: 5000, queryKey: undefined as never } });

  if (isLoading) {
    return <div className="p-6 space-y-4"><Skeleton className="h-12 w-64 bg-card" /><Skeleton className="h-24 w-full bg-card" /></div>;
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-primary uppercase drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]">Memory Gate</h1>
      </div>

      <div className="space-y-3">
        {memory?.map((event: MemoryEvent) => (
          <Card key={event.id} className="bg-card border-border/50 rounded-none border-l-2 data-[decision=approved]:border-l-primary data-[decision=rejected]:border-l-destructive" data-decision={event.decision}>
            <CardContent className="p-4 flex gap-4 items-start">
              <div className="flex flex-col items-center justify-center p-3 bg-background border border-border/50 rounded w-16 shrink-0">
                <span className="text-xs text-muted-foreground font-mono mb-1">IMP</span>
                <span className="text-lg font-bold text-primary">{(event.importance * 100).toFixed(0)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-foreground">{event.tag}</span>
                    <Badge variant="outline" className="text-[10px] uppercase text-muted-foreground">{event.type}</Badge>
                  </div>
                  <Badge variant="outline" className={`text-[10px] uppercase ${event.decision === 'approved' ? 'text-primary border-primary/30' : event.decision === 'rejected' ? 'text-destructive border-destructive/30' : 'text-muted-foreground'}`}>{event.decision}</Badge>
                </div>
                <p className="text-sm text-foreground/80 line-clamp-2">{event.content}</p>
              </div>
            </CardContent>
          </Card>
        ))}
        {memory?.length === 0 && (
          <div className="text-center p-12 border border-dashed border-border/50">
            <BrainCircuit className="w-8 h-8 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">Memory bank is empty.</p>
          </div>
        )}
      </div>
    </div>
  );
}