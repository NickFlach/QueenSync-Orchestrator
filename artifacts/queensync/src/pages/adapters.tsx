import {
  useRadioAdapterHealth,
  useObservatoryAdapterHealth,
  useRadioAdapterPull,
  useObservatoryAdapterPull,
  getRadioAdapterHealthQueryKey,
  getObservatoryAdapterHealthQueryKey,
  AdapterHealth,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, Radio, RefreshCw, AlertTriangle, EyeOff, FlaskConical } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

function ModeBadges({ health }: { health: AdapterHealth | undefined }) {
  if (!health) return null;
  return (
    <div className="flex flex-wrap gap-2 pt-2">
      <Badge
        variant="outline"
        className={
          health.mode === "live"
            ? "border-primary/60 text-primary"
            : health.mode === "stale"
              ? "border-amber-500/60 text-amber-500"
              : health.mode === "forced_mock"
                ? "border-fuchsia-500/60 text-fuchsia-400"
                : "border-muted-foreground/40 text-muted-foreground"
        }
        data-testid={`badge-mode-${health.name}`}
      >
        {health.mode}
      </Badge>
      {health.stale && (
        <Badge
          variant="outline"
          className="border-amber-500/60 text-amber-500 flex items-center gap-1"
          data-testid={`badge-stale-${health.name}`}
        >
          <AlertTriangle className="w-3 h-3" /> stale
        </Badge>
      )}
      {health.metricsSuppressed && (
        <Badge
          variant="outline"
          className="border-orange-500/60 text-orange-500 flex items-center gap-1"
          data-testid={`badge-suppressed-${health.name}`}
        >
          <EyeOff className="w-3 h-3" /> metrics suppressed
        </Badge>
      )}
      {health.forceMock && (
        <Badge
          variant="outline"
          className="border-fuchsia-500/60 text-fuchsia-400 flex items-center gap-1"
          data-testid={`badge-forced-mock-${health.name}`}
        >
          <FlaskConical className="w-3 h-3" /> QUEENSYNC_FORCE_MOCK
        </Badge>
      )}
    </div>
  );
}

export default function Adapters() {
  const { data: radioHealth } = useRadioAdapterHealth({
    query: {
      refetchInterval: 30000,
      queryKey: getRadioAdapterHealthQueryKey(),
    },
  });
  const { data: obsHealth } = useObservatoryAdapterHealth({
    query: {
      refetchInterval: 30000,
      queryKey: getObservatoryAdapterHealthQueryKey(),
    },
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const pullRadio = useRadioAdapterPull({
    mutation: {
      onSuccess: (res) => {
        toast({
          title: "Radio Pulled",
          description: `Pulled ${res.pulled} items in ${res.mode} mode${res.stale ? " (stale cache)" : ""}.`,
        });
        queryClient.invalidateQueries({ queryKey: getRadioAdapterHealthQueryKey() });
      },
    },
  });

  const pullObs = useObservatoryAdapterPull({
    mutation: {
      onSuccess: (res) => {
        toast({
          title: "Observatory Pulled",
          description: `Pulled ${res.pulled} items in ${res.mode} mode${res.stale ? " (stale cache)" : ""}${res.metricsSuppressed ? " — metrics suppressed" : ""}.`,
        });
        queryClient.invalidateQueries({ queryKey: getObservatoryAdapterHealthQueryKey() });
      },
    },
  });

  const dotClass = (h: AdapterHealth | undefined) => {
    if (!h) return "bg-muted";
    if (h.mode === "live") return "bg-primary shadow-[0_0_8px_rgba(0,255,255,0.8)]";
    if (h.mode === "stale") return "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]";
    if (h.mode === "forced_mock") return "bg-fuchsia-500 shadow-[0_0_8px_rgba(217,70,239,0.8)]";
    return "bg-destructive shadow-[0_0_8px_rgba(255,0,0,0.8)]";
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold tracking-tight text-primary uppercase drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]">Adapter Health</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2 text-foreground"><Radio className="w-5 h-5 text-primary"/> Radio Adapter</CardTitle>
            <div className={`w-3 h-3 rounded-full ${dotClass(radioHealth)}`} />
          </CardHeader>
          <CardContent className="space-y-4 font-mono text-sm">
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Status</span>
              <span className="text-foreground text-right max-w-[60%] truncate" title={radioHealth?.message}>{radioHealth?.message || 'Unknown'}</span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Base URL</span>
              <span className="text-foreground text-xs truncate max-w-[60%]" title={radioHealth?.baseUrl}>{radioHealth?.baseUrl}</span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Latency</span>
              <span className="text-foreground">{radioHealth?.latencyMs ? `${radioHealth.latencyMs}ms` : '-'}</span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Last live</span>
              <span className="text-foreground text-xs">{radioHealth?.lastSuccessAt ? new Date(radioHealth.lastSuccessAt).toLocaleString() : '—'}</span>
            </div>
            <ModeBadges health={radioHealth} />
            <Button className="w-full mt-4 border-primary/50 text-primary hover:bg-primary/10" variant="outline" onClick={() => pullRadio.mutate()} disabled={pullRadio.isPending} data-testid="button-pull-radio">
              <RefreshCw className="w-4 h-4 mr-2" /> Manual Pull
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2 text-foreground"><Activity className="w-5 h-5 text-primary"/> Observatory Adapter</CardTitle>
            <div className={`w-3 h-3 rounded-full ${dotClass(obsHealth)}`} />
          </CardHeader>
          <CardContent className="space-y-4 font-mono text-sm">
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Status</span>
              <span className="text-foreground text-right max-w-[60%] truncate" title={obsHealth?.message}>{obsHealth?.message || 'Unknown'}</span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Base URL</span>
              <span className="text-foreground text-xs truncate max-w-[60%]" title={obsHealth?.baseUrl}>{obsHealth?.baseUrl}</span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Latency</span>
              <span className="text-foreground">{obsHealth?.latencyMs ? `${obsHealth.latencyMs}ms` : '-'}</span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Last live</span>
              <span className="text-foreground text-xs">{obsHealth?.lastSuccessAt ? new Date(obsHealth.lastSuccessAt).toLocaleString() : '—'}</span>
            </div>
            <ModeBadges health={obsHealth} />
            <Button className="w-full mt-4 border-primary/50 text-primary hover:bg-primary/10" variant="outline" onClick={() => pullObs.mutate()} disabled={pullObs.isPending} data-testid="button-pull-observatory">
              <RefreshCw className="w-4 h-4 mr-2" /> Manual Pull
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
