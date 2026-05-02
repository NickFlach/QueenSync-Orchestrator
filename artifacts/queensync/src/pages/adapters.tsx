import {
  useRadioAdapterHealth,
  useObservatoryAdapterHealth,
  useRadioAdapterPull,
  useObservatoryAdapterPull,
  getRadioAdapterHealthQueryKey,
  getObservatoryAdapterHealthQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Activity, Radio, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function Adapters() {
  const { data: radioHealth } = useRadioAdapterHealth({
    query: {
      refetchInterval: 10000,
      queryKey: getRadioAdapterHealthQueryKey(),
    },
  });
  const { data: obsHealth } = useObservatoryAdapterHealth({
    query: {
      refetchInterval: 10000,
      queryKey: getObservatoryAdapterHealthQueryKey(),
    },
  });
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const pullRadio = useRadioAdapterPull({
    mutation: {
      onSuccess: (res) => {
        toast({ title: "Radio Pulled", description: `Pulled ${res.pulled} items in ${res.mode} mode.` });
        queryClient.invalidateQueries({ queryKey: getRadioAdapterHealthQueryKey() });
      }
    }
  });

  const pullObs = useObservatoryAdapterPull({
    mutation: {
      onSuccess: (res) => {
        toast({ title: "Observatory Pulled", description: `Pulled ${res.pulled} items in ${res.mode} mode.` });
        queryClient.invalidateQueries({ queryKey: getObservatoryAdapterHealthQueryKey() });
      }
    }
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold tracking-tight text-primary uppercase drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]">Adapter Health</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2 text-foreground"><Radio className="w-5 h-5 text-primary"/> Radio Adapter</CardTitle>
            <div className={`w-3 h-3 rounded-full ${radioHealth?.ok ? 'bg-primary shadow-[0_0_8px_rgba(0,255,255,0.8)]' : 'bg-destructive shadow-[0_0_8px_rgba(255,0,0,0.8)]'}`} />
          </CardHeader>
          <CardContent className="space-y-4 font-mono text-sm">
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Status</span>
              <span className="text-foreground">{radioHealth?.message || 'Unknown'}</span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Mode</span>
              <span className="text-primary">{radioHealth?.mode || 'Unknown'}</span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Latency</span>
              <span className="text-foreground">{radioHealth?.latencyMs ? `${radioHealth.latencyMs}ms` : '-'}</span>
            </div>
            <Button className="w-full mt-4 border-primary/50 text-primary hover:bg-primary/10" variant="outline" onClick={() => pullRadio.mutate()} disabled={pullRadio.isPending}>
              <RefreshCw className="w-4 h-4 mr-2" /> Manual Pull
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2 text-foreground"><Activity className="w-5 h-5 text-primary"/> Observatory Adapter</CardTitle>
            <div className={`w-3 h-3 rounded-full ${obsHealth?.ok ? 'bg-primary shadow-[0_0_8px_rgba(0,255,255,0.8)]' : 'bg-destructive shadow-[0_0_8px_rgba(255,0,0,0.8)]'}`} />
          </CardHeader>
          <CardContent className="space-y-4 font-mono text-sm">
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Status</span>
              <span className="text-foreground">{obsHealth?.message || 'Unknown'}</span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Mode</span>
              <span className="text-primary">{obsHealth?.mode || 'Unknown'}</span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Latency</span>
              <span className="text-foreground">{obsHealth?.latencyMs ? `${obsHealth.latencyMs}ms` : '-'}</span>
            </div>
            <Button className="w-full mt-4 border-primary/50 text-primary hover:bg-primary/10" variant="outline" onClick={() => pullObs.mutate()} disabled={pullObs.isPending}>
              <RefreshCw className="w-4 h-4 mr-2" /> Manual Pull
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}