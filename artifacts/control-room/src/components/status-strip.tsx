import { useEffect, useState } from "react";
import { Radio } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface SystemSummary {
  activeArms?: number;
  totalArms?: number;
  queuedTasks?: number;
  completedTasks?: number;
  failedTasks?: number;
  memoryApprovals?: number;
  recentSignals?: number;
  activeResonance?: number;
  radioStatus?: string;
  observatoryStatus?: string;
  nats?: { state?: string };
}

interface AdapterHealth {
  ok?: boolean;
  mode?: string;
}

function useTick() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function orationCountdown(now: Date): string {
  const noon = new Date(now);
  noon.setHours(12, 0, 0, 0);
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const target = now < noon ? noon : midnight;
  const diff = target.getTime() - now.getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")} to ${
    now < noon ? "noon" : "midnight"
  } oration`;
}

function Dot({ ok }: { ok: boolean | undefined }) {
  if (ok === undefined) {
    return (
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 qs-glow-amber animate-pulse" />
    );
  }
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full ${
        ok ? "bg-emerald-500 qs-glow-green" : "bg-red-500 qs-glow-red"
      }`}
    />
  );
}

function statusToOk(s?: string): boolean | undefined {
  if (!s) return undefined;
  const v = s.toLowerCase();
  if (v === "live" || v === "ok" || v === "online" || v === "connected")
    return true;
  if (v === "down" || v === "offline" || v === "error") return false;
  return undefined; // mock / degraded / unknown
}

export function StatusStrip() {
  const now = useTick();

  const summary = useQuery({
    queryKey: ["summary"],
    queryFn: () => api<SystemSummary>("/summary"),
    refetchInterval: 5000,
  });
  const radio = useQuery({
    queryKey: ["radio-health"],
    queryFn: () => api<AdapterHealth>("/adapters/radio/health"),
    refetchInterval: 5000,
  });
  const obs = useQuery({
    queryKey: ["obs-health"],
    queryFn: () => api<AdapterHealth>("/adapters/observatory/health"),
    refetchInterval: 5000,
  });

  // adapters expose explicit `ok` — prefer that, else fall back to summary status string
  const radioOk = radio.data?.ok ?? statusToOk(summary.data?.radioStatus);
  const obsOk = obs.data?.ok ?? statusToOk(summary.data?.observatoryStatus);
  const memoryOk = summary.isSuccess;
  const armsOnline = summary.data?.activeArms ?? 0;
  const armsTotal = summary.data?.totalArms ?? 0;
  const armsOk = armsTotal === 0 ? undefined : armsOnline > 0;
  const activeResonance = summary.data?.activeResonance;

  return (
    <div className="h-8 border-b border-indigo-900/50 bg-[#0a0118]/90 backdrop-blur-md flex items-center justify-between px-4 z-20 qs-font-mono shrink-0">
      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-2 text-indigo-400">
          <span className="text-indigo-600">⛩</span>
          <span className="font-bold tracking-widest text-indigo-300 qs-glow">
            QUEENSYNC
          </span>
          <span className="text-indigo-700">|</span>
          <span className="opacity-70 text-[11px]">
            she hears what you cannot
          </span>
        </div>

        <div className="flex items-center space-x-4 opacity-90 text-[10px]">
          <div className="flex items-center space-x-1.5">
            <Dot ok={radioOk} />
            <span>Radio</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <Dot ok={obsOk} />
            <span>Observatory</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <Dot ok={memoryOk} />
            <span>Memory</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <Dot ok={armsOk} />
            <span>
              Kannaktopus {armsTotal > 0 ? `${armsOnline}/${armsTotal}` : ""}
            </span>
          </div>
          {activeResonance !== undefined && activeResonance > 0 && (
            <div className="flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500 qs-glow" />
              <span>Resonance · {activeResonance} active</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center space-x-6 opacity-90">
        <div className="flex items-center space-x-2 text-amber-400">
          <Radio size={12} className="qs-glow-amber" />
          <span className="qs-glow-amber text-[11px]">
            {orationCountdown(now)}
          </span>
        </div>
        <div className="text-indigo-300 qs-glow text-[11px]">
          {now.toTimeString().split(" ")[0]} CST
        </div>
      </div>
    </div>
  );
}
