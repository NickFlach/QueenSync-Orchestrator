import {
  Activity,
  Cpu,
  Database,
  Globe,
  Hexagon,
  Network,
  Radio,
  Sparkles,
  Terminal,
  Waves,
  Workflow,
} from "lucide-react";
import { MonitorShell } from "@/components/monitor-shell";
import {
  MONITOR_TYPES,
  type MonitorConfig,
} from "@/lib/monitor-types";
import { LogsMonitor } from "./logs-monitor";
import { ArmsMonitor } from "./arms-monitor";
import { ResonanceMonitor } from "./resonance-monitor";
import { TasksMonitor } from "./tasks-monitor";
import { SignalsMonitor } from "./signals-monitor";
import { MemoryMonitor } from "./memory-monitor";
import { HrmMonitor } from "./hrm-monitor";
import { AdaptersMonitor } from "./adapters-monitor";

const ICONS = {
  "radio-hologram": <Radio size={10} />,
  observatory: <Network size={10} />,
  logs: <Terminal size={10} />,
  arms: <Cpu size={10} />,
  resonance: <Hexagon size={10} />,
  tasks: <Workflow size={10} />,
  signals: <Waves size={10} />,
  "memory-stream": <Database size={10} />,
  "hrm-stats": <Sparkles size={10} />,
  adapters: <Activity size={10} />,
  iframe: <Globe size={10} />,
} as const;

interface Props {
  monitor: MonitorConfig;
  onClose: () => void;
  onGrow: () => void;
  onShrink: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
}

export function MonitorRenderer({
  monitor,
  onClose,
  onGrow,
  onShrink,
  onMoveLeft,
  onMoveRight,
}: Props) {
  const meta = MONITOR_TYPES[monitor.kind];
  const title = monitor.title || meta.defaultTitle;

  const shellProps = {
    cw: monitor.cw,
    ch: monitor.ch,
    icon: ICONS[monitor.kind],
    onClose,
    onGrow,
    onShrink,
    onMoveLeft,
    onMoveRight,
  };

  switch (monitor.kind) {
    case "radio-hologram":
      return (
        <MonitorShell
          {...shellProps}
          title={title}
          status={{ label: "LIVE", tone: "ok" }}
        >
          <iframe
            src="https://radio.ninja-portal.com/video/hologram"
            className="w-full h-full border-0 opacity-90 mix-blend-screen bg-black"
            title="Radio Hologram"
            sandbox="allow-scripts allow-same-origin"
          />
          <div className="absolute bottom-2 right-2 qs-font-mono text-[10px] text-indigo-400 bg-black/50 px-1 py-0.5 rounded">
            RES: 1080p · FPS: 30
          </div>
        </MonitorShell>
      );
    case "observatory":
      return (
        <MonitorShell
          {...shellProps}
          title={title}
          status={{ label: "LIVE", tone: "ok" }}
        >
          <iframe
            src="https://observatory.ninja-portal.com"
            className="w-full h-full border-0 opacity-85 bg-black"
            title="Observatory"
            sandbox="allow-scripts allow-same-origin"
          />
        </MonitorShell>
      );
    case "iframe":
      return (
        <MonitorShell
          {...shellProps}
          title={title}
          status={{ label: "EMBED", tone: "muted" }}
        >
          {monitor.url ? (
            <iframe
              src={monitor.url}
              className="w-full h-full border-0 bg-black"
              title={title}
              sandbox="allow-scripts allow-same-origin allow-forms"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-indigo-500 qs-font-mono text-[11px]">
              no url configured
            </div>
          )}
        </MonitorShell>
      );
    case "logs":
      return (
        <MonitorShell {...shellProps} title={title}>
          <LogsMonitor />
        </MonitorShell>
      );
    case "arms":
      return (
        <MonitorShell {...shellProps} title={title}>
          <ArmsMonitor />
        </MonitorShell>
      );
    case "resonance":
      return (
        <MonitorShell {...shellProps} title={title}>
          <ResonanceMonitor />
        </MonitorShell>
      );
    case "tasks":
      return (
        <MonitorShell {...shellProps} title={title}>
          <TasksMonitor />
        </MonitorShell>
      );
    case "signals":
      return (
        <MonitorShell {...shellProps} title={title}>
          <SignalsMonitor />
        </MonitorShell>
      );
    case "memory-stream":
      return (
        <MonitorShell {...shellProps} title={title}>
          <MemoryMonitor />
        </MonitorShell>
      );
    case "hrm-stats":
      return (
        <MonitorShell {...shellProps} title={title}>
          <HrmMonitor />
        </MonitorShell>
      );
    case "adapters":
      return (
        <MonitorShell {...shellProps} title={title}>
          <AdaptersMonitor />
        </MonitorShell>
      );
  }
}
