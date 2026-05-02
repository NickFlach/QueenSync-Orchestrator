import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListArmsQueryKey,
  getListTasksQueryKey,
  getListSignalsQueryKey,
  getListMemoryQueryKey,
  getListLogsQueryKey,
  getListResonanceQueryKey,
  getListActiveResonanceQueryKey,
  getGetSystemSummaryQueryKey,
} from "@workspace/api-client-react";

export type WsStatus = "idle" | "connecting" | "open" | "closed";

const EVENT_TO_KEYS: Record<string, (() => readonly unknown[])[]> = {
  arm_registered: [getListArmsQueryKey, getGetSystemSummaryQueryKey],
  arm_removed: [getListArmsQueryKey, getGetSystemSummaryQueryKey],
  arms_updated: [getListArmsQueryKey, getGetSystemSummaryQueryKey],
  task_created: [getListTasksQueryKey, getGetSystemSummaryQueryKey],
  task_assigned: [getListTasksQueryKey, getGetSystemSummaryQueryKey],
  task_completed: [getListTasksQueryKey, getGetSystemSummaryQueryKey],
  task_failed: [getListTasksQueryKey, getGetSystemSummaryQueryKey],
  task_updated: [getListTasksQueryKey, getGetSystemSummaryQueryKey],
  signal_received: [getListSignalsQueryKey, getGetSystemSummaryQueryKey],
  memory_event: [getListMemoryQueryKey, getGetSystemSummaryQueryKey],
  log_event: [getListLogsQueryKey],
  resonance_created: [
    getListResonanceQueryKey,
    getListActiveResonanceQueryKey,
    getGetSystemSummaryQueryKey,
  ],
  resonance_response: [
    getListResonanceQueryKey,
    getListActiveResonanceQueryKey,
  ],
  resonance_resolved: [
    getListResonanceQueryKey,
    getListActiveResonanceQueryKey,
    getGetSystemSummaryQueryKey,
  ],
  resonance_updated: [
    getListResonanceQueryKey,
    getListActiveResonanceQueryKey,
  ],
  adapter_pull: [
    getListSignalsQueryKey,
    getListResonanceQueryKey,
    getListActiveResonanceQueryKey,
    getGetSystemSummaryQueryKey,
  ],
};

interface QueenSyncEvent {
  type: string;
  data: unknown;
  ts: number;
}

export function useQueenSyncSocket() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<WsStatus>("idle");
  const [lastEvent, setLastEvent] = useState<QueenSyncEvent | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${window.location.host}/ws`;
      setStatus("connecting");
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => setStatus("open");
      ws.onclose = () => {
        setStatus("closed");
        if (cancelled) return;
        retryRef.current = window.setTimeout(connect, 2000);
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* noop */
        }
      };
      ws.onmessage = (msg) => {
        try {
          const evt = JSON.parse(msg.data) as QueenSyncEvent;
          setLastEvent(evt);
          const keys = EVENT_TO_KEYS[evt.type];
          if (keys) {
            for (const k of keys) {
              queryClient.invalidateQueries({ queryKey: k() });
            }
          }
        } catch {
          /* noop */
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (retryRef.current) window.clearTimeout(retryRef.current);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          /* noop */
        }
      }
    };
  }, [queryClient]);

  return { status, lastEvent };
}
