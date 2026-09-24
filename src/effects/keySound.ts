/**
 * Key typing SFX — free pack only in the shared graph.
 * Pro packs register from edition-pro/keySoundPacks.ts (side-effect import).
 */
import basicGeneric from "../assets/sfx/basic/generic.mp3";
import basicSpace from "../assets/sfx/basic/space.mp3";
import basicEnter from "../assets/sfx/basic/enter.mp3";
import basicBackspace from "../assets/sfx/basic/backspace.mp3";
import comboMiss from "../assets/sfx/combo/miss.mp3";

export type KeySoundId =
  | "basic"
  | "office"
  | "click"
  | "clickPbt"
  | "black"
  | "blackPbt"
  | "brown"
  | "brownPbt"
  | "red"
  | "redPbt"
  | "soft";

export type KeySoundKind = "generic" | "space" | "enter" | "backspace";

export type KeySoundListItem = {
  id: KeySoundId;
  label: string;
  premium: boolean;
};

export type KeySoundPackUrls = Record<KeySoundKind, string>;

export const KEY_SOUND_PACKS: KeySoundListItem[] = [
  { id: "basic", label: "Basic", premium: false },
];

const PACK_URLS: Partial<Record<KeySoundId, KeySoundPackUrls>> = {
  basic: {
    generic: basicGeneric,
    space: basicSpace,
    enter: basicEnter,
    backspace: basicBackspace,
  },
};

/** Called from edition-pro only — keeps Pro mp3s out of community bundles. */
export function registerKeySoundPacks(
  items: KeySoundListItem[],
  urls: Partial<Record<KeySoundId, KeySoundPackUrls>>,
) {
  for (const item of items) {
    if (!KEY_SOUND_PACKS.some((p) => p.id === item.id)) {
      KEY_SOUND_PACKS.push(item);
    }
  }
  Object.assign(PACK_URLS, urls);
}

const SOUND_KEY = "bubtype.keySound";
const VOLUME_KEY = "bubtype.keySoundVolume";
const DEFAULT_VOLUME = 0.55;

const pools = new Map<string, HTMLAudioElement[]>();

function poolOf(url: string): HTMLAudioElement[] {
  let list = pools.get(url);
  if (!list) {
    list = Array.from({ length: 6 }, () => {
      const a = new Audio(url);
      a.preload = "auto";
      a.volume = DEFAULT_VOLUME;
      return a;
    });
    pools.set(url, list);
  }
  return list;
}

export function playUrl(url: string, gain = 1) {
  const master = readKeySoundVolume();
  const volume = Math.max(0, Math.min(1, master * gain));
  if (volume <= 0.001) return;
  const list = poolOf(url);
  const free = list.find((a) => a.paused || a.ended) ?? list[0]!;
  try {
    free.pause();
    free.currentTime = 0;
    free.volume = volume;
    void free.play().catch(() => {});
  } catch {
    /* autoplay / missing decode */
  }
}

export function warmUrl(url: string) {
  poolOf(url);
}

export function parseKeySoundId(raw: unknown): KeySoundId {
  if (typeof raw === "string" && KEY_SOUND_PACKS.some((p) => p.id === raw)) {
    return raw as KeySoundId;
  }
  return "basic";
}

export function readKeySoundId(preferred?: string | null): KeySoundId {
  if (preferred) {
    const id = parseKeySoundId(preferred);
    if (isKeySoundAllowed(id)) return id;
  }
  try {
    const id = parseKeySoundId(localStorage.getItem(SOUND_KEY));
    if (!isKeySoundAllowed(id)) return "basic";
    return id;
  } catch {
    return "basic";
  }
}

export function writeKeySoundId(id: KeySoundId) {
  try {
    localStorage.setItem(SOUND_KEY, id);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("bubtype-key-sound"));
  void import("@tauri-apps/api/core").then(({ invoke }) => {
    void invoke("set_key_sound", { pack: id });
  });
}

export function readKeySoundVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw == null) return DEFAULT_VOLUME;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_VOLUME;
    return Math.max(0, Math.min(1, n));
  } catch {
    return DEFAULT_VOLUME;
  }
}

export function writeKeySoundVolume(volume: number) {
  const next = Math.max(0, Math.min(1, volume));
  try {
    localStorage.setItem(VOLUME_KEY, String(next));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("bubtype-key-sound-volume"));
}

export function isKeySoundAllowed(id: KeySoundId): boolean {
  const item = KEY_SOUND_PACKS.find((p) => p.id === id);
  if (!item) return false;
  if (!item.premium) return true;
  return licenseGate();
}

/** Avoid edition↔keySound import cycle; Pro bridge wires this. */
let licenseGate: () => boolean = () => false;

export function setKeySoundLicenseGate(fn: () => boolean) {
  licenseGate = fn;
}

export function keySoundKindFor(key: string): KeySoundKind {
  if (key === " " || key === "Spacebar" || key === "Space") return "space";
  if (key === "Enter") return "enter";
  if (key === "Backspace") return "backspace";
  return "generic";
}

export function playKeySound(opts: {
  ok: boolean;
  key?: string;
  pack?: KeySoundId;
  /** Allow locked Pro packs to play for shop try-out. */
  preview?: boolean;
}) {
  const pack = opts.pack ?? readKeySoundId();
  if (!opts.preview && !isKeySoundAllowed(pack)) return;
  const urls = PACK_URLS[pack];
  if (!urls) return;

  if (!opts.ok) {
    playUrl(comboMiss, 0.7);
    return;
  }
  const kind = keySoundKindFor(opts.key ?? "");
  playUrl(urls[kind], kind === "space" ? 0.9 : 1);
}

export function warmKeySounds() {
  const pack = readKeySoundId();
  const urls = PACK_URLS[pack];
  if (!urls) return;
  for (const url of Object.values(urls)) poolOf(url);
  poolOf(comboMiss);
}
