import { invoke } from "@tauri-apps/api/core";
import {
  isParticleSkinId,
  isSkinAllowed,
  type ParticleSkinId,
} from "../edition";

export const PARTICLE_SKIN_KEY = "bubtype.particleSkin";
export const PARTICLE_SKIN_EVENT = "bubtype-particle-skin";

export function readParticleSkin(preferred?: string | null): ParticleSkinId {
  const fromSettings =
    preferred && isParticleSkinId(preferred) && isSkinAllowed(preferred)
      ? preferred
      : null;
  if (fromSettings) return fromSettings;
  try {
    const raw = localStorage.getItem(PARTICLE_SKIN_KEY);
    if (raw && isParticleSkinId(raw) && isSkinAllowed(raw)) return raw;
  } catch {
    /* ignore */
  }
  return "classic";
}

export function writeParticleSkin(id: ParticleSkinId) {
  try {
    localStorage.setItem(PARTICLE_SKIN_KEY, id);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(PARTICLE_SKIN_EVENT));
  void invoke("set_particle_skin", { skin: id });
}
