import { useMemo, useState } from "react";
import {
  useListResonance,
  useCreateResonance,
  useResolveResonance,
  useRespondResonance,
  getListResonanceQueryKey,
  getListActiveResonanceQueryKey,
  Resonance,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { AudioWaveform, Plus, GitMerge, Sparkles } from "lucide-react";
import {
  FilterBar,
  useFilterState,
  uniqueSorted,
  type FilterField,
} from "@/components/filter-bar";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function ResonanceFields() {
  const { data: resonance, isLoading } = useListResonance({
    query: { refetchInterval: 8000, queryKey: getListResonanceQueryKey() },
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState("");
  const [tags, setTags] = useState("transmit,chord");
  const [priority, setPriority] = useState(0.6);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListResonanceQueryKey() });
    queryClient.invalidateQueries({
      queryKey: getListActiveResonanceQueryKey(),
    });
  };

  const allResonance = (resonance ?? []) as Resonance[];
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const r of allResonance) for (const t of r.tags) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allResonance]);
  const filterFields: FilterField[] = useMemo(
    () => [
      {
        kind: "select",
        key: "status",
        label: "Status",
        placeholder: "All statuses",
        options: [
          { value: "active", label: "active" },
          { value: "resolved", label: "resolved" },
          { value: "expired", label: "expired" },
        ],
      },
      {
        kind: "select",
        key: "tag",
        label: "Tag",
        placeholder: "All tags",
        options: allTags.map((v) => ({ value: v, label: v })),
      },
      {
        kind: "text",
        key: "q",
        label: "Search intent",
        placeholder: "search intent…",
      },
    ],
    [allTags],
  );
  const filter = useFilterState(filterFields);
  const visibleResonance = useMemo(() => {
    const q = filter.values.q?.trim().toLowerCase();
    return allResonance.filter((r) => {
      if (filter.values.status && r.status !== filter.values.status) return false;
      if (filter.values.tag && !r.tags.includes(filter.values.tag)) return false;
      if (q && !r.intent.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allResonance, filter.values]);

  const create = useCreateResonance({
    mutation: {
      onSuccess: () => {
        toast({ title: "Resonance Opened", description: intent });
        invalidate();
        setOpen(false);
        setIntent("");
      },
      onError: (e) =>
        toast({
          title: "Failed",
          description: (e as Error).message,
          variant: "destructive",
        }),
    },
  });

  const resolve = useResolveResonance({
    mutation: {
      onSuccess: () => {
        toast({ title: "Resonance Resolved" });
        invalidate();
      },
    },
  });

  const respond = useRespondResonance({
    mutation: {
      onSuccess: () => {
        toast({ title: "Response Recorded" });
        invalidate();
      },
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-12 w-64 bg-card" />
        <Skeleton className="h-32 w-full bg-card" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-primary uppercase drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]">
          Resonance Fields
        </h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              className="border-primary text-primary hover:bg-primary/20"
              data-testid="button-open-resonance"
            >
              <Plus className="w-4 h-4 mr-2" /> Open Resonance
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border/50">
            <DialogHeader>
              <DialogTitle className="text-primary uppercase tracking-wider">
                Open Resonance Field
              </DialogTitle>
              <DialogDescription>
                Arms with matching tags will respond automatically.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs uppercase">Intent</Label>
                <Input
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  placeholder="e.g. Should we transmit a chord now?"
                  data-testid="input-resonance-intent"
                />
              </div>
              <div>
                <Label className="text-xs uppercase">Tags (comma sep)</Label>
                <Input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  data-testid="input-resonance-tags"
                />
              </div>
              <div>
                <Label className="text-xs uppercase">
                  Priority (0.0 - 1.0)
                </Label>
                <Input
                  type="number"
                  step={0.1}
                  min={0}
                  max={1}
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                  data-testid="input-resonance-priority"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!intent.trim() || create.isPending}
                className="bg-primary text-primary-foreground hover:bg-primary/80"
                onClick={() =>
                  create.mutate({
                    data: {
                      intent: intent.trim(),
                      tags: tags
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean),
                      priority,
                      ttlSeconds: 60,
                      constraints: {},
                    },
                  })
                }
                data-testid="button-confirm-open-resonance"
              >
                Open
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <FilterBar
        fields={filterFields}
        values={filter.values}
        setValue={filter.setValue}
        clearAll={filter.clearAll}
        hasActive={filter.hasActive}
        testIdPrefix="resonance-filter"
        resultCount={visibleResonance.length}
      />

      <div className="grid gap-4">
        {visibleResonance.map((res: Resonance) => (
          <Card key={res.id} className="bg-card border-border/50">
            <CardContent className="p-5">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-medium text-foreground">
                    {res.intent}
                  </h3>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {res.tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="text-[10px] bg-primary/10 text-primary"
                      >
                        {tag}
                      </Badge>
                    ))}
                    <span className="text-[10px] text-muted-foreground/70 ml-1">
                      pri {res.priority.toFixed(2)}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge
                    variant="outline"
                    className={`text-[10px] uppercase ${res.status === "active" ? "text-primary border-primary/30 animate-pulse" : res.status === "resolved" ? "text-primary border-primary/30" : "text-muted-foreground"}`}
                  >
                    {res.status}
                  </Badge>
                  {res.status === "active" && (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-primary/40 text-primary"
                        onClick={() =>
                          resolve.mutate({
                            id: res.id,
                            data: { strategy: "best" },
                          })
                        }
                        data-testid={`button-resolve-best-${res.id}`}
                      >
                        <Sparkles className="w-3 h-3 mr-1" /> Best
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-primary/40 text-primary"
                        onClick={() =>
                          resolve.mutate({
                            id: res.id,
                            data: { strategy: "merge" },
                          })
                        }
                        data-testid={`button-resolve-merge-${res.id}`}
                      >
                        <GitMerge className="w-3 h-3 mr-1" /> Merge
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {res.responses && res.responses.length > 0 && (
                <div className="mt-4 border-t border-border/50 pt-4">
                  <h4 className="text-xs font-mono text-muted-foreground uppercase mb-3">
                    Responses ({res.responses.length})
                  </h4>
                  <div className="space-y-2">
                    {res.responses.map((resp) => (
                      <div
                        key={resp.id}
                        className={`bg-background rounded border p-3 text-sm ${res.selectedResponseId === resp.id ? "border-primary shadow-[0_0_12px_rgba(0,255,255,0.2)]" : "border-border/50"}`}
                      >
                        <div className="flex justify-between items-center mb-2 font-mono text-[10px] text-muted-foreground">
                          <span>{resp.agentName || resp.agentId}</span>
                          <span className="text-primary">
                            score {resp.score.toFixed(2)}
                          </span>
                        </div>
                        <p className="text-foreground/80">{resp.output}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {res.status === "active" && (
                <ManualRespondForm
                  onSubmit={(agentId, output, score) =>
                    respond.mutate({
                      id: res.id,
                      data: { agentId, output, score },
                    })
                  }
                />
              )}

              {res.mergedOutput && (
                <div className="mt-4 border-t border-border/50 pt-4">
                  <h4 className="text-xs font-mono text-primary uppercase mb-2">
                    Resolution (coherence{" "}
                    {(res.coherenceScore ?? 0).toFixed(2)})
                  </h4>
                  <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-mono">
                    {res.mergedOutput}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {visibleResonance.length === 0 && (
          <div className="text-center p-12 border border-dashed border-border/50">
            <AudioWaveform className="w-8 h-8 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">
              {allResonance.length === 0
                ? "No resonance fields opened."
                : "No resonance fields match the current filters."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ManualRespondForm({
  onSubmit,
}: {
  onSubmit: (agentId: string, output: string, score: number) => void;
}) {
  const [agentId, setAgentId] = useState("");
  const [output, setOutput] = useState("");
  const [score, setScore] = useState(0.7);
  return (
    <div className="mt-4 border-t border-border/50 pt-4 space-y-2">
      <div className="text-xs font-mono text-muted-foreground uppercase">
        Add Response
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Input
          placeholder="agent id"
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className="text-xs"
        />
        <Input
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={score}
          onChange={(e) => setScore(Number(e.target.value))}
          className="text-xs"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!agentId.trim() || !output.trim()}
          onClick={() => {
            onSubmit(agentId.trim(), output.trim(), score);
            setAgentId("");
            setOutput("");
          }}
          className="text-xs"
        >
          Send
        </Button>
      </div>
      <Textarea
        placeholder="response output…"
        value={output}
        onChange={(e) => setOutput(e.target.value)}
        rows={2}
        className="text-xs font-mono"
      />
    </div>
  );
}
