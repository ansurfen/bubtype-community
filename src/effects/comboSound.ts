/**
 * Combo milestone SFX — Kenney Interface Sounds (CC0).
 * Independent of key-sound pack; shares key-sound volume.
 * Categories gated by comboSoundPrefs.
 */
import comboLevel from "../assets/sfx/combo/level.mp3";
import comboMessage from "../assets/sfx/combo/message.mp3";
import comboBingo from "../assets/sfx/combo/message.mp3";
import comboMax from "../assets/sfx/combo/max.mp3";
import comboDown from "../assets/sfx/combo/down.mp3";
import type { BurstKind } from "./streak";
import { playUrl, warmUrl } from "./keySound";
import { readComboSoundPrefs } from "./comboSoundPrefs";

const COMBO_URLS: Partial<Record<BurstKind, string>> = {
  level: comboLevel,
  message: comboMessage,
  bingo: comboBingo,
  max: comboMax,
  down: comboDown,
};

const COMBO_GAIN: Partial<Record<BurstKind, number>> = {
  level: 0.85,
  message: 0.9,
  bingo: 0.95,
  max: 1,
  down: 0.75,
};

function kindAllowed(kind: BurstKind, prefs = readComboSoundPrefs()): boolean {
  if (!prefs.enabled) return false;
  if (kind === "bingo") return prefs.bingo;
  if (kind === "message") return prefs.cheer;
  if (kind === "level" || kind === "max" || kind === "down") return prefs.milestone;
  return false;
}

export function playComboSound(kind: BurstKind | "" | undefined) {
  if (!kind) return;
  if (!kindAllowed(kind)) return;
  const url = COMBO_URLS[kind];
  if (!url) return;
  playUrl(url, COMBO_GAIN[kind] ?? 0.85);
}

export function warmComboSounds() {
  for (const url of Object.values(COMBO_URLS)) {
    if (url) warmUrl(url);
  }
}
