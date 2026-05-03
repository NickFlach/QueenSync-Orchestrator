import { ChevronLeft, ChevronRight, Maximize2, Minus, X } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
  title: string;
  icon?: ReactNode;
  cw: number;
  ch: number;
  status?: { label: string; tone: "ok" | "warn" | "err" | "muted" };
  onClose?: () => void;
  onGrow?: () => void;
  onShrink?: () => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  children: ReactNode;
}

export function MonitorShell(props: Props) {
  const { cw, ch, title, icon, status, children } = props;
  const tone =
    status?.tone === "ok"
      ? "text-emerald-400"
      : status?.tone === "warn"
        ? "text-amber-400"
        : status?.tone === "err"
          ? "text-red-400"
          : "text-indigo-400";

  return (
    <div
      className="qs-monitor"
      style={{
        gridColumn: `span ${cw} / span ${cw}`,
        gridRow: `span ${ch} / span ${ch}`,
      }}
    >
      <div className="qs-monitor-header">
        <span className="flex items-center space-x-2 text-indigo-300 truncate">
          {icon}
          <span className="truncate">{title}</span>
          {status && (
            <span className={`ml-2 ${tone}`}>● {status.label}</span>
          )}
        </span>
        <div className="flex items-center space-x-1.5 opacity-70 hover:opacity-100">
          {props.onMoveLeft && (
            <button
              type="button"
              onClick={props.onMoveLeft}
              className="hover:text-white"
              title="Move left"
              data-testid={`btn-move-left-${title}`}
            >
              <ChevronLeft size={11} />
            </button>
          )}
          {props.onMoveRight && (
            <button
              type="button"
              onClick={props.onMoveRight}
              className="hover:text-white"
              title="Move right"
              data-testid={`btn-move-right-${title}`}
            >
              <ChevronRight size={11} />
            </button>
          )}
          {props.onShrink && (
            <button
              type="button"
              onClick={props.onShrink}
              className="hover:text-white"
              title="Shrink"
            >
              <Minus size={11} />
            </button>
          )}
          {props.onGrow && (
            <button
              type="button"
              onClick={props.onGrow}
              className="hover:text-white"
              title="Grow"
            >
              <Maximize2 size={10} />
            </button>
          )}
          {props.onClose && (
            <button
              type="button"
              onClick={props.onClose}
              className="hover:text-red-400"
              title="Close"
              data-testid={`btn-close-${title}`}
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>
      <div className="qs-monitor-body">{children}</div>
    </div>
  );
}
