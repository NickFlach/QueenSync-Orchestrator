import { useMemo } from "react";
import {
  useListPrivilegedDispatches,
  usePrivilegedDispatchRecentStats,
  useCreateTask,
  getListPrivilegedDispatchesQueryKey,
  getPrivilegedDispatchRecentStatsQueryKey,
  getListTasksQueryKey,
  PrivilegedDispatch,
  PrivilegedDispatchRequiredCapability,
  PrivilegedDispatchStatus,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShieldAlert,
  RotateCw,
  User,
  Globe,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  FilterBar,
  useFilterState,
  type FilterField,
} from "@/components/filter-bar";
import { useAuth } from "@/lib/auth";

const RECENT_STATS_PARAMS = { windowMs: 60 * 60 * 1000 };

const CAPABILITY_OPTIONS = Object.values(
  PrivilegedDispatchRequiredCapability,
).map((v) => ({ value: v, label: v }));

const STATUS_OPTIONS = Object.values(PrivilegedDispatchStatus).map((v) => ({
  value: v,
  label: v,
}));

export default function Operations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { session } = useAuth();
  const isOperator = session?.role === "operator";
  const { data: dispatches, isLoading } = useListPrivilegedDispatches({
    query: {
      refetchInterval: 15000,
      queryKey: getListPrivilegedDispatchesQueryKey(),
    },
  });
  const { data: serverStats } = usePrivilegedDispatchRecentStats(
    RECENT_STATS_PARAMS,
    {
      query: {
        refetchInterval: 15000,
        queryKey: getPrivilegedDispatchRecentStatsQueryKey(RECENT_STATS_PARAMS),
      },
    },
  );

  const all = (dispatches ?? []) as PrivilegedDispatch[];

  const filterFields: FilterField[] = useMemo(
    () => [
      {
        kind: "select",
        key: "capability",
        label: "Capability",
        placeholder: "All capabilities",
        options: CAPABILITY_OPTIONS,
      },
      {
        kind: "select",
        key: "status",
        label: "Status",
        placeholder: "All statuses",
        options: STATUS_OPTIONS,
      },
      {
        kind: "text",
        key: "q",
        label: "Search",
        placeholder: "search intent, actor, source…",
      },
    ],
    [],
  );
  const filter = useFilterState(filterFields);

  const visible = useMemo(() => {
    const q = filter.values.q?.trim().toLowerCase();
    return all.filter((d) => {
      if (
        filter.values.capability &&
        d.requiredCapability !== filter.values.capability
      )
        return false;
      if (filter.values.status && d.status !== filter.values.status)
        return false;
      if (q) {
        const hay =
          `${d.intent} ${d.requiredCapability} ${d.id} ${d.actor ?? ""} ${
            d.source ?? ""
          } ${d.result ?? ""} ${d.error ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [all, filter.values]);

  const recentStats = useMemo(() => {
    if (serverStats) {
      return {
        succeeded: serverStats.succeeded,
        failed: serverStats.failed,
        inFlight: serverStats.inFlight,
      };
    }
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    let succeeded = 0;
    let failed = 0;
    let inFlight = 0;
    for (const d of all) {
      const ts = new Date(d.createdAt).getTime();
      if (ts < oneHourAgo) continue;
      if (d.status === "completed") succeeded += 1;
      else if (d.status === "failed") failed += 1;
      else inFlight += 1;
    }
    return { succeeded, failed, inFlight };
  }, [all, serverStats]);

  const replayMutation = useCreateTask({
    mutation: {
      onSuccess: (task) => {
        toast({
          title: "Replay dispatched",
          description: `New task ${task.id.slice(0, 8)}… queued.`,
        });
        queryClient.invalidateQueries({
          queryKey: getListPrivilegedDispatchesQueryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: getPrivilegedDispatchRecentStatsQueryKey(
            RECENT_STATS_PARAMS,
          ),
        });
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      },
      onError: (err) => {
        toast({
          title: "Replay failed",
          description: (err as Error).message,
          variant: "destructive",
        });
      },
    },
  });

  function handleReplay(d: PrivilegedDispatch) {
    replayMutation.mutate({
      data: {
        intent: d.intent,
        requiredCapability: d.requiredCapability,
        priority: d.priority,
        source: `${d.source}:replay`,
        context:
          (d.context as Record<string, unknown> | undefined) ?? {},
      },
    });
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-12 w-64 bg-card" />
        <Skeleton className="h-32 w-full bg-card" />
        <Skeleton className="h-32 w-full bg-card" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <ShieldAlert className="w-6 h-6 text-primary drop-shadow-[0_0_6px_rgba(0,255,255,0.7)]" />
          <h1 className="text-2xl font-bold tracking-tight text-primary uppercase drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]">
            Privileged Operations
          </h1>
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-mono">
          <span className="text-muted-foreground">Last hour:</span>
          <Badge
            variant="outline"
            className="border-primary/30 text-primary bg-primary/5 gap-1"
            data-testid="badge-recent-succeeded"
          >
            <CheckCircle2 className="w-3 h-3" /> {recentStats.succeeded} ok
          </Badge>
          <Badge
            variant="outline"
            className="border-destructive/30 text-destructive bg-destructive/5 gap-1"
            data-testid="badge-recent-failed"
          >
            <XCircle className="w-3 h-3" /> {recentStats.failed} fail
          </Badge>
          {recentStats.inFlight > 0 && (
            <Badge
              variant="outline"
              className="border-yellow-500/30 text-yellow-400 bg-yellow-500/5 gap-1"
              data-testid="badge-recent-inflight"
            >
              <Loader2 className="w-3 h-3 animate-spin" />{" "}
              {recentStats.inFlight} in-flight
            </Badge>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground font-mono max-w-3xl">
        Audit trail for the oracle-admin shim — every restart, oration trigger,
        and observatory override surfaces here with the operator that initiated
        it. Re-dispatch any row to repeat the action with a fresh task ID.
      </p>

      <FilterBar
        fields={filterFields}
        values={filter.values}
        setValue={filter.setValue}
        clearAll={filter.clearAll}
        hasActive={filter.hasActive}
        testIdPrefix="ops-filter"
        resultCount={visible.length}
      />

      <div className="grid gap-3">
        {visible.map((d) => {
          const created = new Date(d.createdAt);
          const isOk = d.status === "completed";
          const isFail = d.status === "failed";
          const isActive = d.status === "active";
          const isPending = d.status === "pending";
          return (
            <Card
              key={d.id}
              className={`bg-card border-border/50 rounded-none border-l-2 ${
                isOk
                  ? "border-l-primary/60"
                  : isFail
                    ? "border-l-destructive/70"
                    : isActive
                      ? "border-l-yellow-500/60"
                      : "border-l-muted-foreground/40"
              }`}
              data-status={d.status}
              data-testid={`dispatch-row-${d.id}`}
            >
              <CardContent className="p-4 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Badge
                      variant="outline"
                      className={`text-[10px] uppercase font-mono ${
                        isOk
                          ? "text-primary border-primary/30"
                          : isFail
                            ? "text-destructive border-destructive/30"
                            : isActive
                              ? "text-yellow-400 border-yellow-500/30"
                              : "text-muted-foreground border-border"
                      }`}
                      data-testid={`dispatch-status-${d.id}`}
                    >
                      {d.status}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="text-[10px] uppercase font-mono text-primary/80 border-primary/20"
                      data-testid={`dispatch-capability-${d.id}`}
                    >
                      {d.requiredCapability}
                    </Badge>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {d.id}
                    </span>
                    {(d.retryCount ?? 0) > 0 && (
                      <span className="font-mono text-[10px] text-yellow-400/80">
                        ↻ retry {d.retryCount}
                      </span>
                    )}
                  </div>
                  <h3 className="font-medium text-foreground break-words">
                    {d.intent}
                  </h3>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[10px] uppercase tracking-wider font-mono text-muted-foreground/80">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {created.toLocaleString([], { hour12: false })}
                    </span>
                    <span
                      className="flex items-center gap-1"
                      data-testid={`dispatch-actor-${d.id}`}
                    >
                      <User className="w-3 h-3" />
                      {d.actor ?? "—"}
                    </span>
                    {d.ip && (
                      <span className="flex items-center gap-1">
                        <Globe className="w-3 h-3" />
                        {d.ip}
                      </span>
                    )}
                    <span>src: {d.source}</span>
                    {d.assignedArmId && <span>arm: {d.assignedArmId}</span>}
                  </div>
                  {d.result && (
                    <div
                      className="text-xs text-foreground/70 mt-2 italic break-words"
                      data-testid={`dispatch-result-${d.id}`}
                    >
                      → {d.result}
                    </div>
                  )}
                  {d.error && (
                    <div
                      className="text-xs text-destructive/90 mt-2 break-words font-mono"
                      data-testid={`dispatch-error-${d.id}`}
                    >
                      ✗ {d.error}
                    </div>
                  )}
                </div>

                {isOperator && (
                  <div className="shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-primary/30 text-primary hover:bg-primary/10"
                      onClick={() => handleReplay(d)}
                      disabled={replayMutation.isPending || isActive}
                      title={
                        isActive
                          ? "Wait for the in-flight dispatch to settle"
                          : isPending
                            ? "Re-dispatch — the original is still queued (no arm available yet)"
                            : "Re-dispatch this action with a new task ID"
                      }
                      data-testid={`button-replay-${d.id}`}
                    >
                      <RotateCw className="w-3 h-3 mr-1" /> Replay
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {visible.length === 0 && (
          <div className="text-center p-12 border border-dashed border-border/50">
            <ShieldAlert className="w-8 h-8 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground font-mono text-sm">
              {all.length === 0
                ? "No privileged dispatches recorded yet."
                : "No dispatches match the current filters."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
