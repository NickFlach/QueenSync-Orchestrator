import { useEffect, useMemo, useRef, useState } from "react";
import {
  useListMemory,
  useGetExemplarStats,
  useTraceMemory,
  useDispatchDreamLite,
  useLocalApproveMemory,
  useAbsorbMemory,
  useDecideExemplar,
  useHealthCheck,
  MemoryEvent,
  MemoryEventAbsorbState,
  MemoryEventDecision,
  MemoryEventExemplarOutcome,
  ExemplarDecisionBodyOutcome,
  NatsStatusState,
  getListMemoryQueryKey,
  getGetExemplarStatsQueryKey,
  getTraceMemoryQueryKey,
  getHealthCheckQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useQueenSyncSocket } from "@/hooks/use-queensync-ws";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  BrainCircuit,
  Layers,
  Trash2,
  Send,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Activity,
  Sparkles,
  Network,
  RefreshCcw,
  ShieldAlert,
} from "lucide-react";
import {
  FilterBar,
  useFilterState,
  uniqueSorted,
  type FilterField,
} from "@/components/filter-bar";

function absorbBadge(state: MemoryEventAbsorbState, attempts?: number) {
  switch (state) {
    case "absorbed":
      return (
        <Badge className="text-[10px] uppercase bg-emerald-500/15 text-emerald-300 border-emerald-500/30 border">
          <CheckCircle2 className="w-3 h-3 mr-1" /> absorbed
        </Badge>
      );
    case "pending":
      return (
        <Badge className="text-[10px] uppercase bg-amber-500/15 text-amber-300 border-amber-500/30 border">
          <Clock className="w-3 h-3 mr-1" /> hrm pending
          {attempts && attempts > 1 ? (
            <span className="ml-1 opacity-80">×{attempts}</span>
          ) : null}
        </Badge>
      );
    case "failed":
      return (
        <Badge className="text-[10px] uppercase bg-destructive/15 text-destructive border-destructive/30 border">
          <AlertCircle className="w-3 h-3 mr-1" /> absorb failed
          {attempts && attempts > 0 ? (
            <span className="ml-1 opacity-80">×{attempts}</span>
          ) : null}
        </Badge>
      );
    case "not_required":
    default:
      return (
        <Badge
          variant="outline"
          className="text-[10px] uppercase text-muted-foreground"
        >
          local-only
        </Badge>
      );
  }
}

function exemplarOutcomeBadge(o: MemoryEventExemplarOutcome | undefined | null) {
  if (!o) {
    return (
      <Badge className="text-[10px] uppercase bg-amber-500/15 text-amber-300 border border-amber-500/30">
        <Sparkles className="w-3 h-3 mr-1" /> awaiting decision
      </Badge>
    );
  }
  if (o === "strengthened") {
    return (
      <Badge className="text-[10px] uppercase bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
        <CheckCircle2 className="w-3 h-3 mr-1" /> strengthened
      </Badge>
    );
  }
  return (
    <Badge className="text-[10px] uppercase bg-muted text-muted-foreground border border-border/40">
      <Trash2 className="w-3 h-3 mr-1" /> pruned
    </Badge>
  );
}

function decisionBadge(decision: MemoryEventDecision) {
  return (
    <Badge
      variant="outline"
      className={`text-[10px] uppercase ${
        decision === "approved"
          ? "text-primary border-primary/30"
          : decision === "rejected"
          ? "text-destructive border-destructive/30"
          : decision === "pending"
          ? "text-amber-300 border-amber-500/30"
          : "text-muted-foreground"
      }`}
    >
      {decision}
    </Badge>
  );
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  if (!Number.isFinite(d)) return "";
  const delta = Date.now() - d;
  if (delta < 60_000) return `${Math.max(0, Math.floor(delta / 1000))}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return new Date(iso).toLocaleString();
}

interface MemoryRowProps {
  event: MemoryEvent;
  onAbsorb: (id: string) => void;
  onLocalApprove: (id: string) => void;
  onTrace: (id: string) => void;
  busyId: string | null;
  natsState: NatsStatusState | null;
  natsReason: string | null;
}

function MemoryRow({
  event,
  onAbsorb,
  onLocalApprove,
  onTrace,
  busyId,
  natsState,
  natsReason,
}: MemoryRowProps) {
  const natsConnected = natsState === "connected";
  const absorbBlockedByNats =
    natsState !== null && !natsConnected && event.absorbState !== "absorbed";
  const isCompression = event.type === "dream_lite_compression";
  const decision = event.decision;
  const isBusy = busyId === event.id;
  return (
    <Card
      data-decision={decision}
      data-compacted={event.compacted ? "true" : "false"}
      data-compression={isCompression ? "true" : "false"}
      data-absorb-state={event.absorbState}
      data-testid={`memory-row-${event.id}`}
      className={`bg-card border-border/50 rounded-none border-l-2 ${
        decision === "approved"
          ? "border-l-primary"
          : decision === "rejected"
          ? "border-l-destructive"
          : decision === "pending"
          ? "border-l-amber-400"
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
              {isCompression && <Layers className="w-4 h-4 text-primary" />}
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
              {decisionBadge(decision)}
              {absorbBadge(event.absorbState, event.absorbAttempts)}
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
              <span className="text-destructive/80">
                reason: {event.reason}
              </span>
            )}
            {event.absorbedAt && (
              <span className="text-emerald-300/80">
                hrm ack {formatRelative(event.absorbedAt)}
              </span>
            )}
            {event.lastAbsorbError && (
              <span className="text-destructive/80">
                err: {event.lastAbsorbError}
              </span>
            )}
            {event.idempotencyKey && (
              <span title={event.idempotencyKey ?? undefined}>
                key: {(event.idempotencyKey ?? "").slice(0, 8)}…
              </span>
            )}
            {event.compactedIntoId && <span>→ {event.compactedIntoId}</span>}
          </div>
          {!event.compacted && decision !== "rejected" && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="default"
                disabled={
                  isBusy ||
                  event.absorbState === "pending" ||
                  event.absorbState === "absorbed" ||
                  absorbBlockedByNats
                }
                onClick={() => onAbsorb(event.id)}
                data-testid={`btn-absorb-${event.id}`}
                title={
                  absorbBlockedByNats
                    ? `Absorb disabled — NATS bridge ${natsReason ?? natsState ?? "unavailable"}`
                    : "Publish on KANNAKA.absorb so kannaka-memory can absorb this into HRM"
                }
              >
                <Send className="w-3 h-3 mr-1" />
                {event.absorbState === "absorbed"
                  ? "Absorbed"
                  : event.absorbState === "pending"
                  ? "Awaiting HRM…"
                  : event.absorbState === "failed"
                  ? "Retry Absorb"
                  : "Absorb to HRM"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isBusy || event.absorbState === "absorbed"}
                onClick={() => onLocalApprove(event.id)}
                data-testid={`btn-local-${event.id}`}
              >
                <ShieldAlert className="w-3 h-3 mr-1" />
                Approve (local)
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onTrace(event.id)}
                data-testid={`btn-trace-${event.id}`}
              >
                <Network className="w-3 h-3 mr-1" />
                Trace
              </Button>
              {absorbBlockedByNats && (
                <Badge
                  variant="outline"
                  className="text-[10px] uppercase text-destructive border-destructive/40"
                  data-testid={`badge-nats-blocked-${event.id}`}
                >
                  <AlertCircle className="w-3 h-3 mr-1" />
                  NATS {natsState ?? "down"} — absorb disabled
                </Badge>
              )}
            </div>
          )}
          {event.compacted && (
            <div className="mt-3">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onTrace(event.id)}
                data-testid={`btn-trace-${event.id}`}
              >
                <Network className="w-3 h-3 mr-1" />
                Trace
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface ExemplarRowProps {
  event: MemoryEvent;
  onDecide: (id: string, outcome: ExemplarDecisionBodyOutcome) => void;
  onTrace: (id: string) => void;
  busyId: string | null;
  natsState: NatsStatusState | null;
  natsReason: string | null;
}

function ExemplarRow({
  event,
  onDecide,
  onTrace,
  busyId,
  natsState,
  natsReason,
}: ExemplarRowProps) {
  const natsConnected = natsState === "connected";
  const strengthenBlocked = natsState !== null && !natsConnected;
  const isBusy = busyId === event.id;
  const decided = event.exemplarOutcome != null;
  return (
    <Card
      data-testid={`exemplar-row-${event.id}`}
      data-outcome={event.exemplarOutcome ?? "pending"}
      className="bg-card border-border/50 rounded-none border-l-2 border-l-primary/60"
    >
      <CardContent className="p-4 flex gap-4 items-start">
        <Sparkles className="w-5 h-5 text-primary mt-1" />
        <div className="flex-1 min-w-0">
          <div className="flex justify-between mb-1 flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-foreground">
                HRM exemplar
              </span>
              <Badge
                variant="outline"
                className="text-[10px] uppercase text-muted-foreground"
              >
                {event.tag}
              </Badge>
              {event.tags?.slice(0, 4).map((t) => (
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
              {exemplarOutcomeBadge(event.exemplarOutcome)}
              {absorbBadge(event.absorbState, event.absorbAttempts)}
            </div>
          </div>
          <p className="text-sm text-foreground/80 line-clamp-3">
            {event.content}
          </p>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground font-mono">
            <span>arrived {formatRelative(event.createdAt)}</span>
            {event.absorbedAt && (
              <span className="text-emerald-300/80">
                strengthened {formatRelative(event.absorbedAt)}
              </span>
            )}
          </div>
          {!decided && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="default"
                disabled={isBusy || strengthenBlocked}
                onClick={() => onDecide(event.id, "strengthened")}
                data-testid={`btn-exemplar-strengthen-${event.id}`}
                title={
                  strengthenBlocked
                    ? `Re-absorb disabled — NATS ${natsReason ?? natsState ?? "unavailable"}`
                    : "Republish on KANNAKA.absorb to reinforce HRM weights"
                }
              >
                <RefreshCcw className="w-3 h-3 mr-1" />
                Re-absorb (strengthen)
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isBusy}
                onClick={() => onDecide(event.id, "pruned")}
                data-testid={`btn-exemplar-prune-${event.id}`}
              >
                <Trash2 className="w-3 h-3 mr-1" />
                Reject (prune)
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onTrace(event.id)}
                data-testid={`btn-trace-${event.id}`}
              >
                <Network className="w-3 h-3 mr-1" />
                Trace
              </Button>
              {strengthenBlocked && (
                <Badge
                  variant="outline"
                  className="text-[10px] uppercase text-destructive border-destructive/40"
                  data-testid={`badge-nats-blocked-exemplar-${event.id}`}
                >
                  <AlertCircle className="w-3 h-3 mr-1" />
                  NATS {natsState ?? "down"} — re-absorb disabled
                </Badge>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TraceDialog({
  memoryId,
  onClose,
}: {
  memoryId: string | null;
  onClose: () => void;
}) {
  const open = !!memoryId;
  const { data, isLoading } = useTraceMemory(memoryId ?? "", {
    query: {
      enabled: open,
      queryKey: getTraceMemoryQueryKey(memoryId ?? ""),
    },
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Network className="w-4 h-4 text-primary" />
            Trace event
          </DialogTitle>
          <DialogDescription className="text-xs font-mono">
            {memoryId ?? ""}
          </DialogDescription>
        </DialogHeader>
        {isLoading || !data ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full bg-card" />
            <Skeleton className="h-12 w-full bg-card" />
          </div>
        ) : (
          <div className="space-y-3" data-testid="trace-steps">
            <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground font-mono">
              <span>signal: {data.summary.hasSignal ? "✓" : "—"}</span>
              <span>resonance: {data.summary.hasResonance ? "✓" : "—"}</span>
              <span>responses: {data.summary.responseCount}</span>
              <span>absorb: {data.summary.absorbState}</span>
              {data.summary.idempotencyKey && (
                <span>key: {data.summary.idempotencyKey.slice(0, 8)}…</span>
              )}
            </div>
            <ol className="space-y-2 border-l border-primary/30 pl-4">
              {data.steps.map((s) => (
                <li
                  key={`${s.kind}-${s.id}`}
                  className="relative"
                  data-testid={`trace-step-${s.kind}`}
                >
                  <div className="absolute -left-[18px] top-1 w-2 h-2 rounded-full bg-primary" />
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="text-[10px] uppercase text-primary/80 border-primary/20"
                      >
                        {s.kind}
                      </Badge>
                      <span className="text-sm font-semibold">{s.title}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {formatRelative(s.at)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 break-words">
                    {s.detail}
                  </p>
                </li>
              ))}
              {data.steps.length === 0 && (
                <li className="text-xs text-muted-foreground">
                  No trace steps recorded yet.
                </li>
              )}
            </ol>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface DreamProgressEntry {
  id: string;
  at: number;
  kind: "task" | "log" | "memory" | "info";
  label: string;
  detail: string;
}

export default function MemoryGate() {
  const qc = useQueryClient();
  const [includeCompacted, setIncludeCompacted] = useState(false);
  const [includeRejected, setIncludeRejected] = useState(false);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dreamNote, setDreamNote] = useState<string | null>(null);
  const [dreamTaskId, setDreamTaskId] = useState<string | null>(null);
  const [dreamProgress, setDreamProgress] = useState<DreamProgressEntry[]>([]);

  const memoryQueryKey = getListMemoryQueryKey({
    includeCompacted,
    includeRejected,
  });
  const exemplarQueryKey = getListMemoryQueryKey({ inboundExemplarsOnly: true });
  const statsQueryKey = getGetExemplarStatsQueryKey();
  const healthQueryKey = getHealthCheckQueryKey();

  const { data: health } = useHealthCheck({
    query: { refetchInterval: 5000, queryKey: healthQueryKey },
  });
  const natsState: NatsStatusState | null = health?.nats?.state ?? null;
  const natsReason: string | null =
    health?.nats?.lastError ?? health?.nats?.url ?? null;
  const natsConnected = natsState === "connected";

  const { lastEvent } = useQueenSyncSocket();
  const lastSeenRef = useRef<number>(0);

  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.ts === lastSeenRef.current) return;
    lastSeenRef.current = lastEvent.ts;
    if (!dreamTaskId) return;
    const data = (lastEvent.data ?? {}) as Record<string, unknown>;
    const eventTaskId =
      (data["id"] as string | undefined) ??
      ((data["metadata"] as Record<string, unknown> | undefined)?.["taskId"] as
        | string
        | undefined) ??
      ((data["context"] as Record<string, unknown> | undefined)?.["taskId"] as
        | string
        | undefined);
    let entry: DreamProgressEntry | null = null;
    if (
      lastEvent.type === "task_assigned" ||
      lastEvent.type === "task_updated" ||
      lastEvent.type === "task_completed" ||
      lastEvent.type === "task_failed"
    ) {
      if (eventTaskId === dreamTaskId) {
        const status = String(data["status"] ?? lastEvent.type);
        entry = {
          id: `${lastEvent.ts}`,
          at: lastEvent.ts,
          kind: "task",
          label: lastEvent.type,
          detail: `task ${dreamTaskId} → ${status}${
            data["assignedArmId"] ? ` (arm ${data["assignedArmId"] as string})` : ""
          }`,
        };
      }
    } else if (lastEvent.type === "log_event") {
      const meta = (data["metadata"] as Record<string, unknown> | undefined) ?? {};
      if (meta["taskId"] === dreamTaskId) {
        entry = {
          id: `${lastEvent.ts}`,
          at: lastEvent.ts,
          kind: "log",
          label: String(data["eventType"] ?? "log_event"),
          detail: String(data["summary"] ?? "(no summary)"),
        };
      }
    } else if (lastEvent.type === "memory_event") {
      if (
        data["type"] === "dream_lite_compression" ||
        data["type"] === "system_event"
      ) {
        const meta = (data["metadata"] as Record<string, unknown> | undefined) ?? {};
        const summary = String(data["summary"] ?? data["content"] ?? "");
        if (meta["taskId"] === dreamTaskId || summary.includes(dreamTaskId)) {
          entry = {
            id: `${lastEvent.ts}`,
            at: lastEvent.ts,
            kind: "memory",
            label: String(data["type"] ?? "memory_event"),
            detail: summary,
          };
        }
      }
    }
    if (entry) {
      setDreamProgress((prev) => [...prev, entry!].slice(-30));
    }
  }, [lastEvent, dreamTaskId]);

  const { data: memory, isLoading } = useListMemory(
    { includeCompacted, includeRejected },
    { query: { refetchInterval: 5000, queryKey: memoryQueryKey } },
  );

  const { data: exemplars } = useListMemory(
    { inboundExemplarsOnly: true },
    { query: { refetchInterval: 5000, queryKey: exemplarQueryKey } },
  );

  const { data: stats } = useGetExemplarStats({
    query: { refetchInterval: 5000, queryKey: statsQueryKey },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: memoryQueryKey });
    qc.invalidateQueries({ queryKey: exemplarQueryKey });
    qc.invalidateQueries({ queryKey: statsQueryKey });
  };

  const absorbMutation = useAbsorbMemory({
    mutation: {
      onSettled: () => {
        setBusyId(null);
        invalidate();
      },
    },
  });
  const localMutation = useLocalApproveMemory({
    mutation: {
      onSettled: () => {
        setBusyId(null);
        invalidate();
      },
    },
  });
  const decideMutation = useDecideExemplar({
    mutation: {
      onSettled: () => {
        setBusyId(null);
        invalidate();
      },
    },
  });
  const dispatchMutation = useDispatchDreamLite({
    mutation: {
      onSuccess: (data) => {
        setDreamNote(data.note);
        const newTaskId = data.task?.id ?? null;
        if (newTaskId) {
          setDreamTaskId(newTaskId);
          setDreamProgress([
            {
              id: `${Date.now()}-dispatched`,
              at: Date.now(),
              kind: "info",
              label: "dispatched",
              detail: `task ${newTaskId} → arm ${
                data.assignedArmId ?? "none (local fallback)"
              }`,
            },
          ]);
        }
        invalidate();
      },
    },
  });

  const handleAbsorb = (id: string) => {
    setBusyId(id);
    absorbMutation.mutate({ id });
  };
  const handleLocal = (id: string) => {
    setBusyId(id);
    localMutation.mutate({ id });
  };
  const handleDecide = (id: string, outcome: ExemplarDecisionBodyOutcome) => {
    setBusyId(id);
    decideMutation.mutate({ id, data: { outcome } });
  };

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

  const allMemory = (memory ?? []) as MemoryEvent[];
  const filterFields: FilterField[] = useMemo(
    () => [
      {
        kind: "select",
        key: "decision",
        label: "Status",
        placeholder: "All decisions",
        options: [
          { value: "approved", label: "approved" },
          { value: "pending", label: "pending" },
          { value: "rejected", label: "rejected" },
          { value: "duplicate", label: "compacted (duplicate)" },
        ],
      },
      {
        kind: "select",
        key: "absorb",
        label: "Absorb",
        placeholder: "All absorb states",
        options: [
          { value: "not_required", label: "local-only" },
          { value: "pending", label: "hrm pending" },
          { value: "absorbed", label: "absorbed" },
          { value: "failed", label: "failed" },
        ],
      },
      {
        kind: "select",
        key: "agent",
        label: "Agent",
        placeholder: "All agents",
        options: uniqueSorted(allMemory.map((m) => m.agentId)).map((v) => ({
          value: v,
          label: v,
        })),
      },
      {
        kind: "select",
        key: "tag",
        label: "Tag",
        placeholder: "All tags",
        options: uniqueSorted(allMemory.map((m) => m.tag)).map((v) => ({
          value: v,
          label: v,
        })),
      },
      {
        kind: "text",
        key: "q",
        label: "Search content",
        placeholder: "search content, tag…",
      },
    ],
    [allMemory],
  );
  const filter = useFilterState(filterFields);
  const matchesFilter = useMemo(() => {
    const q = filter.values.q?.trim().toLowerCase();
    return (m: MemoryEvent) => {
      if (filter.values.decision && m.decision !== filter.values.decision)
        return false;
      if (filter.values.absorb && m.absorbState !== filter.values.absorb)
        return false;
      if (filter.values.agent && (m.agentId ?? "") !== filter.values.agent)
        return false;
      if (filter.values.tag && m.tag !== filter.values.tag) return false;
      if (q) {
        const hay = `${m.content} ${m.tag} ${m.type}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    };
  }, [filter.values]);
  const visibleGrouped = useMemo(
    () => grouped.filter(({ parent }) => matchesFilter(parent)),
    [grouped, matchesFilter],
  );

  const visibleExemplars = (exemplars ?? []).filter(
    (e) => e.exemplarOutcome == null,
  );

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
            v2 wave 4 · KANNAKA.absorb bridge · HRM exemplars · trace
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Badge
              variant="outline"
              className={`text-[10px] uppercase tracking-widest ${
                natsConnected
                  ? "text-emerald-300 border-emerald-500/40"
                  : natsState
                  ? "text-destructive border-destructive/40"
                  : "text-muted-foreground border-border/40"
              }`}
              data-testid="badge-nats-state"
              data-nats-state={natsState ?? "unknown"}
              title={natsReason ?? undefined}
            >
              {natsConnected ? (
                <CheckCircle2 className="w-3 h-3 mr-1" />
              ) : (
                <AlertCircle className="w-3 h-3 mr-1" />
              )}
              NATS {natsState ?? "unknown"}
            </Badge>
            {!natsConnected && natsState && (
              <span
                className="text-[11px] font-mono text-destructive/80"
                data-testid="text-nats-blocked-reason"
              >
                Absorb / Re-absorb disabled until NATS reconnects
                {natsReason ? ` — ${natsReason}` : ""}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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

      {/* Dream Lite — long-running honest dispatch */}
      <Card className="bg-card/60 border border-primary/20 rounded-none">
        <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-3 justify-between">
          <div className="flex items-start gap-3">
            <Activity className="w-5 h-5 text-primary mt-1" />
            <div>
              <p className="text-sm font-semibold uppercase tracking-widest text-primary">
                Dream Lite — kannaka-prime dispatch
              </p>
              <p className="text-xs text-muted-foreground mt-1 max-w-prose">
                Dispatches <code>kannaka dream --mode lite</code> to the
                kannaka-prime arm (capability=<code>dream</code>) so the HRM can
                consolidate. Honest about cost — a real dream cycle on a bloated
                medium can take <strong>5+ minutes</strong>; the local audit
                trail compaction runs as a fallback when no dream-capable arm is
                online.
              </p>
              {dreamNote && (
                <p
                  className="text-xs text-emerald-300/90 mt-2 font-mono"
                  data-testid="dream-note"
                >
                  {dreamNote}
                </p>
              )}
            </div>
          </div>
          <Button
            size="sm"
            variant="default"
            disabled={dispatchMutation.isPending}
            onClick={() => dispatchMutation.mutate({ data: {} })}
            data-testid="btn-dream-dispatch"
          >
            <Sparkles className="w-3 h-3 mr-1" />
            {dispatchMutation.isPending ? "Dispatching…" : "Dispatch Dream Lite"}
          </Button>
        </CardContent>
        {dreamTaskId && (
          <div
            className="border-t border-border/40 px-4 py-3 space-y-2"
            data-testid="dream-progress"
            data-task-id={dreamTaskId}
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">
                live progress · task {dreamTaskId}
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDreamTaskId(null);
                  setDreamProgress([]);
                }}
                data-testid="btn-dream-progress-clear"
              >
                <Trash2 className="w-3 h-3 mr-1" /> clear
              </Button>
            </div>
            {dreamProgress.length === 0 ? (
              <p className="text-[11px] text-muted-foreground font-mono">
                Waiting for the swarm to pick up this task…
              </p>
            ) : (
              <ol className="space-y-1 text-[11px] font-mono">
                {dreamProgress
                  .slice()
                  .reverse()
                  .map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap gap-2 items-baseline"
                      data-testid={`dream-progress-${p.kind}`}
                    >
                      <Badge
                        variant="outline"
                        className="text-[10px] uppercase text-primary/80 border-primary/20"
                      >
                        {p.kind}
                      </Badge>
                      <span className="text-foreground/90">{p.label}</span>
                      <span className="text-muted-foreground">{p.detail}</span>
                      <span className="text-muted-foreground/60 ml-auto">
                        {formatRelative(new Date(p.at).toISOString())}
                      </span>
                    </li>
                  ))}
              </ol>
            )}
          </div>
        )}
      </Card>

      {/* Inbound HRM exemplars */}
      <section data-testid="exemplars-section" className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-bold uppercase tracking-widest text-primary">
              Inbound HRM exemplars
            </h2>
          </div>
          <div className="flex items-center gap-3 text-[11px] font-mono text-muted-foreground">
            <span data-testid="stat-strengthened">
              strengthened:{" "}
              <span className="text-emerald-300">
                {stats?.strengthened ?? 0}
              </span>
            </span>
            <span data-testid="stat-pruned">
              pruned:{" "}
              <span className="text-destructive/90">{stats?.pruned ?? 0}</span>
            </span>
            <span data-testid="stat-pending">
              pending:{" "}
              <span className="text-amber-300">{stats?.pending ?? 0}</span>
            </span>
          </div>
        </div>
        {visibleExemplars.length === 0 ? (
          <div className="text-center p-6 border border-dashed border-border/50 text-muted-foreground text-xs">
            No pending exemplars from KANNAKA.exemplars.
          </div>
        ) : (
          <div className="space-y-2">
            {visibleExemplars.map((e) => (
              <ExemplarRow
                key={e.id}
                event={e}
                onDecide={handleDecide}
                onTrace={(id) => setTraceId(id)}
                busyId={busyId}
                natsState={natsState}
                natsReason={natsReason}
              />
            ))}
          </div>
        )}
      </section>

      <FilterBar
        fields={filterFields}
        values={filter.values}
        setValue={filter.setValue}
        clearAll={filter.clearAll}
        hasActive={filter.hasActive}
        testIdPrefix="memory-filter"
        resultCount={visibleGrouped.length}
      />

      <div className="space-y-3">
        {visibleGrouped.map(({ parent, children }) => (
          <div key={parent.id} className="space-y-2">
            <MemoryRow
              event={parent}
              onAbsorb={handleAbsorb}
              onLocalApprove={handleLocal}
              onTrace={(id) => setTraceId(id)}
              busyId={busyId}
              natsState={natsState}
              natsReason={natsReason}
            />
            {children.length > 0 && (
              <div className="ml-8 pl-4 border-l border-primary/20 space-y-2">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  compacted into above ({children.length})
                </p>
                {children.map((c) => (
                  <MemoryRow
                    key={c.id}
                    event={c}
                    onAbsorb={handleAbsorb}
                    onLocalApprove={handleLocal}
                    onTrace={(id) => setTraceId(id)}
                    busyId={busyId}
                    natsState={natsState}
                    natsReason={natsReason}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
        {visibleGrouped.length === 0 && (
          <div className="text-center p-12 border border-dashed border-border/50">
            <BrainCircuit className="w-8 h-8 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">
              {allMemory.length === 0
                ? "Memory bank is empty."
                : "No memory events match the current filters."}
            </p>
          </div>
        )}
      </div>

      <TraceDialog memoryId={traceId} onClose={() => setTraceId(null)} />
    </div>
  );
}
