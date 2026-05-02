import { useState } from "react";
import {
  useListSignals,
  useInjectSignal,
  getListSignalsQueryKey,
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
import { Radio, Plus } from "lucide-react";
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

export default function SignalsIngestion() {
  const { data: signals, isLoading } = useListSignals({
    query: {
      refetchInterval: 8000,
      queryKey: getListSignalsQueryKey(),
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

      <div className="space-y-3">
        {signals?.map((signal: Signal) => (
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
