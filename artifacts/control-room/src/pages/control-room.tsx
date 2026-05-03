import { useLayout } from "@/hooks/use-layout";
import { StatusStrip } from "@/components/status-strip";
import { CommandBar } from "@/components/command-bar";
import { AddMonitorTile } from "@/components/add-monitor-dialog";
import { MonitorRenderer } from "@/components/monitors/monitor-renderer";

export function ControlRoom() {
  const {
    layout,
    addMonitor,
    removeMonitor,
    removeByKind,
    clearAll,
    resizeMonitor,
    moveMonitor,
    resetLayout,
  } = useLayout();

  return (
    <div className="qs-scanlines h-screen w-screen flex flex-col relative bg-[#0a0118] text-indigo-200 overflow-hidden select-none">
      <div className="qs-vignette" />

      <StatusStrip />

      <div
        className="flex-1 p-2 grid grid-cols-12 gap-2 z-20 overflow-hidden min-h-0 bg-[#0a0118]"
        style={{ gridAutoRows: "minmax(0, 1fr)", gridTemplateRows: "repeat(12, minmax(0, 1fr))" }}
      >
        {layout.map((m, i) => (
          <MonitorRenderer
            key={m.id}
            monitor={m}
            onClose={() => removeMonitor(m.id)}
            onGrow={() => resizeMonitor(m.id, +1, +1)}
            onShrink={() => resizeMonitor(m.id, -1, -1)}
            onMoveLeft={i > 0 ? () => moveMonitor(m.id, -1) : undefined as never}
            onMoveRight={
              i < layout.length - 1 ? () => moveMonitor(m.id, +1) : (undefined as never)
            }
          />
        ))}
        <AddMonitorTile onAdd={addMonitor} onResetLayout={resetLayout} />
      </div>

      <CommandBar
        onAddMonitor={addMonitor}
        onRemoveByKind={removeByKind}
        onClearMonitors={clearAll}
      />
    </div>
  );
}
