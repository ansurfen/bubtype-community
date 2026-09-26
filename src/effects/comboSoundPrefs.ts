/**
 * Combo SFX prefs — independent of key-sound pack; shares key volume.
 * Master off mutes all; category toggles gate bingo / cheer / milestones.
 */
export type ComboSoundPrefs = {
  /** Master switch for all combo SFX. */
  enabled: boolean;
  /** Sentence complete → BINGO */
  bingo: boolean;
  /** Mid-streak cheers (Nice!, Super!, …) */
  cheer: boolean;
  /** Level-up, NEW MAX, streak break */
  milestone: boolean;
};

const PREFS_KEY = "bubtype.comboSoundPrefs";

export const DEFAULT_COMBO_SOUND_PREFS: ComboSoundPrefs = {
  enabled: true,
  bingo: true,
  cheer: false,
  milestone: false,
};

export function readComboSoundPrefs(): ComboSoundPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_COMBO_SOUND_PREFS };
    const parsed = JSON.parse(raw) as Partial<ComboSoundPrefs>;
    return {
      enabled:
        typeof parsed.enabled === "boolean"
          ? parsed.enabled
          : DEFAULT_COMBO_SOUND_PREFS.enabled,
      bingo:
        typeof parsed.bingo === "boolean"
          ? parsed.bingo
          : DEFAULT_COMBO_SOUND_PREFS.bingo,
      cheer:
        typeof parsed.cheer === "boolean"
          ? parsed.cheer
          : DEFAULT_COMBO_SOUND_PREFS.cheer,
      milestone:
        typeof parsed.milestone === "boolean"
          ? parsed.milestone
          : DEFAULT_COMBO_SOUND_PREFS.milestone,
    };
  } catch {
    return { ...DEFAULT_COMBO_SOUND_PREFS };
  }
}

export function writeComboSoundPrefs(next: ComboSoundPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("bubtype-combo-sound-prefs"));
}

export function patchComboSoundPrefs(patch: Partial<ComboSoundPrefs>): ComboSoundPrefs {
  const next = { ...readComboSoundPrefs(), ...patch };
  writeComboSoundPrefs(next);
  return next;
}
