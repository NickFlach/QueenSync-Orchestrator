import { useListSignals, Signal } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Radio } from "lucide-react";

export default function SignalsIngestion() {
  const { data: signals, isLoading } = useListSignals({ query: { refetchInterval: 4000, queryKey: undefined as never } });

  if (isLoading) {
    return <div className="p-6 space-y-4"><Skeleton className="h-12 w-64 bg-card" /><Skeleton className="h-24 w-full bg-card" /></div>;
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-primary uppercase drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]">Signal Ingestion</h1>
      </div>

      <div className="space-y-3">
        {signals?.map((signal: Signal) => (
          <Card key={signal.id} className="bg-card border-border/50 font-mono">
            <CardContent className="p-4">
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] text-primary border-primary/30 uppercase">{signal.type}</Badge>
                  <span className="text-[10px] text-muted-foreground">{new Date(signal.createdAt).toLocaleString()}</span>
                </div>
                <Badge variant="outline" className="text-[10px] uppercase text-muted-foreground">{signal.status}</Badge>
              </div>
              <div className="bg-background rounded p-2 text-xs text-foreground/80 overflow-x-auto">
                <pre>{JSON.stringify(signal.payload, null, 2)}</pre>
              </div>
              {signal.derivedTaskId && <div className="text-[10px] text-primary/70 mt-2">Derived Task: {signal.derivedTaskId}</div>}
            </CardContent>
          </Card>
        ))}
        {signals?.length === 0 && (
          <div className="text-center p-12 border border-dashed border-border/50">
            <Radio className="w-8 h-8 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No signals received.</p>
          </div>
        )}
      </div>
    </div>
  );
}