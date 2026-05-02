import { useMemo, useState } from "react";
import {
  useListTasks,
  useRetryTask,
  useCreateTask,
  getListTasksQueryKey,
  Task,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FilterBar,
  useFilterState,
  uniqueSorted,
  type FilterField,
} from "@/components/filter-bar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ListTodo, RotateCw, Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function TasksRouter() {
  const { data: tasks, isLoading } = useListTasks({
    query: { refetchInterval: 6000, queryKey: getListTasksQueryKey() },
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState("");
  const [capability, setCapability] = useState("build");
  const [priority, setPriority] = useState(5);

  const allTasks = (tasks ?? []) as Task[];
  const filterFields: FilterField[] = useMemo(
    () => [
      {
        kind: "select",
        key: "status",
        label: "Status",
        placeholder: "All statuses",
        options: [
          { value: "pending", label: "pending" },
          { value: "active", label: "active" },
          { value: "completed", label: "completed" },
          { value: "failed", label: "failed" },
        ],
      },
      {
        kind: "select",
        key: "agent",
        label: "Assigned",
        placeholder: "All agents",
        options: uniqueSorted(allTasks.map((t) => t.assignedArmId)).map(
          (v) => ({ value: v, label: v }),
        ),
      },
      {
        kind: "select",
        key: "source",
        label: "Source",
        placeholder: "All sources",
        options: uniqueSorted(allTasks.map((t) => t.source)).map((v) => ({
          value: v,
          label: v,
        })),
      },
      {
        kind: "text",
        key: "q",
        label: "Search intent",
        placeholder: "search intent or capability…",
      },
    ],
    [allTasks],
  );
  const filter = useFilterState(filterFields);
  const visibleTasks = useMemo(() => {
    const q = filter.values.q?.trim().toLowerCase();
    return allTasks.filter((t) => {
      if (filter.values.status && t.status !== filter.values.status) return false;
      if (filter.values.agent && (t.assignedArmId ?? "") !== filter.values.agent)
        return false;
      if (filter.values.source && t.source !== filter.values.source) return false;
      if (q) {
        const hay =
          `${t.intent} ${t.requiredCapability} ${t.id} ${t.result ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allTasks, filter.values]);

  const retryMutation = useRetryTask({
    mutation: {
      onSuccess: () => {
        toast({ title: "Task Retried", description: "Task re-queued for processing." });
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      },
    },
  });

  const createMutation = useCreateTask({
    mutation: {
      onSuccess: () => {
        toast({ title: "Task Dispatched", description: `${intent}` });
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        setOpen(false);
        setIntent("");
      },
      onError: (err) => {
        toast({
          title: "Dispatch Failed",
          description: (err as Error).message,
          variant: "destructive",
        });
      },
    },
  });

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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-primary uppercase drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]">
          Task Router
        </h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              className="border-primary text-primary hover:bg-primary/20"
              data-testid="button-dispatch-task"
            >
              <Plus className="w-4 h-4 mr-2" /> Dispatch Task
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border/50">
            <DialogHeader>
              <DialogTitle className="text-primary uppercase tracking-wider">
                Dispatch New Task
              </DialogTitle>
              <DialogDescription>
                Routed to the best-matching arm by capability.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs uppercase">Intent</Label>
                <Input
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  placeholder="e.g. Compose a chord transmission"
                  data-testid="input-task-intent"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs uppercase">Capability</Label>
                  <Input
                    value={capability}
                    onChange={(e) => setCapability(e.target.value)}
                    data-testid="input-task-capability"
                  />
                </div>
                <div>
                  <Label className="text-xs uppercase">Priority (1-10)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={priority}
                    onChange={(e) => setPriority(Number(e.target.value))}
                    data-testid="input-task-priority"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={!intent.trim() || createMutation.isPending}
                onClick={() =>
                  createMutation.mutate({
                    data: {
                      intent: intent.trim(),
                      requiredCapability: capability.trim() || "build",
                      priority,
                      source: "console",
                      context: {},
                    },
                  })
                }
                data-testid="button-confirm-dispatch"
                className="bg-primary text-primary-foreground hover:bg-primary/80"
              >
                Dispatch
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
        testIdPrefix="tasks-filter"
        resultCount={visibleTasks.length}
      />

      <div className="grid gap-3">
        {visibleTasks.map((task: Task) => (
          <Card
            key={task.id}
            className="bg-card border-border/50 rounded-none border-l-2 data-[status=failed]:border-l-destructive data-[status=completed]:border-l-primary data-[status=pending]:border-l-muted"
            data-status={task.status}
          >
            <CardContent className="p-4 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge
                    variant="outline"
                    className={`text-[10px] uppercase font-mono ${task.status === "completed" ? "text-primary border-primary/30" : task.status === "failed" ? "text-destructive border-destructive/30" : "text-muted-foreground border-border"}`}
                  >
                    {task.status}
                  </Badge>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {task.id}
                  </span>
                </div>
                <h3 className="font-medium text-foreground">{task.intent}</h3>
                <div className="text-xs text-muted-foreground mt-2 font-mono">
                  Req: {task.requiredCapability} | Pri: {task.priority} | Src:{" "}
                  {task.source}
                </div>
                {task.result && (
                  <div className="text-xs text-foreground/70 mt-2 italic">
                    → {task.result}
                  </div>
                )}
              </div>

              <div className="flex flex-col items-end">
                {task.status === "failed" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
                    onClick={() => retryMutation.mutate({ id: task.id })}
                    disabled={retryMutation.isPending}
                  >
                    <RotateCw className="w-3 h-3 mr-1" /> Retry
                  </Button>
                )}
                {task.assignedArmId && (
                  <div className="text-[10px] font-mono text-primary/70 mt-2">
                    Assigned: {task.assignedArmId}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {visibleTasks.length === 0 && (
          <div className="text-center p-12 border border-dashed border-border/50">
            <ListTodo className="w-8 h-8 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">
              {allTasks.length === 0
                ? "No tasks in the router."
                : "No tasks match the current filters."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
