export type MonitorKind =
  | "radio-hologram"
  | "observatory"
  | "logs"
  | "arms"
  | "resonance"
  | "tasks"
  | "signals"
  | "memory-stream"
  | "hrm-stats"
  | "adapters"
  | "iframe";

export interface MonitorConfig {
  id: string;
  kind: MonitorKind;
  title?: string;
  url?: string;
  /** grid column span (1..12) */
  cw: number;
  /** grid row span (1..12) */
  ch: number;
}

export interface MonitorTypeMeta {
  kind: MonitorKind;
  label: string;
  defaultTitle: string;
  defaultCw: number;
  defaultCh: number;
  needsUrl?: boolean;
  description: string;
}

export const MONITOR_TYPES: Record<MonitorKind, MonitorTypeMeta> = {
  "radio-hologram": {
    kind: "radio-hologram",
    label: "Radio Hologram",
    defaultTitle: "[radio.hologram]",
    defaultCw: 7,
    defaultCh: 7,
    description: "Live video stream from the Radio service",
  },
  observatory: {
    kind: "observatory",
    label: "Observatory Constellation",
    defaultTitle: "[obs.constellation]",
    defaultCw: 5,
    defaultCh: 7,
    description: "Live constellation map from the Observatory",
  },
  logs: {
    kind: "logs",
    label: "Live Logs Stream",
    defaultTitle: "[logs.stream]",
    defaultCw: 4,
    defaultCh: 5,
    description: "Streaming server log entries",
  },
  arms: {
    kind: "arms",
    label: "Arms Heartbeat",
    defaultTitle: "[arms.heartbeat]",
    defaultCw: 3,
    defaultCh: 5,
    description: "Status of every Kannaka arm",
  },
  resonance: {
    kind: "resonance",
    label: "Resonance Fields",
    defaultTitle: "[res.fields]",
    defaultCw: 4,
    defaultCh: 5,
    description: "Active resonance fields with live strengths",
  },
  tasks: {
    kind: "tasks",
    label: "Recent Tasks",
    defaultTitle: "[tasks.queue]",
    defaultCw: 4,
    defaultCh: 5,
    description: "Recently dispatched tasks across the swarm",
  },
  signals: {
    kind: "signals",
    label: "Inbound Signals",
    defaultTitle: "[signals.in]",
    defaultCw: 4,
    defaultCh: 5,
    description: "Recent inbound signals to the queen",
  },
  "memory-stream": {
    kind: "memory-stream",
    label: "Memory Stream",
    defaultTitle: "[mem.stream]",
    defaultCw: 4,
    defaultCh: 5,
    description: "Latest memory events and dream-lite compactions",
  },
  "hrm-stats": {
    kind: "hrm-stats",
    label: "HRM Snapshot",
    defaultTitle: "[hrm.snapshot]",
    defaultCw: 3,
    defaultCh: 4,
    description: "Live consciousness / HRM telemetry",
  },
  adapters: {
    kind: "adapters",
    label: "Adapter Health",
    defaultTitle: "[adapters.health]",
    defaultCw: 3,
    defaultCh: 4,
    description: "Radio + Observatory adapter heartbeats",
  },
  iframe: {
    kind: "iframe",
    label: "Custom URL",
    defaultTitle: "[custom.iframe]",
    defaultCw: 4,
    defaultCh: 5,
    needsUrl: true,
    description: "Embed any URL as a monitor",
  },
};

export const DEFAULT_LAYOUT: MonitorConfig[] = [
  { id: "m-radio", kind: "radio-hologram", cw: 7, ch: 7 },
  { id: "m-obs", kind: "observatory", cw: 5, ch: 7 },
  { id: "m-logs", kind: "logs", cw: 4, ch: 5 },
  { id: "m-arms", kind: "arms", cw: 3, ch: 5 },
  { id: "m-res", kind: "resonance", cw: 5, ch: 5 },
];
