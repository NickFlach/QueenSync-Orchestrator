import { useEffect, useRef, useState } from "react";
import { Command } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  MONITOR_TYPES,
  type MonitorKind,
} from "@/lib/monitor-types";

type Tone = "user" | "ok" | "warn" | "err" | "ai" | "muted";

export interface HistoryLine {
  id: string;
  text: string;
  tone: Tone;
}

interface AiAction {
  type: "tool" | "answer";
  tool?: string;
  args?: Record<string, unknown>;
  rationale?: string;
  text?: string;
}

interface AiStatus {
  configured: boolean;
}

interface Props {
  onAddMonitor: (
    kind: MonitorKind,
    opts?: { url?: string; title?: string },
  ) => void;
  onRemoveByKind: (kind: MonitorKind) => number;
  onClearMonitors: () => void;
}

const SLASH_COMMANDS = [
  "/arms",
  "/tasks",
  "/signals",
  "/memory",
  "/resonance",
  "/logs",
  "/adapters",
  "/summary",
  "/wake",
  "/dream",
  "/storm",
  "/add",
  "/remove",
  "/clear",
  "/help",
] as const;

let lineCounter = 0;
function nextId(): string {
  lineCounter += 1;
  return `l-${Date.now().toString(36)}-${lineCounter}`;
}

function summarizeJson(value: unknown, max = 6): string {
  if (value === null || value === undefined) return "(empty)";
  if (Array.isArray(value)) {
    if (value.length === 0) return "→ 0 results";
    const head = value.slice(0, max).map((v) => {
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        const name =
          (o.name as string) ??
          (o.id as string) ??
          (o.type as string) ??
          (o.kind as string) ??
          JSON.stringify(o).slice(0, 40);
        const status =
          (o.status as string) ??
          (o.state as string) ??
          (o.phase as string) ??
          (o.level as string) ??
          "";
        return status ? `${name} [${status}]` : String(name);
      }
      return String(v);
    });
    const more = value.length > max ? ` …+${value.length - max}` : "";
    return `→ ${value.length} item${value.length === 1 ? "" : "s"}: ${head.join(", ")}${more}`;
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (Array.isArray(o.items)) return summarizeJson(o.items, max);
    const keys = Object.keys(o).slice(0, 8);
    const parts = keys.map((k) => {
      const v = o[k];
      if (v && typeof v === "object") return `${k}=…`;
      return `${k}=${String(v)}`;
    });
    return `→ ${parts.join(" · ")}`;
  }
  return `→ ${String(value)}`;
}

const COMMAND_HELP = `commands:
  /arms              list all kannaka arms
  /tasks             list recent tasks
  /signals           list recent signals
  /memory            list memory events
  /resonance         list active resonance fields
  /logs              tail server logs
  /adapters          adapter health (radio + observatory)
  /summary           system summary
  /wake              wake the kannaktopus swarm
  /dream             trigger dream-lite memory compression
  /storm             trigger a resonance storm demo
  /add <kind> [url]  install a monitor (kinds: ${Object.keys(MONITOR_TYPES).join(", ")})
  /remove <kind>     remove monitors of a kind, or "all"
  /clear             remove every monitor
  /help              show this help
  <free text>        ask replit-ai to interpret`;

export function CommandBar({
  onAddMonitor,
  onRemoveByKind,
  onClearMonitors,
}: Props) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<HistoryLine[]>([
    {
      id: nextId(),
      text: "queensync control-room online · type /help",
      tone: "muted",
    },
  ]);
  const [busy, setBusy] = useState(false);
  const [aiOk, setAiOk] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    api<AiStatus>("/ai/status")
      .then((s) => setAiOk(s.configured))
      .catch(() => setAiOk(false));
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const el = historyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history]);

  function emit(text: string, tone: Tone = "muted") {
    setHistory((h) => [...h, { id: nextId(), text, tone }]);
  }

  async function runEndpoint(
    label: string,
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    invalidate?: string[],
  ) {
    try {
      const result = await api(path, {
        method,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      emit(`${label}: ${summarizeJson(result)}`, "ok");
      if (invalidate) invalidate.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit(`${label}: ✕ ${msg}`, "err");
    }
  }

  function isMonitorKind(s: string): s is MonitorKind {
    return s in MONITOR_TYPES;
  }

  async function executeTool(tool: string, args: Record<string, unknown>) {
    switch (tool) {
      case "list_arms":
        return runEndpoint("arms", "GET", "/arms");
      case "list_tasks":
        return runEndpoint("tasks", "GET", "/tasks?limit=10");
      case "list_signals":
        return runEndpoint("signals", "GET", "/signals?limit=10");
      case "list_logs":
        return runEndpoint("logs", "GET", "/logs?limit=10");
      case "list_memory":
        return runEndpoint("memory", "GET", "/memory?limit=10");
      case "list_resonance":
        return runEndpoint(
          "resonance",
          "GET",
          args.activeOnly === false ? "/resonance" : "/resonance/active",
        );
      case "list_adapters_health": {
        await runEndpoint("radio.health", "GET", "/adapters/radio/health");
        await runEndpoint(
          "observatory.health",
          "GET",
          "/adapters/observatory/health",
        );
        return;
      }
      case "system_summary":
        return runEndpoint("summary", "GET", "/summary");
      case "observatory_state":
        return runEndpoint("hrm", "GET", "/observatory/state");
      case "wake_kannaktopus":
        return runEndpoint("wake", "POST", "/demo/wake-kannaktopus", {}, [
          "arms",
          "summary",
        ]);
      case "dream_lite":
        return runEndpoint("dream-lite", "POST", "/demo/dream-lite", {}, [
          "memory",
        ]);
      case "resonance_storm":
        return runEndpoint("storm", "POST", "/demo/resonance-storm", {}, [
          "resonance-active",
        ]);
      case "create_signal": {
        const type = String(args.type ?? "manual");
        const source = (args.source as string | undefined) ?? "control-room";
        const payload = (args.payload as Record<string, unknown> | undefined) ?? {};
        return runEndpoint(
          "signal.inject",
          "POST",
          "/signals",
          { type, source, payload },
          ["signals"],
        );
      }
      case "add_monitor": {
        const k = String(args.kind ?? "");
        if (!isMonitorKind(k)) {
          emit(`add_monitor: ✕ unknown kind "${k}"`, "err");
          return;
        }
        const url = typeof args.url === "string" ? args.url : undefined;
        const title = typeof args.title === "string" ? args.title : undefined;
        onAddMonitor(k, { url, title });
        emit(`installed monitor: ${MONITOR_TYPES[k].label}`, "ok");
        return;
      }
      case "remove_monitor": {
        const k = String(args.kind ?? "");
        if (k === "all") {
          onClearMonitors();
          emit("cleared all monitors", "ok");
          return;
        }
        if (!isMonitorKind(k)) {
          emit(`remove_monitor: ✕ unknown kind "${k}"`, "err");
          return;
        }
        const n = onRemoveByKind(k);
        emit(`removed ${n} ${MONITOR_TYPES[k].label} monitor(s)`, "ok");
        return;
      }
      case "clear_monitors":
        onClearMonitors();
        emit("cleared all monitors", "ok");
        return;
      default:
        emit(`unknown tool: ${tool}`, "err");
    }
  }

  async function runSlash(raw: string) {
    const [cmd, ...rest] = raw.split(/\s+/);
    switch (cmd) {
      case "/help":
        COMMAND_HELP.split("\n").forEach((l) => emit(l, "muted"));
        return;
      case "/arms":
        return runEndpoint("arms", "GET", "/arms");
      case "/tasks":
        return runEndpoint("tasks", "GET", "/tasks?limit=10");
      case "/signals":
        return runEndpoint("signals", "GET", "/signals?limit=10");
      case "/memory":
        return runEndpoint("memory", "GET", "/memory?limit=10");
      case "/resonance":
        return runEndpoint("resonance", "GET", "/resonance/active");
      case "/logs":
        return runEndpoint("logs", "GET", "/logs?limit=15");
      case "/adapters":
        return executeTool("list_adapters_health", {});
      case "/summary":
        return runEndpoint("summary", "GET", "/summary");
      case "/wake":
        return executeTool("wake_kannaktopus", {});
      case "/dream":
        return executeTool("dream_lite", {});
      case "/storm":
        return executeTool("resonance_storm", {});
      case "/clear":
        return executeTool("clear_monitors", {});
      case "/add": {
        const kind = rest[0];
        if (!kind || !isMonitorKind(kind)) {
          emit(
            `usage: /add <kind> [url]  · kinds: ${Object.keys(MONITOR_TYPES).join(", ")}`,
            "err",
          );
          return;
        }
        const url = rest[1];
        return executeTool("add_monitor", { kind, url });
      }
      case "/remove": {
        const kind = rest[0];
        if (!kind) {
          emit("usage: /remove <kind|all>", "err");
          return;
        }
        return executeTool("remove_monitor", { kind });
      }
      default:
        emit(`unknown command: ${cmd} · try /help`, "err");
    }
  }

  async function runAi(prompt: string) {
    if (aiOk === false) {
      emit("ai offline · use /help for slash commands", "err");
      return;
    }
    emit("replit-ai: …interpreting…", "ai");
    try {
      const action = await api<AiAction>("/ai/command", {
        method: "POST",
        body: JSON.stringify({ prompt }),
      });
      if (action.type === "answer") {
        emit(`replit-ai: ${action.text ?? "(no answer)"}`, "ai");
        return;
      }
      if (action.type === "tool" && action.tool) {
        const r = action.rationale ? ` (${action.rationale})` : "";
        emit(`replit-ai → ${action.tool}${r}`, "ai");
        await executeTool(action.tool, action.args ?? {});
        return;
      }
      emit("replit-ai: (unrecognized action)", "warn");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit(`replit-ai: ✕ ${msg}`, "err");
    }
  }

  async function submit() {
    const raw = value.trim();
    if (!raw || busy) return;
    setValue("");
    emit(`replit-ai > ${raw}`, "user");
    setBusy(true);
    try {
      if (raw.startsWith("/")) {
        await runSlash(raw);
      } else {
        await runAi(raw);
      }
    } finally {
      setBusy(false);
    }
  }

  function toneClass(t: Tone): string {
    switch (t) {
      case "user":
        return "text-indigo-300";
      case "ok":
        return "text-emerald-400";
      case "warn":
        return "text-amber-400";
      case "err":
        return "text-red-400";
      case "ai":
        return "text-violet-300";
      default:
        return "text-indigo-400/70";
    }
  }

  return (
    <div className="h-44 border-t border-indigo-900/50 bg-[#0a0118]/95 backdrop-blur-md z-30 flex flex-col shrink-0 p-3 qs-font-mono">
      <div className="flex items-center flex-wrap gap-x-3 text-[10px] text-indigo-500/70 mb-2">
        <span className="text-indigo-400">AVAILABLE INTENTS:</span>
        {SLASH_COMMANDS.map((cmd) => (
          <button
            key={cmd}
            type="button"
            onClick={() => {
              setValue(cmd + " ");
              inputRef.current?.focus();
            }}
            className="hover:text-indigo-200 cursor-pointer"
          >
            {cmd}
          </button>
        ))}
      </div>

      <div
        ref={historyRef}
        className="flex-1 overflow-y-auto qs-scrollbar text-[11px] space-y-0.5 mb-2 pr-1"
      >
        {history.map((line) => (
          <div key={line.id} className={toneClass(line.tone)}>
            {line.tone === "user" || line.tone === "muted"
              ? line.text
              : <span className="pl-4">{line.text}</span>}
          </div>
        ))}
        {busy && (
          <div className="text-indigo-500 pl-4 animate-pulse">
            › working…
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="relative flex items-center bg-indigo-950/30 border border-indigo-500/40 rounded px-2 py-1.5"
      >
        <span className="text-indigo-500 mr-2 shrink-0">replit-ai &gt;</span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          placeholder="ask anything · or type /help"
          className="flex-1 bg-transparent text-indigo-100 text-sm outline-none qs-font-mono placeholder:text-indigo-700"
          data-testid="input-command"
        />
        <div className="flex items-center space-x-3 text-[10px] shrink-0 ml-2">
          <span
            className={`flex items-center space-x-1 ${
              aiOk === false
                ? "text-red-500"
                : aiOk === null
                  ? "text-amber-500 animate-pulse"
                  : "text-emerald-500 qs-glow-green"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                aiOk === false
                  ? "bg-red-500"
                  : aiOk === null
                    ? "bg-amber-500"
                    : "bg-emerald-500"
              }`}
            />
            <span>
              {aiOk === false ? "OFFLINE" : aiOk === null ? "INIT" : "LISTENING"}
            </span>
          </span>
          <span className="bg-indigo-900/50 text-indigo-400 px-1.5 py-0.5 rounded flex items-center space-x-1 border border-indigo-700/50">
            <Command size={10} /> <span>K</span>
          </span>
        </div>
      </form>
    </div>
  );
}
