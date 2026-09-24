export type Hotkeys = {
  prev: string;
  next: string;
  repeat: string;
  toggle: string;
  bookmark: string;
  panel: string;
  rate: string;
  hint: string;
};

export type Settings = {
  fontSize: number;
  fontColor: string;
  fontFamily: string;
  opacity: number;
  rate: number;
  voiceId: string | null;
  ttsEngine: string;
  hotkeys: Hotkeys;
  effect: string;
  effectPower: number;
  comboColor: string;
  comboPlace: string;
  comboScale: number;
  comboBlur: boolean;
  captionOpacity: number;
  practiceMode: string;
  showHint: boolean;
  /** IPA under caption in overlay + panel practice only (not dict / gloss card). */
  showIpa: boolean;
  autoNext: boolean;
  autoSpeak: boolean;
  wordLookup: boolean;
  toolbarItems: string[];
  uiLocale: string;
  uiDark: boolean;
  /** Glossary gloss track: zh | ja | en (en-en). */
  glossLang: string;
  /** Hit particle skin id (classic / aurora / …). */
  particleSkin?: string;
  /** Key typing SFX pack id. */
  keySound?: string;
};

export type Bookmark = {
  text: string;
  hint: string | null;
  savedAt: string;
};

export type QueueItem = {
  text: string;
  hint: string | null;
  hasAudio: boolean;
};

export type WrongEntry = {
  text: string;
  hint: string | null;
  misses: number;
  lastAt: string;
};

export type DayStats = {
  typed: number;
  correct: number;
  wrong: number;
  sentences: number;
  maxCombo: number;
  newLearned?: number;
  reviewed?: number;
  studySecs?: number;
};

export type Stats = {
  typed: number;
  correct: number;
  sentences: number;
  wrong: number;
  maxStreak: number;
  day: string;
  dayTyped: number;
  dayCorrect: number;
  daySentences: number;
  dayWrong: number;
  dayNewLearned?: number;
  dayReviewed?: number;
  dayStudySecs?: number;
  totalLearned?: number;
  days: Record<string, DayStats>;
  currentStreak: number;
  longestStreak: number;
};

export type PackInfo = {
  id: string;
  name: string;
};

export type SavedWord = {
  lemma: string;
  seen: number;
  savedAt: string;
  fromSentence?: string | null;
};

export type Snapshot = {
  title: string;
  lang: string;
  mode: string;
  items: QueueItem[];
  index: number;
  sourcePath: string | null;
  settings: Settings;
  overlayVisible: boolean;
  shortcutError: string | null;
  ttsError: string | null;
  wrongBook: WrongEntry[];
  savedWords: SavedWord[];
  bookmarks: Bookmark[];
  stats: Stats;
  packId: string | null;
  practiceSource: string;
  wordbookId: string | null;
  /** Gloss track of the active pack; used to hide mismatched pack hints. */
  practiceGlossLang?: string | null;
  packs: PackInfo[];
  sourceProgress?: SourceProgress | null;
  progressList?: SourceProgress[];
  reviewDue?: number;
};

export type SourceProgress = {
  key: string;
  kind: string;
  id: string;
  title: string;
  total: number;
  done: number;
  percent: number;
  lastIndex: number;
  correct: number;
  wrong: number;
  updatedAt: string;
  /** Present on the active source only. */
  completed?: string[];
};

export type VoiceInfo = {
  id: string;
  name: string;
  language: string;
  provider?: string;
  installed?: boolean;
  quality?: string | null;
};

export type TtsProviderInfo = {
  id: string;
  name: string;
  kind: string;
  offline: boolean;
  downloadable: boolean;
  pro: boolean;
  available: boolean;
  note?: string | null;
};

export type ClipPayload = {
  mime: string;
  data: string;
};

export function todayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
