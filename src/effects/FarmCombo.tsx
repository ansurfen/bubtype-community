import { useEffect, useRef, useState } from "react";
import "./farm-combo.css";

type Props = {
  streak: number;
  maxStreak: number;
  bump: boolean;
  tick?: { id: number; x: number; y: number; ok: boolean } | null;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  kind: "dot" | "cross";
  color: string;
};

const PIXEL_COLORS = ["#d9f99d", "#a3e635", "#84cc16", "#fde047", "#86efac"];

/**
 * One transparent plot:
 * - Combo up → wheat denser/taller on the same dirt
 * - Combo break → wheat cleared, dirt stays
 * - Everything drawn on transparent canvas (no baked white/black plate)
 */
export default function FarmCombo({ streak, maxStreak, bump, tick }: Props) {
  const [biomass, setBiomass] = useState(0);
  const fieldRef = useRef<HTMLCanvasElement>(null);
  const sparkRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);
  const frame = useRef(0);
  const lastTick = useRef(0);

  useEffect(() => {
    if (!tick || tick.id === lastTick.current) return;
    lastTick.current = tick.id;
    if (tick.ok) setBiomass((n) => n + 1);
    spawnBurst(particles.current, tick.x, tick.y, tick.ok);
  }, [tick]);

  // Combo broken → wheat gone, dirt remains.
  useEffect(() => {
    if (streak === 0) setBiomass(0);
  }, [streak]);

  useEffect(() => {
    paintPlot(fieldRef.current, biomass);
  }, [biomass]);

  useEffect(() => {
    const spark = sparkRef.current;
    if (!spark) return;

    const fit = () => {
      const parent = spark.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      spark.width = Math.max(1, Math.floor(rect.width * dpr));
      spark.height = Math.max(1, Math.floor(rect.height * dpr));
      spark.style.width = `${rect.width}px`;
      spark.style.height = `${rect.height}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (spark.parentElement) ro.observe(spark.parentElement);

    const draw = () => {
      frame.current = requestAnimationFrame(draw);
      const ctx = spark.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, spark.width / dpr, spark.height / dpr);
      const next: Particle[] = [];
      for (const p of particles.current) {
        p.vy += 0.12;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.life += 1;
        const t = p.life / p.maxLife;
        if (t >= 1) continue;
        const alpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.fillStyle = p.color;
        const s = Math.max(1, Math.round(p.size));
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        if (p.kind === "dot") ctx.fillRect(x - s, y - s, s * 2, s * 2);
        else {
          ctx.fillRect(x - s * 2, y - Math.floor(s / 2), s * 4, s);
          ctx.fillRect(x - Math.floor(s / 2), y - s * 2, s, s * 4);
        }
        next.push(p);
      }
      particles.current = next;
      ctx.globalAlpha = 1;
    };
    frame.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame.current);
      ro.disconnect();
    };
  }, []);

  return (
    <>
      <div className={`farm-combo orchard-one${bump ? " bump" : ""}`}>
        <div className="orchard-head">
          <span className="farm-combo-title">Orchard</span>
          <span className="farm-combo-count">{streak}</span>
          <span className="farm-combo-max">
            Max {maxStreak}
            {biomass > 0 ? ` · grow ${biomass}` : ""}
          </span>
        </div>
        <canvas ref={fieldRef} className="orchard-plot-canvas" aria-hidden />
      </div>
      <canvas ref={sparkRef} className="farm-combo-sparks" aria-hidden />
    </>
  );
}

function spawnBurst(bag: Particle[], x: number, y: number, ok: boolean) {
  const count = ok ? 12 + Math.floor(Math.random() * 8) : 5;
  for (let i = 0; i < count; i += 1) {
    if (bag.length > 280) bag.shift();
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.1 + Math.random() * 3.2;
    bag.push({
      x: x + (-2 + Math.random() * 4),
      y: y + (-2 + Math.random() * 4),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.1,
      life: 0,
      maxLife: 26 + Math.floor(Math.random() * 20),
      size: 1 + Math.floor(Math.random() * 2),
      kind: Math.random() > 0.55 ? "cross" : "dot",
      color: PIXEL_COLORS[Math.floor(Math.random() * PIXEL_COLORS.length)]!,
    });
  }
}

/** Transparent canvas: dirt mound always; wheat only while biomass > 0. */
function paintPlot(canvas: HTMLCanvasElement | null, biomass: number) {
  if (!canvas) return;
  const w = 168;
  const h = 128;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  drawDirt(ctx, w, h);

  if (biomass <= 0) return;

  const stalks = Math.min(48, 1 + Math.floor(Math.pow(biomass, 0.85)));
  const heightBoost = Math.min(72, 10 + biomass * 0.6);

  for (let i = 0; i < stalks; i += 1) {
    const seed = Math.sin(i * 12.9898) * 43758.5453;
    const frac = seed - Math.floor(seed);
    const x = 28 + frac * (w - 56);
    const baseY = h - 28;
    const tall = heightBoost * (0.55 + (frac * 0.7) % 0.45) + (i % 5);
    const topY = baseY - tall;

    ctx.fillStyle = i % 3 === 0 ? "#4d7c0f" : "#65a30d";
    ctx.fillRect(Math.round(x), Math.round(topY), 2, Math.round(tall));

    const head = 2 + Math.min(4, Math.floor(biomass / 12));
    ctx.fillStyle = biomass > 20 ? "#fbbf24" : "#a3e635";
    ctx.fillRect(Math.round(x - head / 2), Math.round(topY - 2), head + 2, 3);
    if (biomass > 8) {
      ctx.fillStyle = "#fde68a";
      ctx.fillRect(Math.round(x - 1), Math.round(topY - 4), 3, 2);
    }
  }
}

/** Stardew-ish dirt mound, opaque pixels only — rest of canvas stays transparent. */
function drawDirt(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const cx = w / 2;
  const cy = h - 36;
  const rw = 58;
  const rh = 22;

  // soft mound silhouette
  for (let y = -rh; y <= rh; y += 1) {
    for (let x = -rw; x <= rw; x += 1) {
      const nx = x / rw;
      const ny = y / rh;
      if (nx * nx + ny * ny * 1.15 > 1) continue;
      const depth = nx * nx + ny * ny;
      let color = "#c4a484";
      if (depth > 0.72) color = "#8b6914";
      else if (depth > 0.45) color = "#a67c52";
      else if ((x + y * 3) % 5 === 0) color = "#d2b48c";
      else if ((x * 2 - y) % 7 === 0) color = "#b8956c";
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(cx + x), Math.round(cy + y), 1, 1);
    }
  }

  // tilled furrows on top
  ctx.fillStyle = "#9a7b4f";
  for (let i = -4; i <= 4; i += 1) {
    const yy = cy - 4 + i * 3;
    for (let x = -42; x <= 42; x += 1) {
      if ((x + i * 2) % 3 !== 0) continue;
      const nx = x / 48;
      const ny = (yy - cy) / 18;
      if (nx * nx + ny * ny > 0.85) continue;
      ctx.fillRect(Math.round(cx + x), Math.round(yy), 1, 1);
    }
  }
}
