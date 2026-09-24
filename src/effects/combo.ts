import type { EffectHandle, Hit, TypingEffect } from "./types";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
};

class ComboHandle implements EffectHandle {
  private particles: Particle[] = [];
  private frame = 0;
  private last = 0;

  constructor(private canvas: HTMLCanvasElement) {}

  hit(hit: Hit) {
    if (!hit.ok) return;
    this.fit();
    const burst = Math.round(7 + hit.intensity * 9 + Math.min(hit.combo, 24) * 0.25);
    for (let i = 0; i < burst; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (0.7 + Math.random() * 1.7) * (0.55 + hit.intensity);
      this.particles.push({
        x: hit.x,
        y: hit.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.55,
        life: 0,
        max: 260 + Math.random() * 200,
        size: (1.4 + Math.random() * 2.1) * (0.7 + hit.intensity * 0.5),
        color: hit.done ? "#f2b705" : hit.color,
      });
    }
    this.play();
  }

  dispose() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.particles = [];
    const ctx = this.canvas.getContext("2d");
    ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private fit() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const dpr = window.devicePixelRatio || 1;
    const width = parent.clientWidth;
    const height = parent.clientHeight;
    this.canvas.width = Math.max(1, Math.floor(width * dpr));
    this.canvas.height = Math.max(1, Math.floor(height * dpr));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  private play() {
    if (this.frame) return;
    this.last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(34, now - this.last);
      this.last = now;
      this.draw(dt);
      if (this.particles.length > 0) {
        this.frame = requestAnimationFrame(step);
      } else {
        this.frame = 0;
      }
    };
    this.frame = requestAnimationFrame(step);
  }

  private draw(dt: number) {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
    const next: Particle[] = [];
    for (const particle of this.particles) {
      particle.life += dt;
      if (particle.life >= particle.max) continue;
      particle.x += particle.vx * dt * 0.06;
      particle.y += particle.vy * dt * 0.06;
      particle.vy += dt * 0.004;
      const remain = 1 - particle.life / particle.max;
      ctx.globalAlpha = remain;
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, Math.max(0.6, particle.size * remain), 0, Math.PI * 2);
      ctx.fill();
      next.push(particle);
    }
    ctx.globalAlpha = 1;
    this.particles = next;
  }
}

export const comboEffect: TypingEffect = {
  id: "combo",
  name: "连击",
  mount(canvas) {
    return new ComboHandle(canvas);
  },
};
