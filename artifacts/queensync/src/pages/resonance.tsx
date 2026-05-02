import { useListResonance, Resonance } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AudioWaveform } from "lucide-react";

export default function ResonanceFields() {
  const { data: resonance, isLoading } = useListResonance({ query: { refetchInterval: 5000, queryKey: undefined as never } });

  if (isLoading) {
    return <div className="p-6 space-y-4"><Skeleton className="h-12 w-64 bg-card" /><Skeleton className="h-32 w-full bg-card" /></div>;
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-primary uppercase drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]">Resonance Fields</h1>
      </div>

      <div className="grid gap-4">
        {resonance?.map((res: Resonance) => (
          <Card key={res.id} className="bg-card border-border/50">
            <CardContent className="p-5">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-medium text-foreground">{res.intent}</h3>
                  <div className="flex gap-2 mt-2">
                    {res.tags.map(tag => (
                      <Badge key={tag} variant="secondary" className="text-[10px] bg-primary/10 text-primary">{tag}</Badge>
                    ))}
                  </div>
                </div>
                <Badge variant="outline" className={`text-[10px] uppercase ${res.status === 'active' ? 'text-primary border-primary/30' : 'text-muted-foreground'}`}>{res.status}</Badge>
              </div>
              
              {res.responses && res.responses.length > 0 && (
                <div className="mt-4 border-t border-border/50 pt-4">
                  <h4 className="text-xs font-mono text-muted-foreground uppercase mb-3">Responses ({res.responses.length})</h4>
                  <div className="space-y-2">
                    {res.responses.map(resp => (
                      <div key={resp.id} className="bg-background rounded border border-border/50 p-3 text-sm">
                        <div className="flex justify-between items-center mb-2 font-mono text-[10px] text-muted-foreground">
                          <span>{resp.agentName || resp.agentId}</span>
                          <span className="text-primary">Score: {resp.score.toFixed(2)}</span>
                        </div>
                        <p className="text-foreground/80">{resp.output}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {resonance?.length === 0 && (
          <div className="text-center p-12 border border-dashed border-border/50">
            <AudioWaveform className="w-8 h-8 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No resonance fields collapsed.</p>
          </div>
        )}
      </div>
    </div>
  );
}