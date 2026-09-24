import { useEffect, useMemo, useRef, useState } from "react";
import sleep from "../assets/panda/panda-0-sleep.png";
import sit from "../assets/panda/panda-1-sit.png";
import happy from "../assets/panda/panda-2-happy.png";
import hype from "../assets/panda/panda-3-hype.png";
import maxed from "../assets/panda/panda-4-max.png";
import "./panda-combo.css";

const STAGES = [sleep, sit, happy, hype, maxed] as const;

export function pandaStageOf(streak: number) {
  if (streak <= 0) return 0;
  if (streak < 6) return 1;
  if (streak < 16) return 2;
  if (streak < 31) return 3;
  return 4;
}

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

const PIXEL_COLORS = ["#ffffff", "#a3e635", "#f9a8d4", "#fde047", "#93c5fd"];

/**
 * Panda combo preview:
 * - Stage follows streak (sleep → sit → happy → hype → max)
 * - Stage change = crossfade (no hard cut)
 * - Continuous idle bob so it never feels like a frozen still
 * - Combo break → fade back to sleep
 */
export default function PandaCombo({ streak, maxStreak, bump, tick }: Props) {
  const stage = pandaStageOf(streak);
  const [shown, setShown] = useState(stage);
  const [incoming, setIncoming] = useState<number | null>(null);
  const [fade, setFade] = useState(false);
  const cleaned = useCleanedSprites(STAGES);
  const sparkRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);
  const frame = useRef(0);
  const lastTick = useRef(0);

  useEffect(() => {
    if (stage === shown && incoming == null) return;
    if (incoming != null) return;
    setIncoming(stage);
    setFade(false);
    const kick = window.requestAnimationFrame(() => setFade(true));
    const done = window.setTimeout(() => {
      setShown(stage);
      setIncoming(null);
      setFade(false);
    }, 340);
    return () => {
      window.cancelAnimationFrame(kick);
      window.clearTimeout(done);
    };
  }, [stage, shown, incoming]);

  useEffect(() => {
    if (!tick || tick.id === lastTick.current) return;
    lastTick.current = tick.id;
    spawnBurst(particles.current, tick.x, tick.y, tick.ok);
  }, [tick]);

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

  const showSrc = cleaned[shown] ?? STAGES[shown];
  const nextSrc = incoming != null ? cleaned[incoming] ?? STAGES[incoming] : null;

  return (
    <>
      <div className={`panda-combo${bump ? " bump" : ""}${streak === 0 ? " sleep" : ""}`}>
        <div className="panda-combo-head">
          <span className="panda-combo-title">Panda</span>
          <span className="panda-combo-count">{streak}</span>
          <span className="panda-combo-max">Max {maxStreak}</span>
        </div>
        <div className="panda-stage" aria-hidden>
          <div className="panda-bob">
            <img
              className={`panda-frame base${fade && nextSrc ? " out" : ""}`}
              src={showSrc}
              alt=""
              draggable={false}
            />
            {nextSrc ? (
              <img
                className={`panda-frame overlay${fade ? " in" : ""}`}
                src={nextSrc}
                alt=""
                draggable={false}
              />
            ) : null}
          </div>
        </div>
      </div>
      <canvas ref={sparkRef} className="panda-combo-sparks" aria-hidden />
    </>
  );
}

/** Strip AI plates: magenta chroma, checkerboard, light/dark flat borders via edge flood. */
function useCleanedSprites(sources: readonly string[]) {
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    let dead = false;
    const made: string[] = [];
    void (async () => {
      const out: string[] = [];
      for (const src of sources) {
        const url = await scrubSpriteBackground(src);
        if (dead) {
          if (url.startsWith("blob:")) URL.revokeObjectURL(url);
          return;
        }
        if (url.startsWith("blob:")) made.push(url);
        out.push(url);
      }
      setUrls(out);
    })();
    return () => {
      dead = true;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [sources]);

  return useMemo(() => urls, [urls]);
}

function isPlatePixel(r: number, g: number, b: number) {
  // chroma-key magenta / hot pink
  if (r > 170 && b > 150 && g < 150 && r - g > 50 && b - g > 30) return true;
  // fake transparency checker (light cells)
  const avg = (r + g + b) / 3;
  if (avg > 168 && Math.abs(r - g) < 28 && Math.abs(g - b) < 28) return true;
  return false;
}

function scrubSpriteBackground(src: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(src);
        return;
      }
      ctx.drawImage(img, 0, 0);
      const frame = ctx.getImageData(0, 0, w, h);
      const d = frame.data;
      const seen = new Uint8Array(w * h);
      const queue: number[] = [];

      const push = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        const p = y * w + x;
        if (seen[p]) return;
        const i = p * 4;
        if (!isPlatePixel(d[i]!, d[i + 1]!, d[i + 2]!)) return;
        seen[p] = 1;
        queue.push(p);
      };

      for (let x = 0; x < w; x += 1) {
        push(x, 0);
        push(x, h - 1);
      }
      for (let y = 0; y < h; y += 1) {
        push(0, y);
        push(w - 1, y);
      }

      while (queue.length) {
        const p = queue.pop()!;
        const i = p * 4;
        d[i + 3] = 0;
        const x = p % w;
        const y = (p / w) | 0;
        push(x + 1, y);
        push(x - 1, y);
        push(x, y + 1);
        push(x, y - 1);
      }

      // second pass: any leftover flat magenta not on character silhouette
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        if (isPlatePixel(d[i]!, d[i + 1]!, d[i + 2]!)) {
          // only kill strong magenta leftovers (safe); skip dark to protect panda blacks
          const r = d[i]!;
          const g = d[i + 1]!;
          const b = d[i + 2]!;
          if (r > 170 && b > 150 && g < 150) d[i + 3] = 0;
        }
      }

      ctx.putImageData(frame, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(src);
          return;
        }
        resolve(URL.createObjectURL(blob));
      }, "image/png");
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

function spawnBurst(bag: Particle[], x: number, y: number, ok: boolean) {
  const count = ok ? 10 + Math.floor(Math.random() * 8) : 4;
  for (let i = 0; i < count; i += 1) {
    if (bag.length > 280) bag.shift();
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.1 + Math.random() * 3;
    bag.push({
      x: x + (-2 + Math.random() * 4),
      y: y + (-2 + Math.random() * 4),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.1,
      life: 0,
      maxLife: 24 + Math.floor(Math.random() * 18),
      size: 1 + Math.floor(Math.random() * 2),
      kind: Math.random() > 0.55 ? "cross" : "dot",
      color: PIXEL_COLORS[Math.floor(Math.random() * PIXEL_COLORS.length)]!,
    });
  }
}
