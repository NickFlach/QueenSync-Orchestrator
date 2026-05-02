import { useListTasks, useRetryTask, getListTasksQueryKey, Task } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ListTodo, RotateCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function TasksRouter() {
  const { data: tasks, isLoading } = useListTasks({ query: { refetchInterval: 4000, queryKey: undefined as never } });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const retryMutation = useRetryTask({
    mutation: {
      onSuccess: () => {
        toast({ title: "Task Retried", description: "Task re-queued for processing." });
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      }
    }
  });

  if (isLoading) {
    return <div className="p-6 space-y-4"><Skeleton className="h-12 w-64 bg-card" /><Skeleton className="h-32 w-full bg-card" /><Skeleton className="h-32 w-full bg-card" /></div>;
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-primary uppercase drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]">Task Router</h1>
        <Button variant="outline" className="border-primary text-primary hover:bg-primary/20"><ListTodo className="w-4 h-4 mr-2"/> Dispatch Task</Button>
      </div>

      <div className="grid gap-3">
        {tasks?.map((task: Task) => (
          <Card key={task.id} className="bg-card border-border/50 rounded-none border-l-2 data-[status=failed]:border-l-destructive data-[status=completed]:border-l-primary data-[status=pending]:border-l-muted" data-status={task.status}>
            <CardContent className="p-4 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className={`text-[10px] uppercase font-mono ${task.status === 'completed' ? 'text-primary border-primary/30' : task.status === 'failed' ? 'text-destructive border-destructive/30' : 'text-muted-foreground border-border'}`}>
                    {task.status}
                  </Badge>
                  <span className="font-mono text-[10px] text-muted-foreground">{task.id}</span>
                </div>
                <h3 className="font-medium text-foreground">{task.intent}</h3>
                <div className="text-xs text-muted-foreground mt-2 font-mono">
                  Req: {task.requiredCapability} | Pri: {task.priority} | Src: {task.source}
                </div>
              </div>
              
              <div className="flex flex-col items-end">
                {task.status === 'failed' && (
                  <Button size="sm" variant="outline" className="h-7 text-xs border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => retryMutation.mutate({ id: task.id })} disabled={retryMutation.isPending}>
                    <RotateCw className="w-3 h-3 mr-1" /> Retry
                  </Button>
                )}
                {task.assignedArmId && <div className="text-[10px] font-mono text-primary/70 mt-2">Assigned: {task.assignedArmId.substring(0,8)}...</div>}
              </div>
            </CardContent>
          </Card>
        ))}
        {tasks?.length === 0 && (
          <div className="text-center p-12 border border-dashed border-border/50">
            <ListTodo className="w-8 h-8 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No tasks in the router.</p>
          </div>
        )}
      </div>
    </div>
  );
}