import { invoke } from "@tauri-apps/api/core";
import {
  isParticleSkinId,
  isSkinAllowed,
  type ParticleSkinId,
} from "../edition";

export const PARTICLE_SKIN_KEY = "bubtype.particleSkin";
export const PARTICLE_SKIN_EVENT = "bubtype-particle-skin";

export function readParticleSkin(preferred?: string | null): ParticleSkinId {
  // Prefer shared settings (all webviews) — do not re-check license here.
  // Selection UI already gates writes; Overlay/Power often lack panel localStorage.
  if (preferred && isParticleSkinId(preferred)) return preferred;
  try {
    const raw = localStorage.getItem(PARTICLE_SKIN_KEY);
    if (raw && isParticleSkinId(raw)) return raw;
  } catch {
    /* ignore */
  }
  return "classic";
}

export function writeParticleSkin(id: ParticleSkinId) {
  if (!isSkinAllowed(id)) return;
  try {
    localStorage.setItem(PARTICLE_SKIN_KEY, id);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(PARTICLE_SKIN_EVENT));
  void invoke("set_particle_skin", { skin: id });
}
