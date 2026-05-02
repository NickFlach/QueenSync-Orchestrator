import { useState } from "react";
import {
  useListArms,
  useRemoveArm,
  useTestArmConnection,
  useArmHeartbeat,
  useOnboardArm,
  useGetArm,
  getListArmsQueryKey,
  getGetArmQueryKey,
  Arm,
  OnboardArmBodyType,
  OnboardArmBodyAuthMethod,
  OnboardArmBodyResonanceMode,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Cpu, Trash2, Activity, Wifi, Plus, Eye } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const ARM_TYPES: OnboardArmBodyType[] = [
  "kannaktopus_arm",
  "human_configured",
  "api",
  "local_simulated",
  "replit_hosted",
  "openclaw",
  "external_webhook",
  "mcp",
];

const AUTH_METHODS: OnboardArmBodyAuthMethod[] = [
  "none",
  "api_key",
  "bearer",
  "jwt",
];

export default function ArmsRegistry() {
  const { data: arms, isLoading } = useListArms({
    query: { refetchInterval: 8000, queryKey: getListArmsQueryKey() },
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [type, setType] = useState("local_simulated");
  const [capabilities, setCapabilities] = useState("compose,build");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [authMethod, setAuthMethod] = useState("none");
  const [resonanceTags, setResonanceTags] = useState("dream,compose");
  const [description, setDescription] = useState("");

  const removeMutation = useRemoveArm({
    mutation: {
      onSuccess: () => {
        toast({ title: "Arm Removed" });
        queryClient.invalidateQueries({ queryKey: getListArmsQueryKey() });
      },
    },
  });
  const testMutation = useTestArmConnection({
    mutation: {
      onSuccess: (data) =>
        toast({
          title: data.ok ? "Connection OK" : "Connection Failed",
          description: data.message,
          variant: data.ok ? "default" : "destructive",
        }),
    },
  });
  const heartbeatMutation = useArmHeartbeat({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: getListArmsQueryKey() }),
    },
  });
  const onboardMutation = useOnboardArm({
    mutation: {
      onSuccess: () => {
        toast({ title: "Arm Onboarded", description: name });
        queryClient.invalidateQueries({ queryKey: getListArmsQueryKey() });
        setOpen(false);
        setName("");
      },
      onError: (e) =>
        toast({
          title: "Onboarding Failed",
          description: (e as Error).message,
          variant: "destructive",
        }),
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
          Arms Registry
        </h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              className="border-primary text-primary hover:bg-primary/20"
              data-testid="button-onboard-arm"
            >
              <Plus className="w-4 h-4 mr-2" /> Onboard Arm
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border/50 max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-primary uppercase tracking-wider">
                Onboard New Arm
              </DialogTitle>
              <DialogDescription>
                Register a new agent into the swarm.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs uppercase">Name</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    data-testid="input-arm-name"
                  />
                </div>
                <div>
                  <Label className="text-xs uppercase">Type</Label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger data-testid="select-arm-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ARM_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs uppercase">
                  Capabilities (comma sep)
                </Label>
                <Input
                  value={capabilities}
                  onChange={(e) => setCapabilities(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs uppercase">
                  Resonance Tags (comma sep)
                </Label>
                <Input
                  value={resonanceTags}
                  onChange={(e) => setResonanceTags(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs uppercase">
                    Endpoint URL (optional)
                  </Label>
                  <Input
                    value={endpointUrl}
                    onChange={(e) => setEndpointUrl(e.target.value)}
                    placeholder="https://…"
                  />
                </div>
                <div>
                  <Label className="text-xs uppercase">Auth Method</Label>
                  <Select value={authMethod} onValueChange={setAuthMethod}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AUTH_METHODS.map((a) => (
                        <SelectItem key={a} value={a}>
                          {a}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs uppercase">Description</Label>
                <Textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!name.trim() || onboardMutation.isPending}
                className="bg-primary text-primary-foreground hover:bg-primary/80"
                onClick={() =>
                  onboardMutation.mutate({
                    data: {
                      name: name.trim(),
                      type: type as OnboardArmBodyType,
                      capabilities: capabilities
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                      endpointUrl: endpointUrl.trim() || undefined,
                      authMethod: authMethod as OnboardArmBodyAuthMethod,
                      description: description.trim() || undefined,
                      resonanceTags: resonanceTags
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                      resonanceSensitivity: 0.5,
                      resonanceMode:
                        OnboardArmBodyResonanceMode.auto,
                    },
                  })
                }
                data-testid="button-confirm-onboard"
              >
                Onboard
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4">
        {arms?.map((arm: Arm) => (
          <Card
            key={arm.id}
            className="bg-card border-border/50 hover:border-primary/30 transition-colors"
          >
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div
                  className={`p-2 rounded-md ${arm.status === "idle" ? "bg-primary/10 text-primary" : arm.status === "failed" ? "bg-destructive/10 text-destructive" : arm.status === "busy" ? "bg-yellow-500/10 text-yellow-500" : "bg-muted text-muted-foreground"}`}
                >
                  <Cpu className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground flex items-center gap-2">
                    {arm.name}
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {arm.type}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={`text-[10px] uppercase ${arm.status === "idle" ? "text-primary border-primary/30" : arm.status === "failed" ? "text-destructive border-destructive/30" : arm.status === "busy" ? "text-yellow-500 border-yellow-500/30" : ""}`}
                    >
                      {arm.status}
                    </Badge>
                  </h3>
                  <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                    <span className="font-mono text-[10px] bg-background px-1.5 py-0.5 rounded text-foreground/70">
                      {arm.id}
                    </span>
                    <span className="text-[10px]">
                      caps: {arm.capabilities.join(", ")}
                    </span>
                    {arm.lastHeartbeat && (
                      <span className="text-[10px]">
                        sync {new Date(arm.lastHeartbeat).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  onClick={() => setDetailId(arm.id)}
                  data-testid={`button-detail-${arm.id}`}
                >
                  <Eye className="w-3 h-3 mr-1" /> Detail
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  onClick={() => testMutation.mutate({ id: arm.id })}
                  disabled={testMutation.isPending}
                >
                  <Wifi className="w-3 h-3 mr-1" /> Test
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  onClick={() => heartbeatMutation.mutate({ id: arm.id })}
                  disabled={heartbeatMutation.isPending}
                >
                  <Activity className="w-3 h-3 mr-1" /> Ping
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => removeMutation.mutate({ id: arm.id })}
                  disabled={removeMutation.isPending}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {arms?.length === 0 && (
          <div className="text-center p-12 border border-dashed border-border/50 rounded-lg">
            <Cpu className="w-8 h-8 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No arms registered.</p>
          </div>
        )}
      </div>

      <ArmDetailDialog id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

function ArmDetailDialog({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useGetArm(id ?? "", {
    query: {
      enabled: !!id,
      queryKey: getGetArmQueryKey(id ?? ""),
    },
  });
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-card border-border/50 max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-primary uppercase tracking-wider">
            {data?.name ?? "Arm"}
          </DialogTitle>
          <DialogDescription>
            {data?.id} · {data?.type}
          </DialogDescription>
        </DialogHeader>
        {isLoading || !data ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="space-y-3 text-sm">
            <div>
              <Label className="text-xs uppercase text-muted-foreground">
                Description
              </Label>
              <p className="text-foreground/80">
                {data.description ?? "—"}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs font-mono">
              <div>
                <span className="text-muted-foreground">capabilities</span>
                <div>{data.capabilities.join(", ")}</div>
              </div>
              <div>
                <span className="text-muted-foreground">resonance tags</span>
                <div>{(data.resonanceTags ?? []).join(", ")}</div>
              </div>
              <div>
                <span className="text-muted-foreground">endpoint</span>
                <div className="break-all">{data.endpointUrl ?? "—"}</div>
              </div>
              <div>
                <span className="text-muted-foreground">auth</span>
                <div>{data.authMethod}</div>
              </div>
              <div>
                <span className="text-muted-foreground">sensitivity</span>
                <div>{(data.resonanceSensitivity ?? 0).toFixed(2)}</div>
              </div>
              <div>
                <span className="text-muted-foreground">mode</span>
                <div>{data.resonanceMode}</div>
              </div>
            </div>
            <div>
              <Label className="text-xs uppercase text-muted-foreground">
                Recent Tasks ({data.recentTasks.length})
              </Label>
              <div className="space-y-1 mt-1 text-xs font-mono max-h-40 overflow-auto">
                {data.recentTasks.map((t) => (
                  <div
                    key={t.id}
                    className="bg-background border border-border/50 p-2 rounded"
                  >
                    <span className="text-primary mr-2">[{t.status}]</span>
                    {t.intent}
                  </div>
                ))}
                {data.recentTasks.length === 0 && (
                  <span className="text-muted-foreground">none</span>
                )}
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Memory contributions: {data.memoryContributionCount}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
