import { useState } from "react";
import { Plus, X } from "lucide-react";
import {
  MONITOR_TYPES,
  type MonitorKind,
} from "@/lib/monitor-types";

interface Props {
  onAdd: (kind: MonitorKind, opts?: { url?: string; title?: string }) => void;
  onResetLayout: () => void;
}

export function AddMonitorTile({ onAdd, onResetLayout }: Props) {
  const [open, setOpen] = useState(false);
  const [pendingKind, setPendingKind] = useState<MonitorKind | null>(null);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");

  function handleSelect(kind: MonitorKind) {
    if (MONITOR_TYPES[kind].needsUrl) {
      setPendingKind(kind);
      return;
    }
    onAdd(kind);
    setOpen(false);
  }

  function commitUrl() {
    if (!pendingKind) return;
    onAdd(pendingKind, { url: url.trim(), title: title.trim() || undefined });
    setOpen(false);
    setPendingKind(null);
    setUrl("");
    setTitle("");
  }

  return (
    <>
      <div
        className="qs-monitor border-dashed border-indigo-500/30 bg-transparent flex items-center justify-center cursor-pointer hover:bg-indigo-900/10 transition-colors group"
        style={{ gridColumn: "span 2 / span 2", gridRow: "span 5 / span 5" }}
        onClick={() => setOpen(true)}
        data-testid="btn-add-monitor"
      >
        <div className="flex flex-col items-center space-y-2 opacity-50 group-hover:opacity-100 transition-opacity">
          <div className="w-8 h-8 rounded-full border border-indigo-400 flex items-center justify-center">
            <Plus size={16} className="text-indigo-300" />
          </div>
          <span className="qs-font-mono text-[10px] text-indigo-300 tracking-wider">
            ADD MONITOR
          </span>
        </div>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => {
            setOpen(false);
            setPendingKind(null);
          }}
        >
          <div
            className="qs-monitor max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="qs-monitor-header">
              <span className="text-indigo-300">[install.monitor]</span>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setPendingKind(null);
                }}
                className="text-indigo-400 hover:text-white"
              >
                <X size={12} />
              </button>
            </div>

            {!pendingKind ? (
              <div className="p-4 qs-scrollbar overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2">
                {Object.values(MONITOR_TYPES).map((meta) => (
                  <button
                    key={meta.kind}
                    type="button"
                    onClick={() => handleSelect(meta.kind)}
                    className="text-left border border-indigo-900/50 hover:border-indigo-500/60 hover:bg-indigo-900/20 p-3 qs-font-mono transition-colors"
                    data-testid={`btn-add-${meta.kind}`}
                  >
                    <div className="text-indigo-300 text-xs">
                      {meta.label}
                    </div>
                    <div className="text-indigo-500 text-[10px] mt-1">
                      {meta.description}
                    </div>
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => {
                    onResetLayout();
                    setOpen(false);
                  }}
                  className="text-left border border-indigo-900/50 hover:border-amber-500/60 hover:bg-amber-900/10 p-3 qs-font-mono transition-colors"
                >
                  <div className="text-amber-300 text-xs">Reset layout</div>
                  <div className="text-amber-600/70 text-[10px] mt-1">
                    Restore the default monitor wall
                  </div>
                </button>
              </div>
            ) : (
              <div className="p-4 space-y-3 qs-font-mono">
                <div className="text-indigo-300 text-xs">
                  Configure {MONITOR_TYPES[pendingKind].label}
                </div>
                <input
                  type="text"
                  placeholder="title (optional)"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-indigo-950/40 border border-indigo-900/60 px-2 py-1.5 text-indigo-200 text-[12px] outline-none focus:border-indigo-500"
                />
                <input
                  type="url"
                  placeholder="https://…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full bg-indigo-950/40 border border-indigo-900/60 px-2 py-1.5 text-indigo-200 text-[12px] outline-none focus:border-indigo-500"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingKind(null)}
                    className="px-3 py-1 border border-indigo-900/60 text-indigo-400 text-[11px] hover:bg-indigo-900/20"
                  >
                    back
                  </button>
                  <button
                    type="button"
                    onClick={commitUrl}
                    disabled={!url.trim()}
                    className="px-3 py-1 border border-emerald-700 text-emerald-300 text-[11px] hover:bg-emerald-900/20 disabled:opacity-40"
                  >
                    install →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
