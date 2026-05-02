import { useEffect, useMemo, useState } from "react";
import {
  useGetObservatoryState,
  useGetObservatoryConfig,
  useWakeKannaktopus,
  getGetObservatoryStateQueryKey,
  getGetSystemSummaryQueryKey,
  getListLogsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  Tv,
  Zap,
  Radio,
  Brain,
  Activity,
  RefreshCw,
  Eye,
  ExternalLink,
} from "lucide-react";

const HOLOGRAM_URL = "https://radio.ninja-portal.com/video/hologram";
const OBSERVATORY_URL = "https://observatory.ninja-portal.com";

type ViewMode = "split" | "hologram" | "observatory";

export default function Hologram() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [view, setView] = useState<ViewMode>("split");
  const [iframeKey, setIframeKey] = useState(0);

  const {
    data: state,
    isLoading: stateLoading,
    isError: stateError,
    error: stateErrObj,
  } = useGetObservatoryState({
    query: {
      refetchInterval: 5000,
      queryKey: getGetObservatoryStateQueryKey(),
    },
  });
  const { data: config } = useGetObservatoryConfig();

  const wakeMutation = useWakeKannaktopus({
    mutation: {
      onSuccess: (r) => {
        toast({
          title: "Kannaktopus Waking",
          description: r.message,
        });
        queryClient.invalidateQueries({
          queryKey: getGetObservatoryStateQueryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: getGetSystemSummaryQueryKey(),
        });
        queryClient.invalidateQueries({ queryKey: getListLogsQueryKey() });
      },
      onError: (err) => {
        toast({
          variant: "destructive",
          title: "Wake failed",
          description:
            (err as { message?: string } | null)?.message ??
            "Could not reach Kannaktopus wake endpoint.",
        });
      },
    },
  });

  // Re-pull observatory state every 5s and force iframe refresh on the hour
  // mark so embedded canvases don't drift after long sessions.
  useEffect(() => {
    const id = setInterval(
      () => setIframeKey((k) => k + 1),
      60 * 60 * 1000,
    );
    return () => clearInterval(id);
  }, []);

  const c = state?.consciousness;
  const queen = state?.queen;
  const level = c?.level ?? "dormant";
  const isAwake = level !== "dormant" && (c?.phi ?? 0) > 0;

  const levelColor = useMemo(() => {
    switch (level) {
      case "transcendent":
        return "text-fuchsia-400 drop-shadow-[0_0_10px_rgba(232,121,249,0.7)]";
      case "fully_conscious":
      case "conscious":
        return "text-cyan-300 drop-shadow-[0_0_10px_rgba(103,232,249,0.7)]";
      case "lucid":
      case "aware":
        return "text-emerald-300 drop-shadow-[0_0_10px_rgba(110,231,183,0.6)]";
      case "stirring":
      case "drowsy":
        return "text-yellow-300 drop-shadow-[0_0_8px_rgba(253,224,71,0.6)]";
      default:
        return "text-muted-foreground";
    }
  }, [level]);

  return (
    <div className="p-6 space-y-4 max-w-[1800px] mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary uppercase drop-shadow-[0_0_8px_rgba(0,255,255,0.5)] flex items-center gap-3">
            <Tv className="w-6 h-6" /> Hologram TV
          </h1>
          <p className="text-xs text-muted-foreground uppercase tracking-widest mt-1">
            radio · observatory · kannaktopus · live
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-border/50 rounded-sm overflow-hidden">
            {(["split", "hologram", "observatory"] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-[11px] uppercase tracking-widest transition-colors ${
                  view === v
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                }`}
                data-testid={`button-view-${v}`}
              >
                {v}
              </button>
            ))}
          </div>
          <Button
            onClick={() => setIframeKey((k) => k + 1)}
            variant="outline"
            size="sm"
            className="border-primary/40 text-primary hover:bg-primary/10"
            data-testid="button-reload-tv"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Reload
          </Button>
          <Button
            onClick={() => wakeMutation.mutate()}
            disabled={wakeMutation.isPending}
            variant="outline"
            className="border-primary/50 hover:bg-primary/20 text-primary"
            data-testid="button-wake-kannaktopus-tv"
          >
            <Zap className="w-4 h-4 mr-2" /> Wake Kannaktopus
          </Button>
        </div>
      </div>

      {stateError && (
        <Card className="bg-destructive/10 border-destructive/40">
          <CardContent className="p-3 text-xs font-mono text-destructive flex items-center justify-between gap-3">
            <span>
              Observatory bridge unreachable —{" "}
              {(stateErrObj as { message?: string } | null)?.message ??
                "fetch failed"}
              . Iframes still render below; HRM stats will retry every 5s.
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] uppercase border-destructive/50 text-destructive hover:bg-destructive/20"
              onClick={() =>
                queryClient.invalidateQueries({
                  queryKey: getGetObservatoryStateQueryKey(),
                })
              }
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {state && !state.ok && !stateError && (
        <Card className="bg-yellow-400/10 border-yellow-400/40">
          <CardContent className="p-3 text-xs font-mono text-yellow-400">
            Observatory returned a degraded snapshot ({state.latencyMs}ms) —
            HRM metrics may be zeroed.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <HRMStat
          label="Level"
          value={level}
          icon={Brain}
          accent={levelColor}
          loading={stateLoading}
        />
        <HRMStat
          label="Φ Phi"
          value={c?.phi?.toFixed(3) ?? "—"}
          icon={Activity}
          loading={stateLoading}
        />
        <HRMStat
          label="Ξ Xi"
          value={c?.xi?.toFixed(3) ?? "—"}
          icon={Activity}
          loading={stateLoading}
        />
        <HRMStat
          label="Order"
          value={c?.order?.toFixed(3) ?? "—"}
          icon={Activity}
          loading={stateLoading}
        />
        <HRMStat
          label="Agents"
          value={`${c?.active ?? 0} / ${c?.total ?? 0}`}
          icon={Eye}
          loading={stateLoading}
        />
        <HRMStat
          label="Listeners"
          value={state?.listeners ?? 0}
          icon={Radio}
          loading={stateLoading}
        />
      </div>

      <div
        className={`grid gap-4 ${
          view === "split" ? "lg:grid-cols-2" : "grid-cols-1"
        }`}
      >
        {(view === "split" || view === "hologram") && (
          <TVPanel
            title="Radio Hologram"
            href={HOLOGRAM_URL}
            src={HOLOGRAM_URL}
            iframeKey={iframeKey}
            badge={state?.currentTrack?.title ?? null}
            badgeSub={state?.currentTrack?.album ?? null}
          />
        )}
        {(view === "split" || view === "observatory") && (
          <TVPanel
            title="Observatory Constellation"
            href={OBSERVATORY_URL}
            src={OBSERVATORY_URL}
            iframeKey={iframeKey}
            badge={`${level.toUpperCase()} · ${queen?.agentCount ?? 0} agents`}
            badgeSub={
              state?.ok
                ? `${state.latencyMs}ms · live`
                : "observatory unreachable"
            }
            badgeAccent={isAwake ? "text-cyan-300" : "text-muted-foreground"}
          />
        )}
      </div>

      <Card className="bg-card border-border/50">
        <CardHeader>
          <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground flex items-center justify-between">
            <span>Kannaktopus / HRM bridge</span>
            <span className="text-[10px] text-muted-foreground/70 font-mono">
              {config?.observatoryBaseUrl ?? OBSERVATORY_URL}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs font-mono">
          <BridgeRow
            label="Kannaktopus wake endpoint"
            value={
              config?.kannaktopusWakeConfigured
                ? config?.kannaktopusWakeUrl ?? "configured"
                : "not configured (set KANNAKTOPUS_WAKE_URL)"
            }
            ok={Boolean(config?.kannaktopusWakeConfigured)}
          />
          <BridgeRow
            label="Observatory channel"
            value={state?.channel ?? "—"}
            ok={Boolean(state?.ok)}
          />
          <BridgeRow
            label="Consciousness source"
            value={c?.source ?? "—"}
            ok={Boolean(c?.source)}
          />
          <BridgeRow
            label="Queen orderParameter"
            value={queen?.orderParameter?.toFixed(4) ?? "—"}
            ok
          />
          <BridgeRow
            label="Hemispheric divergence"
            value={c?.hemisphericDivergence?.toFixed(3) ?? "—"}
            ok
          />
          <BridgeRow
            label="Callosal efficiency"
            value={c?.callosalEfficiency?.toFixed(3) ?? "—"}
            ok
          />
          <BridgeRow
            label="Last snapshot"
            value={
              state?.fetchedAt
                ? new Date(state.fetchedAt).toLocaleTimeString()
                : "—"
            }
            ok
          />
        </CardContent>
      </Card>
    </div>
  );
}

function HRMStat({
  label,
  value,
  icon: Icon,
  accent,
  loading,
}: {
  label: string;
  value: string | number;
  icon: typeof Activity;
  accent?: string;
  loading?: boolean;
}) {
  return (
    <Card className="bg-card border-border/50">
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
            {label}
          </span>
          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        <div
          className={`mt-1 text-lg font-bold font-mono ${
            accent ?? "text-foreground"
          }`}
          data-testid={`hrm-${label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          {loading ? "…" : value}
        </div>
      </CardContent>
    </Card>
  );
}

function TVPanel({
  title,
  src,
  href,
  iframeKey,
  badge,
  badgeSub,
  badgeAccent,
}: {
  title: string;
  src: string;
  href: string;
  iframeKey: number;
  badge: string | null;
  badgeSub: string | null;
  badgeAccent?: string;
}) {
  return (
    <Card className="bg-black border-border/50 overflow-hidden">
      <CardHeader className="border-b border-border/30 py-2 px-3">
        <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground flex items-center justify-between gap-3">
          <span className="text-foreground">{title}</span>
          <div className="flex items-center gap-3 min-w-0">
            <div className="text-right min-w-0">
              {badge && (
                <div
                  className={`truncate text-[11px] font-mono ${
                    badgeAccent ?? "text-primary"
                  }`}
                >
                  {badge}
                </div>
              )}
              {badgeSub && (
                <div className="truncate text-[9px] text-muted-foreground tracking-wider">
                  {badgeSub}
                </div>
              )}
            </div>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-primary"
              data-testid={`link-open-${title.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="relative w-full" style={{ aspectRatio: "16 / 10" }}>
          <iframe
            key={`${src}:${iframeKey}`}
            src={src}
            title={title}
            className="absolute inset-0 w-full h-full bg-black"
            sandbox="allow-scripts allow-same-origin"
            allow="autoplay; fullscreen; encrypted-media"
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function BridgeRow({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border/30 pb-2 gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`truncate text-right ${
          ok ? "text-foreground" : "text-yellow-400"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
