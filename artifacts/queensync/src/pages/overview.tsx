import {
  useGetSystemSummary,
  useListActiveResonance,
  useWakeKannaktopus,
  useCompressMemoryDreamLite,
  useResonanceStorm,
  getGetSystemSummaryQueryKey,
  getListActiveResonanceQueryKey,
  getListArmsQueryKey,
  getListTasksQueryKey,
  getListSignalsQueryKey,
  getListResonanceQueryKey,
  getListLogsQueryKey,
  getListMemoryQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Activity,
  Radio,
  Cpu,
  AlertTriangle,
  Zap,
  Brain,
  ActivitySquare,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function Overview() {
  const { data: summary, isLoading } = useGetSystemSummary({
    query: {
      refetchInterval: 8000,
      queryKey: getGetSystemSummaryQueryKey(),
    },
  });
  const { data: activeResonance } = useListActiveResonance({
    query: {
      refetchInterval: 8000,
      queryKey: getListActiveResonanceQueryKey(),
    },
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetSystemSummaryQueryKey() });
    queryClient.invalidateQueries({
      queryKey: getListActiveResonanceQueryKey(),
    });
    queryClient.invalidateQueries({ queryKey: getListArmsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListSignalsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListResonanceQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListLogsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListMemoryQueryKey() });
  };

  const wakeMutation = useWakeKannaktopus({
    mutation: {
      onSuccess: (r) => {
        toast({
          title: "Kannaktopus Waking",
          description: r.message,
        });
        invalidate();
      },
    },
  });
  const dreamMutation = useCompressMemoryDreamLite({
    mutation: {
      onSuccess: (r) => {
        toast({
          title: "Dream Lite",
          description: r.message,
        });
        invalidate();
      },
    },
  });
  const stormMutation = useResonanceStorm({
    mutation: {
      onSuccess: (r) => {
        toast({ title: "Resonance Storm", description: r.message });
        invalidate();
      },
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-32 w-full bg-card" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-32 bg-card" />
          <Skeleton className="h-32 bg-card" />
          <Skeleton className="h-32 bg-card" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary uppercase drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]">
            Console Overview
          </h1>
          <p className="text-xs text-muted-foreground uppercase tracking-widest mt-1">
            Kannaka Control Plane · live status
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            onClick={() => wakeMutation.mutate()}
            disabled={wakeMutation.isPending}
            variant="outline"
            className="border-primary/50 hover:bg-primary/20 text-primary"
            data-testid="button-wake-kannaktopus"
          >
            <Zap className="w-4 h-4 mr-2" /> Wake Kannaktopus
          </Button>
          <Button
            onClick={() => dreamMutation.mutate({ data: {} })}
            disabled={dreamMutation.isPending}
            variant="outline"
            className="border-primary/50 hover:bg-primary/20 text-primary"
            data-testid="button-dream-lite"
          >
            <Brain className="w-4 h-4 mr-2" /> Dream Lite
          </Button>
          <Button
            onClick={() => stormMutation.mutate()}
            disabled={stormMutation.isPending}
            variant="destructive"
            className="bg-destructive/20 text-destructive border border-destructive hover:bg-destructive/40"
            data-testid="button-resonance-storm"
          >
            <ActivitySquare className="w-4 h-4 mr-2" /> Resonance Storm
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Active Arms"
          value={`${summary?.activeArms || 0} / ${summary?.totalArms || 0}`}
          icon={Cpu}
        />
        <MetricCard
          title="Queued Tasks"
          value={summary?.queuedTasks || 0}
          icon={Activity}
        />
        <MetricCard
          title="Recent Signals"
          value={summary?.recentSignals || 0}
          icon={Radio}
        />
        <MetricCard
          title="Failed Tasks"
          value={summary?.failedTasks || 0}
          icon={AlertTriangle}
          isError={(summary?.failedTasks || 0) > 0}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center justify-between">
              <span>Active Resonance Fields</span>
              <span className="text-primary text-xs font-mono">
                {activeResonance?.length || 0}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activeResonance?.length ? (
              <div className="space-y-3">
                {activeResonance.slice(0, 6).map((res) => (
                  <div
                    key={res.id}
                    className="p-3 bg-background rounded-md border border-border/50"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm text-foreground line-clamp-1">
                        {res.intent}
                      </span>
                      <span className="text-xs text-primary/70 font-mono shrink-0 ml-2">
                        {res.responses.length} resp
                      </span>
                    </div>
                    {res.responses.length > 0 && (
                      <div className="mt-2 h-1 w-full bg-muted rounded">
                        <div
                          className="h-1 bg-primary rounded shadow-[0_0_8px_rgba(0,255,255,0.6)]"
                          style={{
                            width: `${Math.min(100, res.responses.length * 25)}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No active resonance fields. Try the Resonance Storm.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Adapter Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <AdapterRow
                name="Radio · Signal Keeper"
                status={summary?.radioStatus || "unknown"}
              />
              <AdapterRow
                name="Observatory · Auditor"
                status={summary?.observatoryStatus || "unknown"}
              />
              <NatsRow nats={summary?.nats} />
              <div className="grid grid-cols-2 gap-3 mt-4 text-xs font-mono">
                <div className="p-2 bg-background border border-border/50 rounded">
                  <div className="text-muted-foreground uppercase text-[10px]">
                    completed
                  </div>
                  <div className="text-primary text-lg font-bold">
                    {summary?.completedTasks || 0}
                  </div>
                </div>
                <div className="p-2 bg-background border border-border/50 rounded">
                  <div className="text-muted-foreground uppercase text-[10px]">
                    memory approvals
                  </div>
                  <div className="text-primary text-lg font-bold">
                    {summary?.memoryApprovals || 0}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  icon: Icon,
  isError = false,
}: {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  isError?: boolean;
}) {
  return (
    <Card className="bg-card border-border/50 overflow-hidden relative group">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {title}
        </CardTitle>
        <Icon
          className={`w-4 h-4 ${isError ? "text-destructive drop-shadow-[0_0_5px_rgba(255,0,0,0.8)]" : "text-primary drop-shadow-[0_0_5px_rgba(0,255,255,0.8)]"}`}
        />
      </CardHeader>
      <CardContent>
        <div
          className={`text-2xl font-bold ${isError ? "text-destructive" : "text-foreground"}`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function AdapterRow({ name, status }: { name: string; status: string }) {
  const ok = status === "live" || status === "mock";
  return (
    <div className="flex items-center justify-between p-3 bg-background rounded-md border border-border/50">
      <span className="font-medium text-sm text-foreground">{name}</span>
      <span
        className={`text-xs uppercase font-mono ${ok ? "text-primary" : "text-destructive"}`}
      >
        {status}
      </span>
    </div>
  );
}

interface NatsStatusShape {
  state: string;
  mode: string;
  url?: string | null;
  lastError?: string | null;
  lastConnectedAt?: string | null;
  subscribedSubjects?: string[];
}

function NatsRow({ nats }: { nats?: NatsStatusShape | null }) {
  const state = nats?.state ?? "unknown";
  const mode = nats?.mode ?? "mock";
  const url = nats?.url ?? null;
  const lastErr = nats?.lastError ?? null;
  const lastConn = nats?.lastConnectedAt ?? null;
  const subs = nats?.subscribedSubjects ?? [];
  const stateColor =
    state === "connected"
      ? "text-primary border-primary/40"
      : state === "connecting" || state === "reconnecting"
        ? "text-yellow-500 border-yellow-500/40"
        : state === "disabled"
          ? "text-muted-foreground border-border"
          : "text-destructive border-destructive/40";
  return (
    <div className="p-3 bg-background rounded-md border border-border/50 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm text-foreground">
          NATS · Constellation Bus
        </span>
        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] uppercase font-mono px-1.5 py-0.5 border rounded ${stateColor}`}
            data-testid="badge-nats-state"
          >
            {state}
          </span>
          <span
            className={`text-[10px] uppercase font-mono px-1.5 py-0.5 border rounded ${mode === "live" ? "text-primary border-primary/40" : "text-muted-foreground border-border"}`}
          >
            {mode}
          </span>
        </div>
      </div>
      <div className="text-[10px] font-mono text-muted-foreground space-y-0.5">
        {url && <div className="break-all">url: {url}</div>}
        {lastConn && (
          <div>last connected: {new Date(lastConn).toLocaleTimeString()}</div>
        )}
        {lastErr && (
          <div className="text-destructive break-all">last error: {lastErr}</div>
        )}
        {subs.length > 0 && (
          <div className="break-all">
            subscribed: {subs.length} subject{subs.length === 1 ? "" : "s"}
          </div>
        )}
      </div>
    </div>
  );
}
