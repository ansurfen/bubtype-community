import { comboEffect } from "./combo";
import type { EffectHandle, TypingEffect } from "./types";

const noneEffect: TypingEffect = {
  id: "none",
  name: "无",
  mount() {
    const handle: EffectHandle = {
      hit() {},
      dispose() {},
    };
    return handle;
  },
};

const effects: TypingEffect[] = [noneEffect, comboEffect];

export const effectChoices = effects.map((effect) => ({ id: effect.id, name: effect.name }));

export function effectById(id: string) {
  return effects.find((effect) => effect.id === id) ?? comboEffect;
}
