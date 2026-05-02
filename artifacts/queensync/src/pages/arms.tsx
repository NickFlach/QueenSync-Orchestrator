import { useListArms, useRemoveArm, useTestArmConnection, useArmHeartbeat, getListArmsQueryKey, Arm } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Cpu, Trash2, Activity, Wifi } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function ArmsRegistry() {
  const { data: arms, isLoading } = useListArms({ query: { refetchInterval: 5000, queryKey: undefined as never } });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const removeMutation = useRemoveArm({
    mutation: {
      onSuccess: () => {
        toast({ title: "Arm Removed", description: "Agent disconnected from swarm." });
        queryClient.invalidateQueries({ queryKey: getListArmsQueryKey() });
      }
    }
  });

  const testMutation = useTestArmConnection({
    mutation: {
      onSuccess: (data) => {
        toast({ title: data.ok ? "Connection OK" : "Connection Failed", description: data.message });
      }
    }
  });

  const heartbeatMutation = useArmHeartbeat({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListArmsQueryKey() });
      }
    }
  });

  if (isLoading) {
    return <div className="p-6 space-y-4"><Skeleton className="h-12 w-64 bg-card" /><Skeleton className="h-32 w-full bg-card" /><Skeleton className="h-32 w-full bg-card" /></div>;
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-primary uppercase drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]">Arms Registry</h1>
        <Button variant="outline" className="border-primary text-primary hover:bg-primary/20"><Cpu className="w-4 h-4 mr-2"/> Onboard Arm</Button>
      </div>

      <div className="grid gap-4">
        {arms?.map((arm: Arm) => (
          <Card key={arm.id} className="bg-card border-border/50 hover:border-primary/30 transition-colors">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`p-2 rounded-md ${arm.status === 'idle' ? 'bg-primary/10 text-primary' : arm.status === 'failed' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>
                  <Cpu className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground flex items-center gap-2">
                    {arm.name}
                    <Badge variant="outline" className="text-[10px] uppercase">{arm.type}</Badge>
                    <Badge variant="outline" className={`text-[10px] uppercase ${arm.status === 'idle' ? 'text-primary border-primary/30' : arm.status === 'failed' ? 'text-destructive border-destructive/30' : ''}`}>
                      {arm.status}
                    </Badge>
                  </h3>
                  <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                    <span className="font-mono text-[10px] bg-background px-1.5 py-0.5 rounded text-foreground/70">{arm.id}</span>
                    {arm.lastHeartbeat && <span>Last sync: {new Date(arm.lastHeartbeat).toLocaleTimeString()}</span>}
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" className="h-8" onClick={() => testMutation.mutate({ id: arm.id })} disabled={testMutation.isPending}>
                  <Wifi className="w-3 h-3 mr-1" /> Test
                </Button>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => heartbeatMutation.mutate({ id: arm.id })} disabled={heartbeatMutation.isPending}>
                  <Activity className="w-3 h-3 mr-1" /> Ping
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => removeMutation.mutate({ id: arm.id })} disabled={removeMutation.isPending}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {arms?.length === 0 && (
          <div className="text-center p-12 border border-dashed border-border/50 rounded-lg">
            <Cpu className="w-8 h-8 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No arms registered to the swarm.</p>
          </div>
        )}
      </div>
    </div>
  );
}