import { useCallback, useRef } from "react";

const THUMB = 20;

function snap(value: number, min: number, max: number, step: number) {
  const clamped = Math.min(max, Math.max(min, value));
  if (step <= 0) return clamped;
  const stepped = Math.round((clamped - min) / step) * step + min;
  const decimals = String(step).includes(".") ? String(step).split(".")[1].length : 0;
  return Number(stepped.toFixed(decimals));
}

export default function ThemeRange({
  value,
  min,
  max,
  step = 1,
  onChange,
  "aria-label": ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  "aria-label"?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const span = Math.max(max - min, Number.EPSILON);
  const ratio = Math.min(1, Math.max(0, (value - min) / span));

  const applyClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const usable = Math.max(1, rect.width - THUMB);
      const centered = clientX - rect.left - THUMB / 2;
      const nextRatio = Math.min(1, Math.max(0, centered / usable));
      onChange(snap(min + nextRatio * span, min, max, step));
    },
    [max, min, onChange, span, step],
  );

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    applyClientX(event.clientX);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    applyClientX(event.clientX);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowUp"
        ? step
        : event.key === "ArrowLeft" || event.key === "ArrowDown"
          ? -step
          : event.key === "Home"
            ? min - value
            : event.key === "End"
              ? max - value
              : 0;
    if (!delta) return;
    event.preventDefault();
    onChange(snap(value + delta, min, max, step));
  }

  return (
    <div
      ref={trackRef}
      className="theme-range"
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      style={{ ["--ratio" as string]: String(ratio) }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
      onKeyDown={onKeyDown}
    >
      <div className="theme-range-track">
        <div className="theme-range-fill" />
      </div>
      <div className="theme-range-thumb" />
    </div>
  );
}
