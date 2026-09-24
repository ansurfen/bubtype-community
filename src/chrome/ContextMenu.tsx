import { useEffect, useLayoutEffect, useRef } from "react";
import "./context-menu.css";

export type ContextMenuItem =
  | { type: "item"; id: string; label: string; checked?: boolean; danger?: boolean; disabled?: boolean }
  | { type: "sep" };

type Props = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onPick: (id: string) => void;
  onClose: () => void;
};

export default function ContextMenu({ x, y, items, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [x, y, items]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointer = (event: PointerEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => {
        if (item.type === "sep") {
          return <div key={`sep-${index}`} className="ctx-sep" role="separator" />;
        }
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`ctx-item${item.checked ? " on" : ""}${item.danger ? " danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              onPick(item.id);
              onClose();
            }}
          >
            <span className="ctx-label">{item.label}</span>
            {item.checked ? <span className="ctx-check" aria-hidden>✓</span> : null}
          </button>
        );
      })}
    </div>
  );
}
