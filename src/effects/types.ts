export type Hit = {
  ok: boolean;
  done: boolean;
  combo: number;
  x: number;
  y: number;
  color: string;
  intensity: number;
};

export type EffectHandle = {
  hit(hit: Hit): void;
  dispose(): void;
};

export type TypingEffect = {
  id: string;
  name: string;
  mount(canvas: HTMLCanvasElement): EffectHandle;
};
