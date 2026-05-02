import { useGetSystemSummary, useListActiveResonance, useWakeKannaktopus, useDreamLiteCompression, useResonanceStorm, getGetSystemSummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Activity, Radio, Cpu, CheckCircle2, AlertTriangle, Zap, Brain, ActivitySquare } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function Overview() {
  const { data: summary, isLoading } = useGetSystemSummary({ query: { refetchInterval: 4000, queryKey: undefined as never } });
  const { data: activeResonance } = useListActiveResonance({ query: { refetchInterval: 4000, queryKey: undefined as never } });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const wakeMutation = useWakeKannaktopus({
    mutation: {
      onSuccess: () => {
        toast({ title: "Kannaktopus Waking", description: "Signal broadcast to Kannaktopus arm." });
        queryClient.invalidateQueries({ queryKey: getGetSystemSummaryQueryKey() });
      }
    }
  });

  const dreamMutation = useDreamLiteCompression({
    mutation: {
      onSuccess: () => {
        toast({ title: "Dream Lite Initiated", description: "Memory compression started." });
      }
    }
  });

  const stormMutation = useResonanceStorm({
    mutation: {
      onSuccess: () => {
        toast({ title: "Resonance Storm", description: "Global resonance field collapsed." });
      }
    }
  });

  if (isLoading) {
    return <div className="p-6 space-y-4"><Skeleton className="h-32 w-full bg-card" /><div className="grid grid-cols-3 gap-4"><Skeleton className="h-32 bg-card" /><Skeleton className="h-32 bg-card" /><Skeleton className="h-32 bg-card" /></div></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-primary uppercase drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]">Console Overview</h1>
        <div className="flex items-center gap-3">
          <Button onClick={() => wakeMutation.mutate()} disabled={wakeMutation.isPending} variant="outline" className="border-primary/50 hover:bg-primary/20 text-primary">
            <Zap className="w-4 h-4 mr-2" /> Wake Kannaktopus
          </Button>
          <Button onClick={() => dreamMutation.mutate()} disabled={dreamMutation.isPending} variant="outline" className="border-primary/50 hover:bg-primary/20 text-primary">
            <Brain className="w-4 h-4 mr-2" /> Dream Lite
          </Button>
          <Button onClick={() => stormMutation.mutate()} disabled={stormMutation.isPending} variant="destructive" className="bg-destructive/20 text-destructive border-destructive hover:bg-destructive/40">
            <ActivitySquare className="w-4 h-4 mr-2" /> Resonance Storm
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Active Arms" value={`${summary?.activeArms || 0} / ${summary?.totalArms || 0}`} icon={Cpu} />
        <MetricCard title="Queued Tasks" value={summary?.queuedTasks || 0} icon={Activity} />
        <MetricCard title="Recent Signals" value={summary?.recentSignals || 0} icon={Radio} />
        <MetricCard title="Failed Tasks" value={summary?.failedTasks || 0} icon={AlertTriangle} isError={(summary?.failedTasks || 0) > 0} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Active Resonance Fields</CardTitle>
          </CardHeader>
          <CardContent>
            {activeResonance?.length ? (
              <div className="space-y-4">
                {activeResonance.map(res => (
                  <div key={res.id} className="flex items-center justify-between p-3 bg-background rounded-md border border-border/50">
                    <span className="font-medium text-sm text-foreground">{res.intent}</span>
                    <span className="text-xs text-primary/70">{res.responses.length} Responses</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">No active resonance fields.</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Adapter Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-background rounded-md border border-border/50">
                <span className="font-medium text-sm text-foreground">Radio Adapter</span>
                <span className="text-xs text-primary">{summary?.radioStatus || "Unknown"}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-background rounded-md border border-border/50">
                <span className="font-medium text-sm text-foreground">Observatory Adapter</span>
                <span className="text-xs text-primary">{summary?.observatoryStatus || "Unknown"}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ title, value, icon: Icon, isError = false }: { title: string, value: string | number, icon: any, isError?: boolean }) {
  return (
    <Card className="bg-card border-border/50 overflow-hidden relative group">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</CardTitle>
        <Icon className={`w-4 h-4 ${isError ? 'text-destructive drop-shadow-[0_0_5px_rgba(255,0,0,0.8)]' : 'text-primary drop-shadow-[0_0_5px_rgba(0,255,255,0.8)]'}`} />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${isError ? 'text-destructive' : 'text-foreground'}`}>{value}</div>
      </CardContent>
    </Card>
  );
}