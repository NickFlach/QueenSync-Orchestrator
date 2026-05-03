import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_LAYOUT,
  type MonitorConfig,
  type MonitorKind,
  MONITOR_TYPES,
} from "@/lib/monitor-types";

const STORAGE_KEY = "queensync.control-room.layout.v1";

function loadLayout(): MonitorConfig[] {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as MonitorConfig[];
    if (!Array.isArray(parsed)) return DEFAULT_LAYOUT;
    return parsed.filter(
      (m) => m && typeof m.id === "string" && m.kind in MONITOR_TYPES,
    );
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function saveLayout(layout: MonitorConfig[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // ignore quota errors
  }
}

let counter = 0;
function genId(kind: MonitorKind): string {
  counter += 1;
  return `m-${kind}-${Date.now().toString(36)}-${counter}`;
}

export function useLayout() {
  const [layout, setLayout] = useState<MonitorConfig[]>(() => loadLayout());

  useEffect(() => {
    saveLayout(layout);
  }, [layout]);

  const addMonitor = useCallback(
    (kind: MonitorKind, opts?: { url?: string; title?: string }) => {
      const meta = MONITOR_TYPES[kind];
      const next: MonitorConfig = {
        id: genId(kind),
        kind,
        title: opts?.title,
        url: opts?.url,
        cw: meta.defaultCw,
        ch: meta.defaultCh,
      };
      setLayout((cur) => [...cur, next]);
      return next;
    },
    [],
  );

  const removeMonitor = useCallback((id: string) => {
    setLayout((cur) => cur.filter((m) => m.id !== id));
  }, []);

  const removeByKind = useCallback((kind: MonitorKind) => {
    let removed = 0;
    setLayout((cur) => {
      const next = cur.filter((m) => {
        if (m.kind === kind) {
          removed += 1;
          return false;
        }
        return true;
      });
      return next;
    });
    return removed;
  }, []);

  const clearAll = useCallback(() => {
    setLayout([]);
  }, []);

  const resizeMonitor = useCallback(
    (id: string, dcw: number, dch: number) => {
      setLayout((cur) =>
        cur.map((m) =>
          m.id === id
            ? {
                ...m,
                cw: Math.max(2, Math.min(12, m.cw + dcw)),
                ch: Math.max(2, Math.min(12, m.ch + dch)),
              }
            : m,
        ),
      );
    },
    [],
  );

  const moveMonitor = useCallback((id: string, dir: -1 | 1) => {
    setLayout((cur) => {
      const idx = cur.findIndex((m) => m.id === id);
      if (idx < 0) return cur;
      const target = idx + dir;
      if (target < 0 || target >= cur.length) return cur;
      const next = cur.slice();
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return next;
    });
  }, []);

  const resetLayout = useCallback(() => setLayout(DEFAULT_LAYOUT), []);

  return {
    layout,
    addMonitor,
    removeMonitor,
    removeByKind,
    clearAll,
    resizeMonitor,
    moveMonitor,
    resetLayout,
  };
}
