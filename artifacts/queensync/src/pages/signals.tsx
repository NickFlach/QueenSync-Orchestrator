import { useMemo, useState } from "react";
import {
  useListSignals,
  useInjectSignal,
  useRadioAdapterHealth,
  useObservatoryAdapterHealth,
  getListSignalsQueryKey,
  getRadioAdapterHealthQueryKey,
  getObservatoryAdapterHealthQueryKey,
  AdapterHealth,
  Signal,
  InjectSignalBodyType,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Radio, Plus, AlertTriangle, EyeOff, FlaskConical } from "lucide-react";
import {
  FilterBar,
  useFilterState,
  uniqueSorted,
  type FilterField,
} from "@/components/filter-bar";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const SIGNAL_TYPES: InjectSignalBodyType[] = [
  "build_request",
  "memory_anomaly",
  "governance_alert",
  "observation_event",
  "radio_transmission",
  "openclaw_artifact",
  "other",
];

function AdapterStatusBadges({
  label,
  health,
}: {
  label: string;
  health: AdapterHealth | undefined;
}) {
  if (!health) return null;
  const slug = label.toLowerCase();
  const modeClass =
    health.mode === "live"
      ? "border-primary/60 text-primary"
      : health.mode === "stale"
        ? "border-amber-500/60 text-amber-500"
        : health.mode === "forced_mock"
          ? "border-fuchsia-500/60 text-fuchsia-400"
          : "border-muted-foreground/40 text-muted-foreground";
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid={`signal-feed-status-${slug}`}
    >
      <span className="text-[10px] uppercase text-muted-foreground tracking-wider">
        {label}
      </span>
      <Badge
        variant="outline"
        className={`text-[10px] uppercase ${modeClass}`}
        data-testid={`signal-feed-mode-${slug}`}
      >
        {health.mode}
      </Badge>
      {health.stale && (
        <Badge
          variant="outline"
          className="text-[10px] uppercase border-amber-500/60 text-amber-500 flex items-center gap-1"
          data-testid={`signal-feed-stale-${slug}`}
        >
          <AlertTriangle className="w-3 h-3" /> stale
        </Badge>
      )}
      {health.metricsSuppressed && (
        <Badge
          variant="outline"
          className="text-[10px] uppercase border-orange-500/60 text-orange-500 flex items-center gap-1"
          data-testid={`signal-feed-suppressed-${slug}`}
        >
          <EyeOff className="w-3 h-3" /> metrics suppressed
        </Badge>
      )}
      {health.forceMock && (
        <Badge
          variant="outline"
          className="text-[10px] uppercase border-fuchsia-500/60 text-fuchsia-400 flex items-center gap-1"
          data-testid={`signal-feed-forced-mock-${slug}`}
        >
          <FlaskConical className="w-3 h-3" /> forced mock
        </Badge>
      )}
      {health.lastSuccessAt && (
        <span className="text-[10px] text-muted-foreground/70">
          last live {new Date(health.lastSuccessAt).toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}

export default function SignalsIngestion() {
  const { data: signals, isLoading } = useListSignals({
    query: {
      refetchInterval: 30000,
      queryKey: getListSignalsQueryKey(),
    },
  });
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
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<InjectSignalBodyType>("build_request");
  const [source, setSource] = useState("console");
  const [payload, setPayload] = useState(
    '{"summary":"Compose a chord","capability":"transmit"}',
  );

  const allSignals = (signals ?? []) as Signal[];
  const filterFields: FilterField[] = useMemo(
    () => [
      {
        kind: "select",
        key: "type",
        label: "Type",
        placeholder: "All types",
        options: SIGNAL_TYPES.map((t) => ({ value: t, label: t })),
      },
      {
        kind: "select",
        key: "source",
        label: "Source",
        placeholder: "All sources",
        options: uniqueSorted(allSignals.map((s) => s.source)).map((v) => ({
          value: v,
          label: v,
        })),
      },
      {
        kind: "select",
        key: "status",
        label: "Status",
        placeholder: "All statuses",
        options: [
          { value: "received", label: "received" },
          { value: "converted", label: "converted" },
          { value: "ignored", label: "ignored" },
        ],
      },
      {
        kind: "text",
        key: "q",
        label: "Search payload",
        placeholder: "search payload, id, type…",
      },
    ],
    [allSignals],
  );
  const filter = useFilterState(filterFields);
  const visibleSignals = useMemo(() => {
    const q = filter.values.q?.trim().toLowerCase();
    return allSignals.filter((s) => {
      if (filter.values.type && s.type !== filter.values.type) return false;
      if (filter.values.source && (s.source ?? "") !== filter.values.source)
        return false;
      if (filter.values.status && s.status !== filter.values.status) return false;
      if (q) {
        const hay =
          `${s.type} ${s.id} ${s.source ?? ""} ${JSON.stringify(s.payload ?? {})}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allSignals, filter.values]);

  const inject = useInjectSignal({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Signal Injected",
          description: `${type} dispatched.`,
        });
        queryClient.invalidateQueries({ queryKey: getListSignalsQueryKey() });
        setOpen(false);
      },
      onError: (err) =>
        toast({
          title: "Inject Failed",
          description: (err as Error).message,
          variant: "destructive",
        }),
    },
  });

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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-primary uppercase drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]">
          Signal Ingestion
        </h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              className="border-primary text-primary hover:bg-primary/20"
              data-testid="button-inject-signal"
            >
              <Plus className="w-4 h-4 mr-2" /> Inject Signal
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border/50">
            <DialogHeader>
              <DialogTitle className="text-primary uppercase tracking-wider">
                Inject Signal
              </DialogTitle>
              <DialogDescription>
                Build requests become tasks; anomalies/alerts become resonance
                fields.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs uppercase">Type</Label>
                <Select
                  value={type}
                  onValueChange={(v) => setType(v as InjectSignalBodyType)}
                >
                  <SelectTrigger data-testid="select-signal-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SIGNAL_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs uppercase">Source</Label>
                <Input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  data-testid="input-signal-source"
                />
              </div>
              <div>
                <Label className="text-xs uppercase">Payload (JSON)</Label>
                <Textarea
                  value={payload}
                  onChange={(e) => setPayload(e.target.value)}
                  rows={5}
                  className="font-mono text-xs"
                  data-testid="textarea-signal-payload"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={inject.isPending}
                onClick={() => {
                  let parsed: Record<string, unknown> = {};
                  try {
                    parsed = JSON.parse(payload);
                  } catch {
                    toast({
                      title: "Invalid JSON",
                      description: "Payload must be valid JSON.",
                      variant: "destructive",
                    });
                    return;
                  }
                  inject.mutate({
                    data: { type, source, payload: parsed },
                  });
                }}
                data-testid="button-confirm-inject"
                className="bg-primary text-primary-foreground hover:bg-primary/80"
              >
                Inject
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="bg-card border-border/50">
        <CardContent className="p-4 space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Adapter Feed Status
          </div>
          <AdapterStatusBadges label="Radio" health={radioHealth} />
          <AdapterStatusBadges label="Observatory" health={obsHealth} />
        </CardContent>
      </Card>

      <FilterBar
        fields={filterFields}
        values={filter.values}
        setValue={filter.setValue}
        clearAll={filter.clearAll}
        hasActive={filter.hasActive}
        testIdPrefix="signals-filter"
        resultCount={visibleSignals.length}
      />

      <div className="space-y-3">
        {visibleSignals.map((signal: Signal) => (
          <Card key={signal.id} className="bg-card border-border/50 font-mono">
            <CardContent className="p-4">
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="text-[10px] text-primary border-primary/30 uppercase"
                  >
                    {signal.type}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(signal.createdAt).toLocaleString()}
                  </span>
                  {signal.source && (
                    <span className="text-[10px] text-muted-foreground/70">
                      {signal.source}
                    </span>
                  )}
                </div>
                <Badge
                  variant="outline"
                  className="text-[10px] uppercase text-muted-foreground"
                >
                  {signal.status}
                </Badge>
              </div>
              <div className="bg-background rounded p-2 text-xs text-foreground/80 overflow-x-auto">
                <pre>{JSON.stringify(signal.payload, null, 2)}</pre>
              </div>
              {signal.derivedTaskId && (
                <div className="text-[10px] text-primary/70 mt-2">
                  → Task: {signal.derivedTaskId}
                </div>
              )}
              {signal.derivedResonanceId && (
                <div className="text-[10px] text-primary/70 mt-2">
                  → Resonance: {signal.derivedResonanceId}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {visibleSignals.length === 0 && (
          <div className="text-center p-12 border border-dashed border-border/50">
            <Radio className="w-8 h-8 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">
              {allSignals.length === 0
                ? "No signals received."
                : "No signals match the current filters."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
