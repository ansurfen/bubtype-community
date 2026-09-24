import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { BurstKind } from "./streak";
import "./combo.css";

export type ComboLine = {
  id: number;
  text: string;
  kind: BurstKind;
};

type Props = {
  streak: number;
  maxStreak: number;
  color: string;
  bump: boolean;
  lines: ComboLine[];
  barRef?: RefObject<HTMLDivElement | null>;
  scale?: number;
  className?: string;
  style?: CSSProperties;
};

/** Shared combo meter (overlay power + in-panel practice). */
export default function ComboMeter({
  streak,
  maxStreak,
  color,
  bump,
  lines,
  barRef,
  scale = 1,
  className,
  style,
}: Props) {
  return (
    <div
      className={`combo-meter${streak === 0 ? " combo-zero" : ""}${className ? ` ${className}` : ""}`}
      style={
        {
          ...style,
          ["--power" as string]: color,
          transform: scale !== 1 ? `scale(${scale})` : undefined,
        } as CSSProperties
      }
    >
      <div className="combo-title">Combo</div>
      <div className="combo-max">Max {maxStreak}</div>
      <div className={`combo-counter${bump ? " bump" : ""}`}>{streak}</div>
      <div ref={barRef} className="combo-bar" />
      <div className="combo-exclamations">
        {lines.map((line) => (
          <span key={line.id} className={`combo-exclamation ${line.kind}`}>
            {line.text}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Drive bar + burst lines + bump from a streak hit. */
export function useComboFx() {
  const [bump, setBump] = useState(false);
  const [lines, setLines] = useState<ComboLine[]>([]);
  const barRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  const pulse = useCallback(
    (hit: { streak: number; burst?: string; burstKind?: BurstKind | "" }) => {
      setBump(false);
      window.setTimeout(() => setBump(true), 26);
      if (hit.burst && hit.burstKind) {
        const id = seq.current + 1;
        seq.current = id;
        const kind = hit.burstKind;
        setLines((current) => [...current.slice(-6), { id, text: hit.burst!, kind }]);
        window.setTimeout(() => {
          setLines((current) => current.filter((item) => item.id !== id));
        }, 1500);
      }
      const bar = barRef.current;
      if (bar) {
        bar.style.transition = "none";
        bar.style.transform = hit.streak > 0 ? "scaleX(1)" : "scaleX(0)";
        if (hit.streak > 0) {
          window.setTimeout(() => {
            bar.style.transition = "transform 10s linear";
            bar.style.transform = "scaleX(0)";
          }, 50);
        }
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setBump(false);
    setLines([]);
    const bar = barRef.current;
    if (bar) {
      bar.style.transition = "none";
      bar.style.transform = "scaleX(0)";
    }
  }, []);

  return { bump, lines, barRef, pulse, reset };
}

export function useComboSparks(active: boolean) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<
    Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      alpha: number;
      size: number;
      color: string;
    }>
  >([]);
  const frame = useRef(0);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const fit = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const draw = () => {
      frame.current = requestAnimationFrame(draw);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const next = [];
      ctx.globalCompositeOperation = "lighter";
      for (const particle of particles.current) {
        particle.vy += 0.075;
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.alpha *= 0.96;
        if (particle.alpha <= 0.1) continue;
        ctx.globalAlpha = particle.alpha;
        ctx.fillStyle = particle.color;
        const half = particle.size / 2;
        ctx.fillRect(
          Math.round(particle.x - half),
          Math.round(particle.y - half),
          particle.size,
          particle.size,
        );
        next.push(particle);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      particles.current = next;
    };
    frame.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame.current);
      ro.disconnect();
    };
  }, [active]);

  const spawn = useCallback((at: { x: number; y: number }, power = 0.7, fontSize = 28) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const root = canvas.parentElement?.getBoundingClientRect();
    if (!root) return;
    const unit = Math.max(0.55, Math.min(2.6, fontSize / 28));
    const count = Math.round(5 + Math.random() * 10 * Math.max(0.4, power));
    const localX = at.x - root.left;
    const localY = at.y - root.top;
    for (let i = 0; i < count; i += 1) {
      if (particles.current.length >= 500) particles.current.shift();
      const size = (2 + Math.random() * 2 * (0.6 + power)) * unit;
      particles.current.push({
        x: localX,
        y: localY,
        vx: (-1 + Math.random() * 2) * unit,
        vy: (-3.5 + Math.random() * 2) * unit,
        alpha: 1,
        size,
        color: `hsl(${Math.floor(Math.random() * 360)} 100% 62%)`,
      });
    }
  }, []);

  return { canvasRef, spawn };
}
