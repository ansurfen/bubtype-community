import { useEffect, useRef } from "react";
import {
  PROFILES,
  type ParticleSkinId,
  type SkinProfile,
} from "../edition";
import "./hit-particles.css";

export type { ParticleSkinId } from "../edition";
export {
  PARTICLE_SKINS,
  SKIN_INK,
  isParticleSkinId,
  isSkinAllowed,
} from "../edition";

type Burst = {
  id: number;
  x: number;
  y: number;
  ok: boolean;
};

type Props = {
  skin: ParticleSkinId;
  burst: Burst | null;
  /** Theme / font color — Classic particles follow this. */
  accent?: string;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  kind: "dot" | "cross" | "blob" | "ember" | "wisp" | "sprite";
  color: string;
  spin: number;
  spinVel: number;
  drag: number;
  gravity: number;
  sprite?: HTMLCanvasElement;
};

const spriteCache = new Map<string, Promise<HTMLCanvasElement>>();

/** Load PNG/WebP with baked alpha — no chroma keying. */
function loadSprite(src: string): Promise<HTMLCanvasElement> {
  const hit = spriteCache.get(src);
  if (hit) return hit;
  const job = new Promise<HTMLCanvasElement>((resolve, reject) => {
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
        reject(new Error("2d"));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(trimOpaque(canvas));
    };
    img.onerror = () => reject(new Error("load"));
    img.src = src;
  });
  spriteCache.set(src, job);
  return job;
}

function trimOpaque(src: HTMLCanvasElement): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const ctx = src.getContext("2d");
  if (!ctx) return src;
  const { data } = ctx.getImageData(0, 0, w, h);
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (data[(y * w + x) * 4 + 3]! < 12) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return src;
  const pad = 2;
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const tw = Math.min(w - x0, maxX - minX + 1 + pad * 2);
  const th = Math.min(h - y0, maxY - minY + 1 + pad * 2);
  if (tw >= w * 0.92 && th >= h * 0.92) return src;
  const out = document.createElement("canvas");
  out.width = tw;
  out.height = th;
  const octx = out.getContext("2d");
  if (!octx) return src;
  octx.drawImage(src, x0, y0, tw, th, 0, 0, tw, th);
  return out;
}

function profileOf(id: ParticleSkinId): SkinProfile {
  return PROFILES[id] ?? PROFILES.classic!;
}

/** Hit sparks: draw skins + optional Pro image skins. */
export default function HitParticles({ skin, burst, accent }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);
  const frame = useRef(0);
  const lastId = useRef(0);
  const skinRef = useRef(skin);
  const accentRef = useRef(accent);
  const sheets = useRef<Record<string, HTMLCanvasElement[]>>({});
  skinRef.current = skin;
  accentRef.current = accent;

  useEffect(() => {
    const profile = profileOf(skin);
    if (profile.mode !== "sprite" || !profile.sprites) return;
    let dead = false;
    void Promise.all(profile.sprites.map((src) => loadSprite(src))).then((list) => {
      if (!dead) sheets.current[skin] = list;
    });
    return () => {
      dead = true;
    };
  }, [skin]);

  useEffect(() => {
    if (!burst || burst.id === lastId.current) return;
    lastId.current = burst.id;
    const id = skinRef.current;
    const profile = profileOf(id);
    if (profile.mode === "sprite") {
      const ready = sheets.current[id];
      if (ready?.length) {
        spawnSprite(particles.current, profile, ready, burst.x, burst.y, burst.ok);
      } else if (profile.sprites) {
        void Promise.all(profile.sprites.map((src) => loadSprite(src))).then((list) => {
          sheets.current[id] = list;
          spawnSprite(particles.current, profile, list, burst.x, burst.y, burst.ok);
        });
      }
      return;
    }
    spawnDraw(particles.current, id, burst.x, burst.y, burst.ok, accentRef.current);
  }, [burst]);

  useEffect(() => {
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
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const next: Particle[] = [];
      for (const p of particles.current) {
        p.vy += p.gravity;
        p.vx *= p.drag;
        p.vy *= p.drag;
        p.x += p.vx;
        p.y += p.vy;
        p.spin += p.spinVel;
        p.life += 1;
        const t = p.life / p.maxLife;
        if (t >= 1) continue;
        const alpha = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
        paint(ctx, p, Math.max(0, alpha));
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

  return <canvas ref={canvasRef} className="hit-particles" aria-hidden />;
}

function spawnDraw(
  bag: Particle[],
  skin: ParticleSkinId,
  x: number,
  y: number,
  ok: boolean,
  accent?: string,
) {
  const profile = profileOf(skin);
  const palette =
    skin === "classic"
      ? classicThemeColors(accent)
      : (profile.colors ?? ["#fff"]);
  const [c0, c1] = profile.count;
  const count = Math.round(c0 + Math.random() * (c1 - c0)) * (ok ? 1 : 0.45);
  for (let i = 0; i < count; i += 1) {
    if (bag.length > 360) bag.shift();
    const angle = Math.random() * Math.PI * 2;
    const [s0, s1] = profile.speed;
    const speed = s0 + Math.random() * (s1 - s0);
    const [z0, z1] = profile.size;
    bag.push({
      x: x + (-3 + Math.random() * 6),
      y: y + (-3 + Math.random() * 6),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - profile.upwardBias * (0.6 + Math.random() * 0.8),
      life: 0,
      maxLife: 22 + Math.floor(Math.random() * 28),
      size: z0 + Math.random() * (z1 - z0),
      kind: (profile.kinds ?? ["dot"])[Math.floor(Math.random() * (profile.kinds?.length ?? 1))]!,
      color: palette[Math.floor(Math.random() * palette.length)]!,
      spin: Math.random() * Math.PI,
      spinVel: 0,
      drag: profile.drag,
      gravity: profile.gravity * (0.85 + Math.random() * 0.3),
    });
  }
}

/** Classic pack: tint sparks from the app theme / font color. */
function classicThemeColors(accent?: string): string[] {
  const hex = /^#[0-9a-fA-F]{6}$/i.test(accent ?? "")
    ? (accent as string)
    : "#baf36d";
  const { r, g, b } = rgbOf(hex);
  return [
    hex,
    mixRgb(r, g, b, 255, 255, 255, 0.35),
    mixRgb(r, g, b, 255, 255, 255, 0.55),
    mixRgb(r, g, b, 255, 255, 255, 0.75),
    mixRgb(r, g, b, 0, 0, 0, 0.18),
    "#ffffff",
  ];
}

function rgbOf(hex: string) {
  const raw = hex.replace("#", "");
  const value = Number.parseInt(raw, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function mixRgb(
  r: number,
  g: number,
  b: number,
  tr: number,
  tg: number,
  tb: number,
  t: number,
) {
  const rr = Math.round(r + (tr - r) * t);
  const gg = Math.round(g + (tg - g) * t);
  const bb = Math.round(b + (tb - b) * t);
  return `#${[rr, gg, bb].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function spawnSprite(
  bag: Particle[],
  profile: SkinProfile,
  sprites: HTMLCanvasElement[],
  x: number,
  y: number,
  ok: boolean,
) {
  const [c0, c1] = profile.count;
  const count = Math.round(c0 + Math.random() * (c1 - c0)) * (ok ? 1 : 0.4);
  const sway = profile.sway ?? 0.05;
  for (let i = 0; i < count; i += 1) {
    if (bag.length > 360) bag.shift();
    const angle = -Math.PI / 2 + (-1.15 + Math.random() * 2.3);
    const [s0, s1] = profile.speed;
    const speed = s0 + Math.random() * (s1 - s0);
    const [z0, z1] = profile.size;
    bag.push({
      x: x + (-14 + Math.random() * 28),
      y: y + (-18 + Math.random() * 12),
      vx: Math.cos(angle) * speed + (-sway + Math.random() * sway * 2) * 22,
      vy: Math.sin(angle) * speed * 0.55 - 0.35 + profile.gravity * 6,
      life: 0,
      maxLife: 36 + Math.floor(Math.random() * 28),
      size: z0 + Math.random() * (z1 - z0),
      kind: "sprite",
      color: "#fff",
      spin: Math.random() * Math.PI * 2,
      spinVel: (-1 + Math.random() * 2) * 0.09,
      drag: profile.drag,
      gravity: profile.gravity * (0.9 + Math.random() * 0.25),
      sprite: sprites[Math.floor(Math.random() * sprites.length)],
    });
  }
}

function paint(ctx: CanvasRenderingContext2D, p: Particle, alpha: number) {
  ctx.globalAlpha = alpha;
  if (p.kind === "sprite" && p.sprite) {
    const sheet = p.sprite;
    const aspect = sheet.width / Math.max(1, sheet.height);
    const h = p.size;
    const w = h * aspect;
    ctx.save();
    ctx.globalAlpha = alpha * 0.88;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.spin);
    ctx.drawImage(sheet, -w / 2, -h / 2, w, h);
    ctx.restore();
    return;
  }

  ctx.fillStyle = p.color;
  const s = Math.max(1, Math.round(p.size));
  const x = Math.round(p.x);
  const y = Math.round(p.y);

  if (p.kind === "cross") {
    ctx.fillRect(x - s * 2, y - Math.floor(s / 2), s * 4, s);
    ctx.fillRect(x - Math.floor(s / 2), y - s * 2, s, s * 4);
    return;
  }
  if (p.kind === "blob") {
    const stretch = 1 + Math.min(2, Math.abs(p.vy) * 0.25);
    ctx.fillRect(x - s, y - s, s * 2, Math.round(s * 2 * stretch));
    ctx.globalAlpha = alpha * 0.55;
    ctx.fillRect(x - Math.floor(s / 2), y + s, s, s + 1);
    return;
  }
  if (p.kind === "ember") {
    ctx.fillRect(x - s, y - s * 2, s, s * 3);
    ctx.globalAlpha = alpha * 0.7;
    ctx.fillStyle = "#fff7ed";
    ctx.fillRect(x - Math.max(1, s - 1), y - s * 2, Math.max(1, s - 1), s);
    return;
  }
  if (p.kind === "wisp") {
    ctx.globalAlpha = alpha * 0.85;
    ctx.fillRect(x - 1, y - s * 2, 2, s * 3);
    ctx.globalAlpha = alpha * 0.35;
    ctx.fillRect(x - s, y - s, s * 2, s * 2);
    return;
  }
  ctx.fillRect(x - s, y - s, s * 2, s * 2);
}
