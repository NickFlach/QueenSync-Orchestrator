import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Cpu,
  ListTodo,
  Radio,
  BrainCircuit,
  AudioWaveform,
  Terminal,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useHealthCheck,
  getHealthCheckQueryKey,
} from "@workspace/api-client-react";
import { useQueenSyncSocket } from "@/hooks/use-queensync-ws";

interface ShellProps {
  children: ReactNode;
}

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/arms", label: "Arms", icon: Cpu },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
  { href: "/signals", label: "Signals", icon: Radio },
  { href: "/memory", label: "Memory", icon: BrainCircuit },
  { href: "/resonance", label: "Resonance", icon: AudioWaveform },
  { href: "/adapters", label: "Adapters", icon: Activity },
  { href: "/logs", label: "Logs", icon: Terminal },
];

export function Shell({ children }: ShellProps) {
  const [location] = useLocation();
  const { data: health, isError } = useHealthCheck({
    query: {
      refetchInterval: 10000,
      queryKey: getHealthCheckQueryKey(),
    },
  });
  const { status: wsStatus } = useQueenSyncSocket();

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden font-mono selection:bg-primary/30">
      <aside className="w-64 border-r border-border/50 bg-card flex flex-col justify-between shrink-0">
        <div>
          <div className="h-16 flex flex-col justify-center px-6 border-b border-border/50">
            <span className="text-primary font-bold tracking-widest text-lg uppercase drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]">
              QueenSync
            </span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-[0.2em] mt-0.5">
              Kannaka Control Plane
            </span>
          </div>
          <nav className="p-4 space-y-1">
            {NAV_ITEMS.map((item) => {
              const isActive = location === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 text-sm font-medium transition-all group border border-transparent",
                    isActive
                      ? "bg-primary/10 text-primary border-primary/20 shadow-[inset_0_0_12px_rgba(0,255,255,0.05)]"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                  )}
                >
                  <Icon
                    className={cn(
                      "w-4 h-4",
                      isActive
                        ? "text-primary drop-shadow-[0_0_5px_rgba(0,255,255,0.8)]"
                        : "text-muted-foreground group-hover:text-foreground"
                    )}
                  />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-border/50 space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <div
              className={cn(
                "w-2 h-2 rounded-full shadow-[0_0_8px_currentColor]",
                health?.status === "ok"
                  ? "bg-primary text-primary"
                  : "bg-destructive text-destructive"
              )}
            />
            <span className="text-muted-foreground uppercase tracking-wider">
              {health?.status === "ok"
                ? "System Nominal"
                : isError
                  ? "Connection Lost"
                  : "Checking..."}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px]">
            <div
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                wsStatus === "open"
                  ? "bg-primary"
                  : wsStatus === "connecting"
                    ? "bg-yellow-400"
                    : "bg-destructive"
              )}
            />
            <span className="text-muted-foreground/70 uppercase tracking-wider">
              ws · {wsStatus}
            </span>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto relative">
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/5 via-background to-background" />
        <div className="relative h-full flex flex-col">{children}</div>
      </main>
    </div>
  );
}
