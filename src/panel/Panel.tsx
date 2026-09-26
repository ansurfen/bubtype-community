import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRotateLeft,
  faArrowUpFromBracket,
  faBook,
  faChartSimple,
  faCheck,
  faChevronLeft,
  faChevronRight,
  faCompass,
  faFire,
  faGear,
  faHouse,
  faPalette,
  faRotate,
  faTrash,
  faVolumeHigh,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AccountPage,
  ExportSheet,
  SkinsPage,
  getEntitlement,
  showAccountPage,
  showSkinsNav,
  subscribeEntitlement,
} from "../edition";
import ImportSheet from "../import/ImportSheet";
import FeedSheet from "../wordbook/FeedSheet";
import LibrarySearch from "./LibrarySearch";
import DiyBookEditor from "./DiyBookEditor";
import {
  rowsFromBookmarks,
  rowsFromLemmas,
  rowsFromWrong,
} from "../export/rows";
import type { ExportRow } from "../export/types";
import { ink } from "../color";
import { PremiumBadge } from "../chrome/PremiumBadge";
import { readPremiumBadgeStyle } from "../chrome/premiumBadgeStyles";
import ContextMenu, { type ContextMenuItem } from "../chrome/ContextMenu";
import {
  playKeySound,
  readKeySoundId,
  readKeySoundVolume,
  writeKeySoundId,
  writeKeySoundVolume,
} from "../effects/keySound";
import { readParticleSkin, writeParticleSkin } from "../effects/particleSkin";
import {
  patchComboSoundPrefs,
  readComboSoundPrefs,
  type ComboSoundPrefs,
} from "../effects/comboSoundPrefs";
import { defaultComboTheme } from "../effects/streak";
import { BUILTIN_FONT, fontStack } from "../font";
import { glossarySize, ensureGlossary, reloadGlossary, searchGlossary, oneLineGloss, clipOneLine, entryOf } from "../glossary";
import { clearDictHistory, pushDictHistory, readDictHistory } from "../glossary/dictHistory";
import { onGlossTrack, resolvePracticeGloss, isWordLikeText } from "../wordbook/glossTrack";
import { LOCALE_OPTIONS, GLOSS_LANG_OPTIONS, createT, normalizeLocale } from "../i18n";
import {
  TOOLBAR_ROWS,
  reorderToolbarBlocks,
  sanitizeToolbar,
  toggleNavPair,
  type ToolbarId,
} from "../toolbar";
import type { DayStats, Snapshot, VoiceInfo } from "../types";
import { todayKey } from "../types";
import type { InstalledWordbook, WordbookCatalog, WordbookFeed, WordbookPack } from "../wordbook/types";
import { isNewerVersion } from "../wordbook/types";
import WordDetail from "./WordDetail";
import NiceSelect from "./NiceSelect";
import TextSeg from "./TextSeg";
import ThemeRange from "./ThemeRange";
import Toggle from "./Toggle";
import ModePill from "./ModePill";
import PanelPractice from "./PanelPractice";
import "./panel.css";
import "./panel-practice.css";
import "../effects/skin-ink.css";

const SWATCHES = ["#ff4d6d", "#fbbf24", "#3b82f6", "#baf36d", "#a78bfa", "#fb923c"];
const RATE_OPTIONS = ["0.5", "0.75", "1", "1.25", "1.5", "2"];
const SIDE_COLLAPSE_KEY = "bubtype_panel_sidebar_collapsed";

function readSideCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDE_COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSideCollapsed(value: boolean) {
  try {
    localStorage.setItem(SIDE_COLLAPSE_KEY, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

type Tab = "practice" | "library" | "discover" | "skins" | "settings" | "account";
type SettingsSection = "interface" | "practice" | "voice" | "keys";
type SkinsSection = "visual" | "sound";

const NAV_TABS: Array<Exclude<Tab, "account">> = showSkinsNav
  ? ["practice", "discover", "library", "skins", "settings"]
  : ["practice", "discover", "library", "settings"];
const SETTINGS_SECTIONS: SettingsSection[] = ["interface", "practice", "voice", "keys"];
const SKINS_SECTIONS: SkinsSection[] = ["visual", "sound"];

const TAB_I18N: Record<Exclude<Tab, "account">, string> = {
  practice: "nav.practice",
  library: "nav.library",
  discover: "nav.discover",
  skins: "nav.skins",
  settings: "nav.settings",
};

const SETTINGS_I18N: Record<SettingsSection, string> = {
  interface: "nav.interface",
  practice: "nav.settingsPractice",
  voice: "nav.voice",
  keys: "nav.keys",
};

const SKINS_I18N: Record<SkinsSection, string> = {
  visual: "effects.visualTitle",
  sound: "effects.soundTitle",
};

function NavIcon({ name }: { name: Exclude<Tab, "account"> }) {
  const icon =
    name === "practice"
      ? faHouse
      : name === "library"
        ? faBook
        : name === "discover"
          ? faCompass
          : name === "skins"
            ? faPalette
            : faGear;
  return <FontAwesomeIcon icon={icon} />;
}

const SYSTEM_PACKS = ["wrong", "bookmarks", "review", "dict"] as const;

type WordbookListDto = {
  items: InstalledWordbook[];
  activeId: string | null;
};

type BookProgress = {
  op: string;
  id?: string | null;
  title?: string | null;
  phase: string;
  loaded: number;
  total: number;
  percent: number;
  message?: string | null;
};

type PiperCatalog = {
  version: number;
  provider: string;
  source?: string;
  runtime: { id: string; version: string; url: string; sizeHintMb?: number };
  voices: Array<{
    id: string;
    name: string;
    language: string;
    quality: string;
    gender?: string;
    ageGroup?: string;
    numSpeakers?: number;
    sizeHintMb?: number;
    modelUrl: string;
    configUrl: string;
  }>;
};

type PiperInstalledDto = {
  items: Array<{
    id: string;
    name: string;
    language: string;
    quality: string;
    installedAt: string;
  }>;
  runtimeReady: boolean;
};

function pct(correct: number, typed: number) {
  if (typed <= 0) return "—";
  return `${Math.round((correct / typed) * 100)}%`;
}

function luminance(hex: string) {
  const raw = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return 0.7;
  const r = Number.parseInt(raw.slice(0, 2), 16) / 255;
  const g = Number.parseInt(raw.slice(2, 4), 16) / 255;
  const b = Number.parseInt(raw.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function heatLevel(sentences: number) {
  if (sentences <= 0) return 0;
  if (sentences === 1) return 1;
  if (sentences <= 3) return 2;
  if (sentences <= 6) return 3;
  return 4;
}

function formatStudySecs(secs: number) {
  const total = Math.max(0, Math.floor(secs));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function lastNDayKeys(endYmd: string, n: number) {
  const parts = endYmd.split("-").map(Number);
  const y = parts[0] ?? 1970;
  const m = (parts[1] ?? 1) - 1;
  const d = parts[2] ?? 1;
  const end = new Date(y, m, d);
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    keys.push(dateYmd(addDays(end, -i)));
  }
  return keys;
}

function WeekSpark({
  values,
  color,
}: {
  values: number[];
  color: string;
}) {
  const w = 160;
  const h = 44;
  const pad = 2;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / Math.max(1, values.length - 1);
    const y = h - pad - (v / max) * (h - pad * 2);
    return `${x},${y}`;
  });
  const line = pts.join(" ");
  const area = `${pad},${h - pad} ${line} ${w - pad},${h - pad}`;
  return (
    <svg className="week-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polygon points={area} fill={color} opacity="0.18" />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ymd(year: number, monthIndex: number, day: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateYmd(d: Date) {
  return ymd(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number) {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  next.setDate(next.getDate() + n);
  return next;
}

/** Monday 00:00 of the week containing `d`. */
function startOfWeekMonday(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const weekday = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - weekday);
  return x;
}

const HEAT_WEEKS = 53;

type HeatCell = {
  key: string;
  level: number;
  tip: string;
  future: boolean;
  empty?: boolean;
};

type HeatWeek = {
  key: string;
  monthLabel: string;
  cells: HeatCell[];
};

function monthShort(monthIndex: number, locale: string) {
  if (locale.startsWith("zh")) return `${monthIndex + 1}月`;
  return new Date(2024, monthIndex, 1).toLocaleString("en", { month: "short" });
}

/** GitHub-style columns: weeks ending at `endWeekStart` (a Monday), going left. */
function buildHeatWindow(
  endWeekStart: Date,
  weekCount: number,
  days: Record<string, DayStats>,
  today: string,
  locale: string,
): HeatWeek[] {
  const weeks: HeatWeek[] = [];
  let lastLabeledMonth = -1;
  for (let w = weekCount - 1; w >= 0; w -= 1) {
    const weekStart = addDays(endWeekStart, -w * 7);
    const cells: HeatCell[] = [];
    let monthLabel = "";
    for (let d = 0; d < 7; d += 1) {
      const date = addDays(weekStart, d);
      const key = dateYmd(date);
      const future = key > today;
      const entry = days[key];
      const sentences = entry?.sentences ?? 0;
      const typed = entry?.typed ?? 0;
      const correct = entry?.correct ?? 0;
      const wrong = entry?.wrong ?? 0;
      const combo = entry?.maxCombo ?? 0;
      const level = future ? 0 : heatLevel(sentences);
      const tip =
        future || !entry || (typed <= 0 && sentences <= 0)
          ? key
          : `${key} · ${sentences} · ${typed} · ${pct(correct, typed)} · ${wrong} · Combo ${combo}`;
      cells.push({ key, level, tip, future });
      if (date.getDate() === 1) {
        const m = date.getMonth();
        if (m !== lastLabeledMonth) {
          monthLabel = monthShort(m, locale);
          lastLabeledMonth = m;
        }
      }
    }
    if (!monthLabel && w === weekCount - 1) {
      const m = weekStart.getMonth();
      monthLabel = monthShort(m, locale);
      lastLabeledMonth = m;
    }
    weeks.push({ key: dateYmd(weekStart), monthLabel, cells });
  }
  return weeks;
}

function captionOf(settings: Snapshot["settings"]) {
  if (typeof settings.captionOpacity === "number") return settings.captionOpacity;
  return settings.comboBlur === false ? 0 : 0.82;
}

export default function Panel() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [piperCatalog, setPiperCatalog] = useState<PiperCatalog | null>(null);
  const [piperRuntimeReady, setPiperRuntimeReady] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceProgress, setVoiceProgress] = useState<BookProgress | null>(null);
  const [installingVoiceId, setInstallingVoiceId] = useState<string | null>(null);
  const [voiceGender, setVoiceGender] = useState("all");
  const [voiceLang, setVoiceLang] = useState("all");
  const [fonts, setFonts] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("practice");
  const [livePractice, setLivePractice] = useState(false);
  const [sideCollapsed, setSideCollapsed] = useState(readSideCollapsed);
  const [sideEdgeHover, setSideEdgeHover] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("interface");
  const [skinsSection, setSkinsSection] = useState<SkinsSection>("visual");
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [entitlement, setEntitlement] = useState(getEntitlement);
  const [badgeStyle, setBadgeStyle] = useState(readPremiumBadgeStyle);
  const [keySoundVolume, setKeySoundVolume] = useState(readKeySoundVolume);
  const [comboSoundPrefs, setComboSoundPrefs] = useState(readComboSoundPrefs);
  const [mineShelf, setMineShelf] = useState<
    "wrong" | "bookmarks" | "dict" | "diy"
  >("bookmarks");
  const [diyBookId, setDiyBookId] = useState<string | null>(null);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [discoverQuery, setDiscoverQuery] = useState("");
  const [dictHistory, setDictHistory] = useState(readDictHistory);
  const [practiceSheet, setPracticeSheet] = useState<null | "packs" | "items">(null);
  const [sessionPrompt, setSessionPrompt] = useState<null | {
    id: string;
    title: string;
  }>(null);
  const [sessionMode, setSessionMode] = useState<"sequential" | "random">("sequential");
  const [sessionSize, setSessionSize] = useState(50);
  const [createBookOpen, setCreateBookOpen] = useState(false);
  const [createBookTitle, setCreateBookTitle] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<null | {
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
  }>(null);
  const [shelfSelected, setShelfSelected] = useState<Record<string, boolean>>({});
  const shelfSelectedRef = useRef(shelfSelected);
  const shelfBrushRef = useRef<{ paint: boolean } | null>(null);
  const [shelfGhosts, setShelfGhosts] = useState<
    Array<{
      shelf: "wrong" | "bookmarks";
      key: string;
      title: string;
      sub: string;
      date: string;
      practiceText: string;
      text?: string;
      hint?: string | null;
      misses?: number;
      lastAt?: string;
      savedAt?: string;
    }>
  >([]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const spyLockUntil = useRef(0);
  const [detailLemma, setDetailLemma] = useState<string | null>(null);
  const [libCtx, setLibCtx] = useState<null | {
    x: number;
    y: number;
    title: string;
    canPractice: boolean;
    shelfId: "wrong" | "bookmarks" | "dict" | "diy";
    onOpen?: () => void;
    onDel?: () => void;
  }>(null);
  const [exportJob, setExportJob] = useState<null | { title: string; rows: ExportRow[] }>(
    null,
  );
  const [importOpen, setImportOpen] = useState(false);
  const heatTrackRef = useRef<HTMLDivElement>(null);
  const [lemmaCount, setLemmaCount] = useState(0);
  const [bookCatalog, setBookCatalog] = useState<WordbookCatalog | null>(null);
  const [bookInstalled, setBookInstalled] = useState<InstalledWordbook[]>([]);
  const [, setBookActiveId] = useState<string | null>(null);
  const [booksBusy, setBooksBusy] = useState(false);
  const [bookProgress, setBookProgress] = useState<BookProgress | null>(null);
  const [bookFeeds, setBookFeeds] = useState<WordbookFeed[]>([]);
  const [feedsOpen, setFeedsOpen] = useState(false);

  async function refreshWordbooks(opts?: { quiet?: boolean }) {
    const quiet = opts?.quiet === true;
    if (!quiet) {
      setBooksBusy(true);
      setBookProgress({
        op: "catalog",
        phase: "resolve",
        loaded: 0,
        total: 0,
        percent: 2,
        message: null,
      });
    }
    try {
      const [catalog, installed, feeds] = await Promise.all([
        invoke<WordbookCatalog>("list_wordbook_catalog", { quiet }),
        invoke<WordbookListDto>("list_installed_wordbooks"),
        invoke<WordbookFeed[]>("list_wordbook_feeds").catch(() => [] as WordbookFeed[]),
      ]);
      setBookCatalog(catalog);
      setBookInstalled(installed.items ?? []);
      setBookActiveId(installed.activeId ?? null);
      setBookFeeds(feeds);
      setMessage(null);
      void invoke("ensure_practice_pools"); // fire-and-forget; caches are tiny after first build
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBooksBusy(false);
      setBookProgress(null);
    }
  }

  useEffect(() => {
    if (tab !== "practice") setLivePractice(false);
    if (tab !== "practice") setPracticeSheet(null);
  }, [tab]);

  // One-shot: lift localStorage skin/sound into shared settings (webview-safe).
  useEffect(() => {
    if (!snap) return;
    const skin = readParticleSkin();
    if (skin !== "classic" && (snap.settings.particleSkin || "classic") === "classic") {
      writeParticleSkin(skin);
    }
    const sound = readKeySoundId();
    if (sound !== "basic" && (snap.settings.keySound || "basic") === "basic") {
      writeKeySoundId(sound);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot migrate only
  }, [!!snap]);

  useEffect(() => {
    if (!snap) return;
    let cancelled = false;
    void ensureGlossary(snap.settings.glossLang || "zh").then(() => {
      if (!cancelled) setLemmaCount(glossarySize());
    });
    return () => {
      cancelled = true;
    };
  }, [snap?.settings.glossLang]);

  useEffect(() => {
    if (tab !== "library" || !snap) return;
    void ensureGlossary(snap.settings.glossLang || "zh").then(() => {
      setLemmaCount(glossarySize());
    });
  }, [tab, mineShelf, snap?.settings.glossLang]);

  useEffect(() => {
    shelfSelectedRef.current = shelfSelected;
  }, [shelfSelected]);

  useEffect(() => {
    setShelfSelected({});
    shelfBrushRef.current = null;
    setShelfGhosts([]);
  }, [mineShelf]);

  // Clear any sticky panel-practice lock left by HMR / missed cleanups.
  useEffect(() => {
    void invoke("set_panel_practice", { active: false });
    return () => {
      void invoke("set_panel_practice", { active: false });
    };
  }, []);

  useEffect(() => {
    if (!livePractice) return;
    void invoke("set_panel_practice", { active: true });
    return () => {
      void invoke("set_panel_practice", { active: false });
    };
  }, [livePractice]);

  useEffect(() => {
    const sync = () => {
      setEntitlement(getEntitlement());
      setBadgeStyle(readPremiumBadgeStyle());
    };
    const onEntitlement = (event: Event) => {
      const detail = (event as CustomEvent<{ licensed?: boolean; licenseKey?: string | null }>)
        .detail;
      if (detail && typeof detail.licensed === "boolean") {
        setEntitlement({
          edition: "pro",
          tier: detail.licensed ? "pro" : "free",
          licensed: detail.licensed,
          licenseKey: detail.licensed ? detail.licenseKey ?? null : null,
        });
      } else {
        sync();
      }
      setBadgeStyle(readPremiumBadgeStyle());
    };
    const unsubEnt = subscribeEntitlement(sync);
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === "bubtype.licenseKey" ||
        event.key === "bubtype.premiumBadgeStyle"
      ) {
        sync();
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", sync);
    window.addEventListener("bubtype-premium-badge-style", sync);
    window.addEventListener("bubtype-entitlement", onEntitlement);
    return () => {
      unsubEnt();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", sync);
      window.removeEventListener("bubtype-premium-badge-style", sync);
      window.removeEventListener("bubtype-entitlement", onEntitlement);
    };
  }, []);

  useEffect(() => {
    if (tab !== "discover") return;
    void refreshWordbooks({ quiet: true });
  }, [tab]);

  useEffect(() => {
    if (tab !== "practice") return;
    void invoke<WordbookListDto>("list_installed_wordbooks")
      .then((installed) => {
        setBookInstalled(installed.items ?? []);
        setBookActiveId(installed.activeId ?? null);
      })
      .catch(() => {
        /* optional */
      });
  }, [tab]);

  async function refreshVoices() {
    try {
      const nextVoices = await invoke<VoiceInfo[]>("list_voices");
      setVoices(nextVoices);
      const engine = snap?.settings.ttsEngine || "system";
      if (engine === "piper") {
        const [catalog, installed] = await Promise.all([
          invoke<PiperCatalog>("list_piper_catalog"),
          invoke<PiperInstalledDto>("list_piper_installed"),
        ]);
        setPiperCatalog(catalog);
        setPiperRuntimeReady(installed.runtimeReady);
      }
    } catch (err) {
      setMessage(String(err));
    }
  }

  useEffect(() => {
    if (tab !== "settings") return;
    void refreshVoices();
  }, [tab, snap?.settings.ttsEngine]);

  useEffect(() => {
    if (tab !== "settings") return;
    const root = bodyRef.current;
    if (!root) return;
    const onScroll = () => {
      if (Date.now() < spyLockUntil.current) return;
      const y = root.scrollTop + 28;
      let active: SettingsSection = SETTINGS_SECTIONS[0];
      for (const id of SETTINGS_SECTIONS) {
        const el = root.querySelector<HTMLElement>(`#settings-${id}`);
        if (!el) continue;
        if (el.offsetTop <= y) active = id;
        else break;
      }
      setSettingsSection((prev) => (prev === active ? prev : active));
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => root.removeEventListener("scroll", onScroll);
  }, [tab]);

  useEffect(() => {
    if (tab !== "skins") return;
    const root = bodyRef.current;
    if (!root) return;
    const onScroll = () => {
      if (Date.now() < spyLockUntil.current) return;
      const y = root.scrollTop + 28;
      let active: SkinsSection = SKINS_SECTIONS[0]!;
      for (const id of SKINS_SECTIONS) {
        const el = root.querySelector<HTMLElement>(`#skins-${id}`);
        if (!el) continue;
        if (el.offsetTop <= y) active = id;
        else break;
      }
      setSkinsSection((prev) => (prev === active ? prev : active));
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => root.removeEventListener("scroll", onScroll);
  }, [tab]);

  function openSettings(section: SettingsSection = "interface") {
    setTab("settings");
    setSettingsSection(section);
    setDetailLemma(null);
    spyLockUntil.current = Date.now() + 450;
    window.requestAnimationFrame(() => {
      const root = bodyRef.current;
      const el = root?.querySelector<HTMLElement>(`#settings-${section}`);
      if (!root || !el) return;
      root.scrollTo({ top: Math.max(0, el.offsetTop - 8), behavior: "smooth" });
    });
  }

  function openSkins(section: SkinsSection = "visual") {
    setTab("skins");
    setSkinsSection(section);
    setDetailLemma(null);
    spyLockUntil.current = Date.now() + 450;
    window.requestAnimationFrame(() => {
      const root = bodyRef.current;
      const el = root?.querySelector<HTMLElement>(`#skins-${section}`);
      if (!root || !el) return;
      root.scrollTo({ top: Math.max(0, el.offsetTop - 8), behavior: "smooth" });
    });
  }

  useEffect(() => {
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    void listen<BookProgress>("wordbook-progress", (event) => {
      if (cancelled) return;
      const phase = event.payload.phase;
      setBookProgress(event.payload);
      if (phase === "done" || phase === "error") {
        window.setTimeout(() => {
          if (cancelled) return;
          setBooksBusy(false);
          setBookProgress((cur) =>
            cur && (cur.phase === "done" || cur.phase === "error") ? null : cur,
          );
        }, phase === "done" ? 500 : 0);
        return;
      }
      setBooksBusy(true);
    }).then((fn) => {
      if (cancelled) fn();
      else unsubs.push(fn);
    });
    void listen<BookProgress>("voice-progress", (event) => {
      if (cancelled) return;
      const phase = event.payload.phase;
      if (phase === "done" || phase === "error") {
        setVoiceProgress(null);
        setVoiceBusy(false);
        return;
      }
      setVoiceProgress(event.payload);
    }).then((fn) => {
      if (cancelled) fn();
      else unsubs.push(fn);
    });
    return () => {
      cancelled = true;
      unsubs.forEach((fn) => fn());
    };
  }, []);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    void listen("open-settings", () => {
      openSettings("interface");
    }).then((fn) => {
      unsub = fn;
    });
    return () => unsub?.();
  }, []);

  useEffect(() => {
    const sync = () => setKeySoundVolume(readKeySoundVolume());
    window.addEventListener("bubtype-key-sound-volume", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("bubtype-key-sound-volume", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    const sync = () => setComboSoundPrefs(readComboSoundPrefs());
    window.addEventListener("bubtype-combo-sound-prefs", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("bubtype-combo-sound-prefs", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  function setComboPref(patch: Partial<ComboSoundPrefs>) {
    setComboSoundPrefs(patchComboSoundPrefs(patch));
  }

  useEffect(() => {
    let cancelled = false;
    const loadSnapshot = (attempt = 0) => {
      void invoke<Snapshot>("get_snapshot")
        .then((next) => {
          if (cancelled) return;
          setSnap(next);
          setMessage(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const text = String(err);
          if (attempt < 12 && /还在启动|not managed|manage/i.test(text)) {
            window.setTimeout(() => loadSnapshot(attempt + 1), 80);
            return;
          }
          setMessage(text);
        });
    };
    loadSnapshot();
    void invoke<VoiceInfo[]>("list_voices")
      .then((next) => {
        if (!cancelled) setVoices(next);
      })
      .catch(() => {
        /* voice list is optional at boot */
      });
    void invoke<string[]>("list_fonts")
      .then((next) => {
        if (!cancelled) setFonts(next);
      })
      .catch(() => {
        /* fonts are optional at boot */
      });
    const unsubs: Array<() => void> = [];
    void listen<Snapshot>("snapshot", (event) => {
      setSnap(event.payload);
    }).then((fn) => unsubs.push(fn));
    void listen<{ lemma: string }>("word-detail", (event) => {
      setDetailLemma(event.payload.lemma);
    }).then((fn) => unsubs.push(fn));
    return () => {
      cancelled = true;
      unsubs.forEach((fn) => fn());
    };
  }, []);

  const today = snap?.stats?.day || todayKey();
  const heatLocale = normalizeLocale(snap?.settings.uiLocale);
  const thisWeekStart = useMemo(() => startOfWeekMonday(new Date()), [today]);
  const heatWeeks = useMemo(
    () =>
      buildHeatWindow(
        thisWeekStart,
        HEAT_WEEKS,
        snap?.stats?.days ?? {},
        today,
        heatLocale,
      ),
    [thisWeekStart, snap?.stats?.days, today, heatLocale],
  );

  useEffect(() => {
    const el = heatTrackRef.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
  }, [heatWeeks, tab]);

  const weekKeys = useMemo(() => lastNDayKeys(today, 7), [today]);
  const weekSeries = useMemo(() => {
    const days = snap?.stats?.days ?? {};
    return weekKeys.map((key) => {
      const entry = days[key];
      const typed = entry?.typed ?? (key === today ? snap?.stats?.dayTyped ?? 0 : 0);
      const correct = entry?.correct ?? (key === today ? snap?.stats?.dayCorrect ?? 0 : 0);
      const sentences =
        entry?.sentences ?? (key === today ? snap?.stats?.daySentences ?? 0 : 0);
      const study =
        entry?.studySecs ?? (key === today ? snap?.stats?.dayStudySecs ?? 0 : 0);
      const accuracy = typed > 0 ? Math.round((correct / typed) * 100) : 0;
      return { key, sentences, accuracy, study };
    });
  }, [weekKeys, snap?.stats, today]);
  const heatSessions = useMemo(
    () =>
      heatWeeks.reduce(
        (sum, week) => sum + week.cells.filter((c) => c.level > 0 && !c.future).length,
        0,
      ),
    [heatWeeks],
  );

  if (!snap) {
    const t = createT("zh-CN");
    return (
      <main className="panel" style={{ ["--theme" as string]: "#ff4d6d" }}>
        <div className="panel-body">
          <aside className="side">
            <div className="brand">
              <img className="brand-mark" src="/logo-brand.png?v=12" alt="" aria-hidden />
              BubType
            </div>
          </aside>
          <div className="main">
            <div className="body">
              <p>{message ? t("boot.fail", { msg: message }) : t("boot.loading")}</p>
              {message ? (
                <button type="button" onClick={() => window.location.reload()}>
                  {t("boot.retry")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </main>
    );
  }

  const t = createT(snap.settings.uiLocale);
  const dark = snap.settings.uiDark === true;
  const item = snap.items[snap.index];
  const color = snap.settings.fontColor;
  const captionOpacity = captionOf(snap.settings);

  async function openPack(
    id: string,
    opts?: { mode?: "sequential" | "random"; size?: number; lemmas?: string[] },
  ) {
    try {
      const system = (SYSTEM_PACKS as readonly string[]).includes(id);
      const next = system
        ? await invoke<Snapshot>("load_system_practice", {
            id,
            lemmas: opts?.lemmas ?? null,
          })
        : await invoke<Snapshot>("load_wordbook_practice", {
            id,
            mode: opts?.mode ?? null,
            size: opts?.size ?? null,
            lemmas: opts?.lemmas ?? null,
          });
      setSnap(next);
      setTab("practice");
      setPracticeSheet(null);
      setSessionPrompt(null);
      setMessage(null);
    } catch (err) {
      setMessage(String(err));
    }
  }

  async function openShelfExport(id: "wrong" | "bookmarks" | "dict", lemmas?: string[]) {
    await ensureGlossary(snap?.settings.glossLang || "zh");
    if (id === "wrong") {
      setExportJob({ title: t("mine.wrong"), rows: rowsFromWrong(wrongBook) });
      return;
    }
    if (id === "dict") {
      setExportJob({
        title: t("mine.dict"),
        rows: rowsFromLemmas(lemmas ?? []),
      });
      return;
    }
    setExportJob({
      title: t("mine.bookmarks"),
      rows: rowsFromBookmarks(snap?.bookmarks ?? []),
    });
  }

  async function openWordbookExport(id: string, title: string) {
    try {
      await ensureGlossary();
      const pack = await invoke<WordbookPack>("get_wordbook", { id });
      const lemmas =
        pack.lemmas?.length > 0
          ? pack.lemmas
          : (pack.items ?? []).map((item) => item.text).filter(Boolean);
      setExportJob({ title, rows: rowsFromLemmas(lemmas) });
    } catch (err) {
      setMessage(String(err));
    }
  }

  function askStartPack(id: string, title: string) {
    const prog = progressForPack("pack", id);
    setSessionMode(prog && prog.done > 0 ? "sequential" : "sequential");
    setSessionSize(50);
    setSessionPrompt({ id, title });
  }

  function progressForPack(kind: string, id: string) {
    const key = `${kind}:${id}`;
    return (snap?.progressList ?? []).find((p) => p.key === key) ?? null;
  }

  function openDiyEditor(id: string) {
    setTab("library");
    setMineShelf("diy");
    setDiyBookId(id);
    setLibraryQuery("");
  }

  async function finishDiyImport(installed: InstalledWordbook) {
    setImportOpen(false);
    setBooksBusy(true);
    try {
      await refreshWordbooks({ quiet: true });
      void reloadGlossary(snap?.settings.glossLang || "zh").then(() => {
        setLemmaCount(glossarySize());
      });
      openDiyEditor(installed.id);
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBooksBusy(false);
      setBookProgress(null);
    }
  }

  async function createDiyBook(title: string) {
    const trimmed = title.trim();
    if (!trimmed) {
      setMessage(t("mine.diyCreateTitle"));
      return;
    }
    setCreateBookOpen(false);
    setCreateBookTitle("");
    setBooksBusy(true);
    try {
      const installed = await invoke<InstalledWordbook>("create_diy_wordbook", {
        title: trimmed,
        lang: "en",
        glossLang: snap?.settings.glossLang || "zh",
      });
      await refreshWordbooks({ quiet: true });
      openDiyEditor(installed.id);
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBooksBusy(false);
      setBookProgress(null);
    }
  }

  async function installWordbook(id: string) {
    setBooksBusy(true);
    setBookProgress({
      op: "install",
      id,
      phase: "resolve",
      loaded: 0,
      total: 0,
      percent: 2,
      message: null,
    });
    try {
      await invoke("install_wordbook", { id });
      await refreshWordbooks({ quiet: true });
      // Glossary merge is heavy (Oxford phrases) — don't block the UI thread on it.
      void reloadGlossary(snap?.settings.glossLang || "zh").then(() => {
        setLemmaCount(glossarySize());
      });
      void invoke("ensure_practice_pools");
    } catch (err) {
      setMessage(String(err));
      setBooksBusy(false);
      setBookProgress(null);
    }
  }

  async function softSyncWordbookFeeds() {
    try {
      const catalog = await invoke<WordbookCatalog>("sync_wordbook_feeds", { quiet: true });
      const [installed, feeds] = await Promise.all([
        invoke<WordbookListDto>("list_installed_wordbooks"),
        invoke<WordbookFeed[]>("list_wordbook_feeds"),
      ]);
      setBookCatalog(catalog);
      setBookInstalled(installed.items ?? []);
      setBookFeeds(feeds);
    } catch {
      /* keep cached catalog */
    }
  }

  async function syncWordbookFeeds() {
    setBooksBusy(true);
    setBookProgress({
      op: "catalog",
      phase: "download",
      loaded: 0,
      total: 0,
      percent: 8,
      message: null,
    });
    try {
      const catalog = await invoke<WordbookCatalog>("sync_wordbook_feeds", { quiet: false });
      const [installed, feeds] = await Promise.all([
        invoke<WordbookListDto>("list_installed_wordbooks"),
        invoke<WordbookFeed[]>("list_wordbook_feeds"),
      ]);
      setBookCatalog(catalog);
      setBookInstalled(installed.items ?? []);
      setBookFeeds(feeds);
      setMessage(null);
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBooksBusy(false);
      setBookProgress(null);
    }
  }

  async function addWordbookFeed(url: string) {
    const trimmed = url.trim();
    if (!trimmed) return;
    setBooksBusy(true);
    try {
      const feeds = await invoke<WordbookFeed[]>("add_wordbook_feed", {
        url: trimmed,
        label: null,
      });
      setBookFeeds(feeds);
      await syncWordbookFeeds();
    } catch (err) {
      setMessage(String(err));
      setBooksBusy(false);
    }
  }

  async function removeWordbookFeed(id: string) {
    setBooksBusy(true);
    try {
      const feeds = await invoke<WordbookFeed[]>("remove_wordbook_feed", { id });
      setBookFeeds(feeds);
      await refreshWordbooks({ quiet: true });
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBooksBusy(false);
    }
  }

  function openFeedsSheet() {
    setFeedsOpen(true);
    void softSyncWordbookFeeds();
  }

  async function saveHotkey(action: string, accelerator: string) {
    try {
      setSnap(await invoke<Snapshot>("set_hotkey", { action, accelerator }));
      setMessage(null);
    } catch (err) {
      setMessage(String(err));
    }
  }

  async function resetHotkeys() {
    try {
      setSnap(await invoke<Snapshot>("reset_hotkeys"));
      setMessage(null);
    } catch (err) {
      setMessage(String(err));
    }
  }

  const stats = snap.stats ?? {
    typed: 0,
    correct: 0,
    sentences: 0,
    wrong: 0,
    maxStreak: 0,
    day: "",
    dayTyped: 0,
    dayCorrect: 0,
    daySentences: 0,
    dayWrong: 0,
    dayNewLearned: 0,
    dayReviewed: 0,
    dayStudySecs: 0,
    totalLearned: 0,
    days: {},
    currentStreak: 0,
    longestStreak: 0,
  };
  const wrongBook = snap.wrongBook ?? [];
  const heatColor = /^#[0-9a-fA-F]{6}$/i.test(snap.settings.fontColor)
    ? snap.settings.fontColor
    : "#ff4d6d";
  const themeInk = luminance(heatColor) > 0.55 ? "#141414" : "#ffffff";

  const tabTitle =
    tab === "account" ? t("account.title") : t(TAB_I18N[tab]);

  function toggleSideCollapsed() {
    setSideCollapsed((prev) => {
      const next = !prev;
      writeSideCollapsed(next);
      return next;
    });
  }

  return (
    <main
      className="panel"
      data-scheme={dark ? "dark" : "light"}
      data-side={sideCollapsed ? "collapsed" : "expanded"}
      style={
        {
          ["--theme" as string]: heatColor,
          ["--theme-ink" as string]: themeInk,
        } as CSSProperties
      }
      onContextMenu={(event) => {
        const el = event.target as HTMLElement | null;
        if (el?.closest("input, textarea, [contenteditable='true']")) return;
        if (el?.closest(".library-row, .panel-practice, .ctx-menu")) return;
        event.preventDefault();
      }}
    >
      <div className="panel-body">
        <aside className={`side${sideCollapsed ? " collapsed" : ""}`}>
          <button
            type="button"
            className="brand"
            onClick={() => {
              if (sideCollapsed) {
                writeSideCollapsed(false);
                setSideCollapsed(false);
              }
            }}
            title={sideCollapsed ? t("nav.sideExpand") : undefined}
          >
            <img className="brand-mark" src="/logo-brand.png?v=12" alt="" aria-hidden />
            <span className="brand-word">BubType</span>
          </button>
          <nav className="side-nav">
            {NAV_TABS.map((id) => {
              const active = tab === id;
              return (
                <div key={id} className={`side-nav-block${active ? " open" : ""}`}>
                  <button
                    type="button"
                    className={`side-nav-item${active ? " active" : ""}`}
                    title={sideCollapsed ? t(TAB_I18N[id]) : undefined}
                    onClick={() => {
                      if (id === "settings") {
                        openSettings(settingsSection);
                        return;
                      }
                      if (id === "skins") {
                        openSkins(skinsSection);
                        return;
                      }
                      setTab(id);
                      if (id !== "library") setDetailLemma(null);
                    }}
                  >
                    <span className="side-nav-ico">
                      <NavIcon name={id} />
                    </span>
                    <span className="side-nav-label">{t(TAB_I18N[id])}</span>
                  </button>
                  {id === "settings" && active && !sideCollapsed ? (
                    <div className="side-settings-tree" role="navigation" aria-label={t("nav.settings")}>
                      <span className="side-settings-guide" aria-hidden />
                      {SETTINGS_SECTIONS.map((section) => {
                        const on = settingsSection === section;
                        return (
                          <button
                            key={section}
                            type="button"
                            className={on ? "active" : ""}
                            onClick={() => openSettings(section)}
                          >
                            {on ? <span className="side-settings-rail" aria-hidden /> : null}
                            <span>{t(SETTINGS_I18N[section])}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {id === "skins" && active && !sideCollapsed ? (
                    <div className="side-settings-tree" role="navigation" aria-label={t("nav.skins")}>
                      <span className="side-settings-guide" aria-hidden />
                      {SKINS_SECTIONS.map((section) => {
                        const on = skinsSection === section;
                        return (
                          <button
                            key={section}
                            type="button"
                            className={on ? "active" : ""}
                            onClick={() => openSkins(section)}
                          >
                            {on ? <span className="side-settings-rail" aria-hidden /> : null}
                            <span>{t(SKINS_I18N[section])}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </nav>
          <div
            className={`side-user${sideCollapsed ? " collapsed" : ""}${
              showAccountPage && entitlement.licensed ? " premium" : ""
            }${tab === "account" ? " active" : ""}`}
          >
            {showAccountPage ? (
              <button
                type="button"
                className="side-user-main"
                data-mark={entitlement.licensed ? "P" : "F"}
                title={
                  sideCollapsed
                    ? entitlement.licensed
                      ? t("skins.tierPro")
                      : t("skins.tierFree")
                    : undefined
                }
                onClick={() => setTab("account")}
              >
                <span className="side-user-meta">
                  {entitlement.licensed ? (
                    <span className="side-user-row">
                      <PremiumBadge
                        label={t("skins.tierPro")}
                        active
                        styleId={badgeStyle}
                        size="sm"
                      />
                    </span>
                  ) : (
                    <span className="side-tier free">{t("skins.tierFree")}</span>
                  )}
                  <span className="side-user-streak">
                    <FontAwesomeIcon icon={faFire} className="side-user-flame" />
                    {sideCollapsed
                      ? String(stats.currentStreak ?? 0)
                      : t("account.streak", { n: String(stats.currentStreak ?? 0) })}
                  </span>
                </span>
              </button>
            ) : (
              <div
                className="side-user-main static"
                data-mark="F"
                title={sideCollapsed ? t("skins.tierFree") : undefined}
              >
                <span className="side-user-meta">
                  <span className="side-tier free">{t("skins.tierFree")}</span>
                  <span className="side-user-streak">
                    <FontAwesomeIcon icon={faFire} className="side-user-flame" />
                    {sideCollapsed
                      ? String(stats.currentStreak ?? 0)
                      : t("account.streak", { n: String(stats.currentStreak ?? 0) })}
                  </span>
                </span>
              </div>
            )}
          </div>
          <button
            type="button"
            className={`side-edge${sideEdgeHover ? " hover" : ""}`}
            aria-label={sideCollapsed ? t("nav.sideExpand") : t("nav.sideCollapse")}
            title={sideCollapsed ? t("nav.sideExpand") : t("nav.sideCollapse")}
            onClick={toggleSideCollapsed}
            onMouseEnter={() => setSideEdgeHover(true)}
            onMouseLeave={() => setSideEdgeHover(false)}
          >
            {sideEdgeHover ? (
              <FontAwesomeIcon icon={sideCollapsed ? faChevronRight : faChevronLeft} />
            ) : (
              <span className="side-edge-line" aria-hidden />
            )}
          </button>
        </aside>

        <div className={`main${livePractice ? " live-practice" : ""}`}>
        {livePractice ? (
          <PanelPractice
            snap={snap}
            t={t}
            onExit={() => setLivePractice(false)}
            onOpenPacks={() => setPracticeSheet("packs")}
            onOpenItems={() => setPracticeSheet("items")}
          />
        ) : (
          <>
        <header className={`top${tab === "practice" ? " practice-top" : ""}`}>
          <div className="top-main">
            {tab === "practice" ? (
              <>
                <div className="top-practice-title">
                  <h1
                    style={
                      item?.text
                        ? {
                            color: ink(color, 1),
                            fontFamily: fontStack(snap.settings.fontFamily || BUILTIN_FONT),
                          }
                        : undefined
                    }
                  >
                    {item?.text?.trim() || tabTitle}
                  </h1>
                  {(() => {
                    const raw = item?.text?.trim() || "";
                    if (!raw || !isWordLikeText(raw)) return null;
                    const ipa = entryOf(raw)?.ipa?.trim() || "";
                    if (!ipa) return null;
                    return (
                      <span className="top-practice-ipa">
                        /{ipa.replace(/^\/|\/$/g, "")}/
                      </span>
                    );
                  })()}
                  {item?.text ? (
                    <button
                      type="button"
                      className="top-speak"
                      aria-label={t("quick.repeat")}
                      title={t("quick.repeat")}
                      onClick={() => void invoke("repeat_speak")}
                    >
                      <FontAwesomeIcon icon={faVolumeHigh} />
                    </button>
                  ) : null}
                </div>
                {(() => {
                  const want = snap.settings.glossLang || "zh";
                  const packMeta = bookInstalled.find((b) => b.id === snap.wordbookId);
                  const raw = item?.text?.trim() || "";
                  const gloss = resolvePracticeGloss({
                    wantGloss: want,
                    packId: snap.wordbookId,
                    packGlossLang: snap.practiceGlossLang ?? packMeta?.glossLang,
                    hint: item?.hint,
                    fromGlossary: raw && isWordLikeText(raw) ? oneLineGloss(raw, 48) : "",
                  });
                  const clipped = gloss ? clipOneLine(gloss, 48) : "";
                  return clipped ? <p className="top-practice-gloss">{clipped}</p> : null;
                })()}
              </>
            ) : (
              <>
                <h1>{tabTitle}</h1>
                {tab === "discover" ? <p>{t("discover.note")}</p> : null}
              </>
            )}
          </div>
          <div className="top-actions">
            {tab === "discover" ? (
              <>
                <button
                  type="button"
                  className="btn-dark"
                  disabled={booksBusy}
                  onClick={openFeedsSheet}
                >
                  {t("discover.feeds")}
                </button>
                <button
                  type="button"
                  className="btn-dark"
                  disabled={booksBusy}
                  onClick={() => setImportOpen(true)}
                >
                  {t("discover.import")}
                </button>
              </>
            ) : null}
            {tab === "settings" && settingsSection === "interface" ? (
              <button
                type="button"
                className="btn-theme"
                onClick={() => {
                  void invoke<Snapshot>("reset_look")
                    .then((next) => {
                      setSnap(next);
                      setMessage(null);
                    })
                    .catch((err: unknown) => setMessage(String(err)));
                }}
              >
                {t("action.resetLook")}
              </button>
            ) : null}
          </div>
        </header>

        <div className="body" ref={bodyRef}>
        {(message || snap.shortcutError || snap.ttsError) && (
          <p className="error">{message || snap.shortcutError || snap.ttsError}</p>
        )}

        {tab === "practice" && (
          <div className="practice-layout">
            <div className="practice-row practice-row-top">
              <section className="preview-card">
                <div className="preview-head">
                  <div className="preview-meta">
                    <span className="preview-label">{t("practice.mode")}</span>
                    <ModePill
                      aria-label={t("practice.mode")}
                      value={snap.settings.practiceMode || "type"}
                      onChange={(mode) => void invoke("set_practice_mode", { mode })}
                      options={[
                        {
                          value: "type",
                          label: t("practice.mode.type"),
                          icon: (
                            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                              <rect x="1.5" y="4" width="13" height="8.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
                              <path d="M3.5 7h1M6 7h1M8.5 7h1M11 7h1.5M4.5 9.5h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                            </svg>
                          ),
                        },
                        {
                          value: "dictation",
                          label: t("practice.mode.dictation"),
                          icon: (
                            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                              <path d="M8 2.5a2 2 0 0 0-2 2V8a2 2 0 1 0 4 0V4.5a2 2 0 0 0-2-2Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
                              <path d="M4 7.5a4 4 0 0 0 8 0M8 11.5v2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                            </svg>
                          ),
                        },
                        {
                          value: "blank",
                          label: t("practice.mode.blank"),
                          icon: (
                            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                              <path d="M2.5 11.5h11M4 8.5h2.5M9.5 8.5H12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                              <path d="M3 4.5h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeDasharray="2.2 2" />
                            </svg>
                          ),
                        },
                      ]}
                    />
                  </div>
                  <div className="preview-pack-actions">
                    <button
                      type="button"
                      className="preview-pack-link"
                      onClick={() => setPracticeSheet((cur) => (cur === "packs" ? null : "packs"))}
                    >
                      <span>
                        {(() => {
                          const title = snap.title?.trim() || "";
                          if (!title || title === "还没打开素材包") return t("practice.pickPack");
                          return title;
                        })()}
                      </span>
                      <FontAwesomeIcon icon={faChevronRight} className="preview-pack-chevron" />
                    </button>
                  </div>
                </div>

                {snap.items.length === 0 ? (
                  <p className="empty-hint">{t("practice.noPack")}</p>
                ) : (
                  <>
                    <button
                      type="button"
                      className="preview-progress"
                      aria-label={t("practice.items")}
                      onClick={() => setPracticeSheet((cur) => (cur === "items" ? null : "items"))}
                    >
                      <span className="preview-xy">
                        <span className="preview-xy-cur">{snap.index + 1}</span>
                        <span className="preview-xy-sep">/</span>
                        <span className="preview-xy-total">{snap.items.length}</span>
                      </span>
                    </button>
                    <div className="preview-actions" role="group" aria-label={t("practice.preview")}>
                      <button
                        type="button"
                        className="preview-nav-btn"
                        aria-label={t("quick.prev")}
                        title={t("quick.prev")}
                        onClick={() => void invoke("step_queue", { delta: -1 })}
                      >
                        <FontAwesomeIcon icon={faChevronLeft} />
                      </button>
                      <button
                        type="button"
                        className="btn-theme preview-live-btn"
                        onClick={() => setLivePractice(true)}
                      >
                        {t("practice.startLive")}
                      </button>
                      <button
                        type="button"
                        className="preview-nav-btn"
                        aria-label={t("quick.next")}
                        title={t("quick.next")}
                        onClick={() => void invoke("step_queue", { delta: 1 })}
                      >
                        <FontAwesomeIcon icon={faChevronRight} />
                      </button>
                    </div>
                  </>
                )}
              </section>

              <section className="section-card learn-progress-card">
                <div className="section-head compact">
                  <h2 className="section-title">
                    <FontAwesomeIcon icon={faChartSimple} className="section-title-icon" />
                    {t("rank.progress")}
                  </h2>
                </div>
                {snap.sourceProgress && snap.sourceProgress.total > 0 ? (
                  <div className="pack-progress-block">
                    <div className="pack-progress-meta">
                      <span>
                        {t("practice.packProgress", {
                          done: String(snap.sourceProgress.done),
                          total: String(snap.sourceProgress.total),
                        })}
                      </span>
                      <span>{snap.sourceProgress.percent}%</span>
                    </div>
                    <div className="pack-progress-track">
                      <div
                        className="pack-progress-fill"
                        style={{ width: `${Math.max(2, Math.min(100, snap.sourceProgress.percent))}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="pack-progress-empty">{t("practice.progressEmpty")}</p>
                )}
                <div className="learn-stats learn-stats-col">
                  <div className="learn-stat">
                    <span className="learn-stat-value">{stats.dayNewLearned ?? 0}</span>
                    <span className="learn-stat-label">{t("rank.newToday")}</span>
                  </div>
                  <div className="learn-stat">
                    <span className="learn-stat-value">{stats.dayReviewed ?? 0}</span>
                    <span className="learn-stat-label">{t("rank.reviewToday")}</span>
                  </div>
                  <div className="learn-stat">
                    <span className="learn-stat-value">{stats.totalLearned ?? 0}</span>
                    <span className="learn-stat-label">{t("rank.totalLearned")}</span>
                  </div>
                </div>
              </section>
            </div>

            <div className="practice-row practice-row-stats">
              <section className="stat-chart-card">
                <div className="stat-chart-head">
                  <span className="stat-chart-label">{t("rank.wordCount")}</span>
                  <strong className="stat-chart-value">{stats.daySentences}</strong>
                </div>
                <WeekSpark values={weekSeries.map((d) => d.sentences)} color={heatColor} />
                <span className="stat-chart-note">{t("rank.weekHint")}</span>
              </section>
              <section className="stat-chart-card">
                <div className="stat-chart-head">
                  <span className="stat-chart-label">{t("rank.accuracy")}</span>
                  <strong className="stat-chart-value">{pct(stats.dayCorrect, stats.dayTyped)}</strong>
                </div>
                <WeekSpark values={weekSeries.map((d) => d.accuracy)} color={heatColor} />
                <span className="stat-chart-note">{t("rank.weekHint")}</span>
              </section>
              <section className="stat-chart-card">
                <div className="stat-chart-head">
                  <span className="stat-chart-label">{t("rank.studyTime")}</span>
                  <strong className="stat-chart-value">{formatStudySecs(stats.dayStudySecs ?? 0)}</strong>
                </div>
                <WeekSpark values={weekSeries.map((d) => d.study)} color={heatColor} />
                <span className="stat-chart-note">{t("rank.weekHint")}</span>
              </section>
            </div>

            <section className="section-card heat-block practice-row-heat">
              <h2 className="heat-title">{t("rank.heatTitle")}</h2>
              <div className="heat-github">
                <div className="heat-weekdays-col" aria-hidden>
                  <span className="heat-month-slot" />
                  <span>{t("rank.weekday.mon")}</span>
                  <span />
                  <span>{t("rank.weekday.wed")}</span>
                  <span />
                  <span>{t("rank.weekday.fri")}</span>
                  <span />
                  <span />
                </div>
                <div className="heat-weeks" ref={heatTrackRef}>
                  {heatWeeks.map((week) => (
                    <div key={week.key} className="heat-week">
                      <span className="heat-month-slot">{week.monthLabel}</span>
                      {week.cells.map((cell) => (
                        <span
                          key={cell.key}
                          className={`heat-cell l${cell.level}${cell.future ? " future" : ""}`}
                          title={cell.tip}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div className="heat-foot">
                <span className="heat-total">
                  {t("rank.heatTotal", { n: String(heatSessions) })}
                </span>
                <div className="heat-legend">
                  <span>{t("rank.less")}</span>
                  <span className="heat-cell" />
                  <span className="heat-cell l1" />
                  <span className="heat-cell l2" />
                  <span className="heat-cell l3" />
                  <span className="heat-cell l4" />
                  <span>{t("rank.more")}</span>
                </div>
              </div>
            </section>

          </div>
        )}

        {tab === "skins" && showSkinsNav ? (
          <SkinsPage t={t} theme={snap.settings.fontColor || undefined} />
        ) : null}
        {tab === "account" && showAccountPage ? <AccountPage t={t} /> : null}

        {tab === "library" && (
          (() => {
            const shelfBooks = [...bookInstalled].sort((a, b) => {
              if (a.source === "diy" && b.source !== "diy") return -1;
              if (b.source === "diy" && a.source !== "diy") return 1;
              return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
            });
            if (mineShelf === "diy") {
              if (diyBookId) {
                const openBook = shelfBooks.find((b) => b.id === diyBookId);
                const canEdit = openBook?.source === "diy";
                return (
                  <div className="library">
                    <div className="library-tabs" role="tablist" aria-label={t("nav.library")}>
                      {(
                        [
                          { id: "wrong" as const, title: t("mine.wrong"), count: wrongBook.length },
                          {
                            id: "bookmarks" as const,
                            title: t("mine.bookmarks"),
                            count: (snap.bookmarks ?? []).length,
                          },
                          { id: "dict" as const, title: t("mine.dict"), count: lemmaCount },
                          { id: "diy" as const, title: t("mine.diy"), count: shelfBooks.length },
                        ] as const
                      ).map((shelf) => {
                        const on = shelf.id === "diy";
                        return (
                          <button
                            key={shelf.id}
                            type="button"
                            role="tab"
                            aria-selected={on}
                            className={`library-tab${on ? " on" : ""}`}
                            onClick={() => {
                              setMineShelf(shelf.id);
                              setLibraryQuery("");
                              if (shelf.id !== "diy") setDiyBookId(null);
                            }}
                          >
                            <span>{shelf.title}</span>
                            <span className="library-tab-count">{shelf.count}</span>
                          </button>
                        );
                      })}
                    </div>
                    <DiyBookEditor
                      t={t}
                      packId={diyBookId}
                      editable={canEdit}
                      onBack={() => setDiyBookId(null)}
                      onMetaChange={(book) => {
                        setBookInstalled((prev) => {
                          const next = prev.filter((b) => b.id !== book.id);
                          next.push(book);
                          return next;
                        });
                      }}
                      onDeleted={() => {
                        setDiyBookId(null);
                        void refreshWordbooks({ quiet: true });
                      }}
                      onPractice={askStartPack}
                      onPracticeSelected={(id, _bookTitle, lemmas) => {
                        void openPack(id, {
                          mode: "sequential",
                          size: Math.max(5, Math.min(200, lemmas.length)),
                          lemmas,
                        });
                      }}
                      onExportSelected={(bookTitle, selectedRows) => {
                        setExportJob({
                          title: bookTitle,
                          rows: selectedRows.map((r) => ({
                            word: r.word,
                            phonetic: r.phonetic || "",
                            gloss: r.gloss || "",
                            example:
                              r.example && r.exampleTr
                                ? `${r.example}\n${r.exampleTr}`
                                : r.example || r.exampleTr || "",
                            meta: "",
                          })),
                        });
                      }}
                      onError={setMessage}
                    />
                  </div>
                );
              }
              const qDiy = libraryQuery.trim().toLowerCase();
              const bookRows = shelfBooks.filter((b) => {
                if (!qDiy) return true;
                return b.title.toLowerCase().includes(qDiy);
              });
              return (
                <div className="library">
                  <div className="library-tabs" role="tablist" aria-label={t("nav.library")}>
                    {(
                      [
                        { id: "wrong" as const, title: t("mine.wrong"), count: wrongBook.length },
                        {
                          id: "bookmarks" as const,
                          title: t("mine.bookmarks"),
                          count: (snap.bookmarks ?? []).length,
                        },
                        { id: "dict" as const, title: t("mine.dict"), count: lemmaCount },
                        { id: "diy" as const, title: t("mine.diy"), count: shelfBooks.length },
                      ] as const
                    ).map((shelf) => {
                      const on = shelf.id === "diy";
                      return (
                        <button
                          key={shelf.id}
                          type="button"
                          role="tab"
                          aria-selected={on}
                          className={`library-tab${on ? " on" : ""}`}
                          onClick={() => {
                            setMineShelf(shelf.id);
                            setLibraryQuery("");
                            if (shelf.id !== "diy") setDiyBookId(null);
                          }}
                        >
                          <span>{shelf.title}</span>
                          <span className="library-tab-count">{shelf.count}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="library-toolrow">
                    <LibrarySearch
                      value={libraryQuery}
                      onChange={setLibraryQuery}
                      placeholder={t("mine.searchShelf")}
                      clearLabel={t("words.clear")}
                    />
                    <div className="diy-toolbar-actions">
                      <button
                        type="button"
                        className="library-btn primary"
                        disabled={booksBusy}
                        onClick={() => {
                          setCreateBookTitle("");
                          setCreateBookOpen(true);
                        }}
                      >
                        {t("mine.diyCreate")}
                      </button>
                    </div>
                  </div>
                  {bookRows.length === 0 ? (
                    <p className="library-empty">{t("mine.diyEmpty")}</p>
                  ) : (
                    <ul className="library-list">
                      {bookRows.map((book) => (
                        <li key={book.id} className="library-row no-check">
                          <button
                            type="button"
                            className="library-row-main"
                            onClick={() => setDiyBookId(book.id)}
                          >
                            <span className="library-row-title">
                              <span className="library-row-name">{book.title}</span>
                              {book.source === "diy" ? (
                                <span className="library-tag">{t("mine.diyMineTag")}</span>
                              ) : null}
                            </span>
                            <span className="library-row-sub">
                              {t("books.lemmas", { n: String(book.lemmaCount) })}
                            </span>
                            <time className="library-row-date" />
                          </button>
                          <button
                            type="button"
                            className="library-row-del"
                            aria-label={t("words.delete")}
                            onClick={() => {
                              const confirmKey =
                                book.source === "diy"
                                  ? "mine.diy.deleteBookConfirm"
                                  : "mine.booksRemoveConfirm";
                              setConfirmDialog({
                                message: t(confirmKey),
                                onConfirm: () => {
                                  void invoke("remove_wordbook", { id: book.id }).then(() =>
                                    refreshWordbooks({ quiet: true }),
                                  );
                                },
                              });
                            }}
                          >
                            <FontAwesomeIcon icon={faTrash} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            }
            const q = libraryQuery.trim().toLowerCase();
            const matchRow = (title: string, sub?: string | null) => {
              if (!q) return true;
              return (
                title.toLowerCase().includes(q) ||
                (sub ?? "").toLowerCase().includes(q)
              );
            };
            const openDictLemma = (lemma: string, display?: string, gloss?: string) => {
              setDictHistory(pushDictHistory({ lemma, display, gloss }));
              setDetailLemma(lemma);
            };
            const dictRows =
              mineShelf === "dict"
                ? q
                  ? searchGlossary(libraryQuery, 80).map((e) => ({
                      key: e.lemma,
                      title: e.display || e.lemma,
                      sub: e.senses?.[0]?.gloss ?? "",
                      date: "",
                      practiceText: e.lemma,
                      onOpen: () =>
                        openDictLemma(e.lemma, e.display || e.lemma, e.senses?.[0]?.gloss),
                      onDel: undefined as (() => void) | undefined,
                    }))
                  : dictHistory.map((item) => ({
                      key: `hist-${item.lemma}-${item.at}`,
                      title: item.display || item.lemma,
                      sub: oneLineGloss(item.lemma) || item.gloss || "",
                      date: "",
                      practiceText: item.lemma,
                      onOpen: () => openDictLemma(item.lemma, item.display, item.gloss),
                      onDel: undefined as (() => void) | undefined,
                    }))
                : [];
            type ShelfRow = {
              key: string;
              title: string;
              sub?: string | null;
              date?: string;
              practiceText?: string;
              delIndex?: number;
              removed?: boolean;
              onOpen?: () => void;
              onDel?: () => void;
              onUndo?: () => void;
            };

            /** Open word detail only for dictionary words/short phrases — not full sentences. */
            function detailOpener(text: string): (() => void) | undefined {
              const raw = text.trim();
              if (!raw) return undefined;
              if (raw.split(/\s+/).length > 4) return undefined;
              if (!entryOf(raw)) return undefined;
              return () => setDetailLemma(raw);
            }

            const wrongGhosts = shelfGhosts.filter((g) => g.shelf === "wrong");
            const bookmarkGhosts = shelfGhosts.filter((g) => g.shelf === "bookmarks");

            async function undoShelfGhost(key: string) {
              const ghost = shelfGhosts.find((g) => g.key === key);
              if (!ghost) return;
              try {
                if (ghost.shelf === "wrong") {
                  await invoke("restore_wrong_item", {
                    text: ghost.text ?? ghost.title,
                    hint: ghost.hint ?? null,
                    misses: ghost.misses ?? 1,
                    lastAt: ghost.lastAt ?? null,
                  });
                } else {
                  await invoke("restore_bookmark", {
                    text: ghost.text ?? ghost.title,
                    hint: ghost.hint ?? null,
                    savedAt: ghost.savedAt ?? null,
                  });
                }
                setShelfGhosts((prev) => prev.filter((g) => g.key !== key));
              } catch (err) {
                setMessage(String(err));
              }
            }

            async function softDeleteWrong(e: (typeof wrongBook)[number], index: number) {
              const key = `${e.text}-${index}`;
              setShelfGhosts((prev) => [
                ...prev.filter((g) => g.key !== key),
                {
                  shelf: "wrong",
                  key,
                  title: e.text,
                  sub: e.hint || "",
                  date: e.lastAt,
                  practiceText: e.text,
                  text: e.text,
                  hint: e.hint,
                  misses: e.misses,
                  lastAt: e.lastAt,
                },
              ]);
              setShelfSelected((prev) => {
                if (!prev[key]) return prev;
                const next = { ...prev };
                delete next[key];
                return next;
              });
              try {
                await invoke("remove_wrong_item", { index });
              } catch (err) {
                setShelfGhosts((prev) => prev.filter((g) => g.key !== key));
                setMessage(String(err));
              }
            }

            async function softDeleteBookmark(
              e: NonNullable<Snapshot["bookmarks"]>[number],
              index: number,
            ) {
              const key = `${e.text}-${index}`;
              setShelfGhosts((prev) => [
                ...prev.filter((g) => g.key !== key),
                {
                  shelf: "bookmarks",
                  key,
                  title: e.text,
                  sub: e.hint || "",
                  date: e.savedAt,
                  practiceText: e.text,
                  text: e.text,
                  hint: e.hint,
                  savedAt: e.savedAt,
                },
              ]);
              setShelfSelected((prev) => {
                if (!prev[key]) return prev;
                const next = { ...prev };
                delete next[key];
                return next;
              });
              try {
                await invoke("remove_bookmark", { index });
              } catch (err) {
                setShelfGhosts((prev) => prev.filter((g) => g.key !== key));
                setMessage(String(err));
              }
            }

            const wrongLive: ShelfRow[] = wrongBook
              .map((e, i) => ({ e, i }))
              .filter(({ e }) => matchRow(e.text, e.hint))
              .map(({ e, i }) => ({
                key: `${e.text}-${i}`,
                title: e.text,
                sub: e.hint,
                date: e.lastAt,
                practiceText: e.text,
                delIndex: i,
                onOpen: detailOpener(e.text),
                onDel: () => void softDeleteWrong(e, i),
              }));
            const wrongGone: ShelfRow[] = wrongGhosts
              .filter((g) => !wrongBook.some((e) => e.text === g.text))
              .filter((g) => matchRow(g.title, g.sub))
              .map((g) => ({
                key: g.key,
                title: g.title,
                sub: g.sub,
                date: g.date,
                practiceText: g.practiceText,
                removed: true,
                onOpen: detailOpener(g.title),
                onUndo: () => void undoShelfGhost(g.key),
              }));

            const bookmarkLive: ShelfRow[] = (snap.bookmarks ?? [])
              .map((e, i) => ({ e, i }))
              .filter(({ e }) => matchRow(e.text, e.hint))
              .map(({ e, i }) => ({
                key: `${e.text}-${i}`,
                title: e.text,
                sub: e.hint,
                date: e.savedAt,
                practiceText: e.text,
                delIndex: i,
                onOpen: detailOpener(e.text),
                onDel: () => void softDeleteBookmark(e, i),
              }));
            const bookmarkGone: ShelfRow[] = bookmarkGhosts
              .filter((g) => !(snap.bookmarks ?? []).some((e) => e.text === g.text))
              .filter((g) => matchRow(g.title, g.sub))
              .map((g) => ({
                key: g.key,
                title: g.title,
                sub: g.sub,
                date: g.date,
                practiceText: g.practiceText,
                removed: true,
                onOpen: detailOpener(g.title),
                onUndo: () => void undoShelfGhost(g.key),
              }));

            const shelves = [
              {
                id: "wrong" as const,
                title: t("mine.wrong"),
                count: wrongBook.length,
                note: t("mine.wrongNote"),
                clear: undefined as (() => void) | undefined,
                clearLabel: "",
                empty: t("mine.empty"),
                canPractice: true,
                canSelect: true,
                rows: [...wrongLive, ...wrongGone],
              },
              {
                id: "bookmarks" as const,
                title: t("mine.bookmarks"),
                count: (snap.bookmarks ?? []).length,
                note: t("words.bookmarksNote"),
                clear: undefined as (() => void) | undefined,
                clearLabel: "",
                empty: t("words.bookmarksEmpty"),
                canPractice: true,
                canSelect: true,
                rows: [...bookmarkLive, ...bookmarkGone],
              },
              {
                id: "dict" as const,
                title: t("mine.dict"),
                count: lemmaCount,
                note: q
                  ? t("mine.dictNote", { n: lemmaCount })
                  : dictHistory.length > 0
                    ? t("mine.dictHistory")
                    : t("mine.dictNote", { n: lemmaCount }),
                clear:
                  !q && dictHistory.length > 0
                    ? () => {
                        clearDictHistory();
                        setDictHistory([]);
                      }
                    : undefined,
                clearLabel: t("mine.dictHistoryClear"),
                empty: q
                  ? t("mine.dictEmpty")
                  : lemmaCount === 0
                    ? t("mine.dictHint")
                    : t("mine.dictHistoryEmpty"),
                canPractice: true,
                canSelect: true,
                rows: dictRows as ShelfRow[],
              },
            ];
            const pack = shelves.find((s) => s.id === mineShelf) ?? shelves[0]!;
            const canSelect = !!pack.canSelect;
            const liveRows = pack.rows.filter((r) => !r.removed);
            const selectedKeys = canSelect
              ? liveRows.filter((r) => shelfSelected[r.key]).map((r) => r.key)
              : [];
            const hasSelection = selectedKeys.length > 0;
            const allSelected =
              canSelect && liveRows.length > 0 && selectedKeys.length === liveRows.length;
            const partialSelected = hasSelection && !allSelected;

            function paintShelfSelect(key: string, value: boolean) {
              setShelfSelected((prev) => {
                if (!!prev[key] === value) return prev;
                return { ...prev, [key]: value };
              });
            }

            function toggleShelfSelectAll() {
              if (allSelected) {
                setShelfSelected({});
                return;
              }
              const next: Record<string, boolean> = {};
              for (const r of liveRows) next[r.key] = true;
              setShelfSelected(next);
            }

            function renderShelfCheck(on: boolean, partial = false) {
              if (on) return <FontAwesomeIcon icon={faCheck} />;
              if (partial) return <span className="diy-check-partial" aria-hidden />;
              return null;
            }

            function shelfBrushStart(key: string, event: ReactPointerEvent<HTMLButtonElement>) {
              event.preventDefault();
              event.stopPropagation();
              const paint = !shelfSelectedRef.current[key];
              shelfBrushRef.current = { paint };
              paintShelfSelect(key, paint);
              event.currentTarget.setPointerCapture(event.pointerId);
            }

            function shelfBrushMove(event: ReactPointerEvent<HTMLButtonElement>) {
              const brush = shelfBrushRef.current;
              if (!brush) return;
              const hit = document.elementFromPoint(event.clientX, event.clientY);
              const row = hit?.closest("[data-lib-key]") as HTMLElement | null;
              const key = row?.dataset.libKey;
              if (key) paintShelfSelect(key, brush.paint);
            }

            function shelfBrushEnd(event: ReactPointerEvent<HTMLButtonElement>) {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              shelfBrushRef.current = null;
            }

            function runShelfPractice() {
              const lemmas = hasSelection
                ? liveRows
                    .filter((r) => shelfSelected[r.key])
                    .map((r) => r.practiceText || r.title)
                : liveRows.map((r) => r.practiceText || r.title);
              if (pack.id === "dict") {
                if (lemmas.length === 0) {
                  setMessage(t("mine.dictEmpty"));
                  return;
                }
                void openPack("dict", { lemmas });
                return;
              }
              if (hasSelection) {
                void openPack(pack.id, { lemmas });
                return;
              }
              void openPack(pack.id);
            }

            function runShelfExport() {
              if (pack.id === "dict") {
                const lemmas = hasSelection
                  ? liveRows
                      .filter((r) => shelfSelected[r.key])
                      .map((r) => r.practiceText || r.title)
                  : liveRows.map((r) => r.practiceText || r.title);
                void openShelfExport("dict", lemmas);
                return;
              }
              if (pack.id !== "wrong" && pack.id !== "bookmarks") return;
              if (hasSelection) {
                if (pack.id === "wrong") {
                  const indices = new Set(
                    liveRows
                      .filter((r) => shelfSelected[r.key])
                      .map((r) => r.delIndex)
                      .filter((i): i is number => i != null),
                  );
                  setExportJob({
                    title: t("mine.wrong"),
                    rows: rowsFromWrong(wrongBook.filter((_, i) => indices.has(i))),
                  });
                  return;
                }
                const indices = new Set(
                  liveRows
                    .filter((r) => shelfSelected[r.key])
                    .map((r) => r.delIndex)
                    .filter((i): i is number => i != null),
                );
                setExportJob({
                  title: t("mine.bookmarks"),
                  rows: rowsFromBookmarks((snap?.bookmarks ?? []).filter((_, i) => indices.has(i))),
                });
                return;
              }
              void openShelfExport(pack.id);
            }

            function runShelfDeleteSelected() {
              const picked = liveRows.filter((r) => shelfSelected[r.key]);
              if (picked.length === 0) return;
              void (async () => {
                if (pack.id === "wrong") {
                  const items = picked
                    .map((r) => ({ r, i: r.delIndex }))
                    .filter((x): x is { r: ShelfRow; i: number } => x.i != null)
                    .sort((a, b) => b.i - a.i);
                  for (const { i } of items) {
                    const src = wrongBook[i];
                    if (src) await softDeleteWrong(src, i);
                  }
                } else if (pack.id === "bookmarks") {
                  const book = snap?.bookmarks ?? [];
                  const items = picked
                    .map((r) => ({ r, i: r.delIndex }))
                    .filter((x): x is { r: ShelfRow; i: number } => x.i != null)
                    .sort((a, b) => b.i - a.i);
                  for (const { i } of items) {
                    const src = book[i];
                    if (src) await softDeleteBookmark(src, i);
                  }
                }
                setShelfSelected({});
              })();
            }

            return (
              <div className="library">
                <div className="library-tabs" role="tablist" aria-label={t("nav.library")}>
                  {shelves.map((shelf) => {
                    const on = shelf.id === pack.id;
                    return (
                      <button
                        key={shelf.id}
                        type="button"
                        role="tab"
                        aria-selected={on}
                        className={`library-tab${on ? " on" : ""}`}
                        onClick={() => {
                          setMineShelf(shelf.id);
                          setLibraryQuery("");
                          setDiyBookId(null);
                        }}
                      >
                        <span>{shelf.title}</span>
                        <span className="library-tab-count">{shelf.count}</span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    role="tab"
                    aria-selected={false}
                    className="library-tab"
                    onClick={() => {
                      setMineShelf("diy");
                      setLibraryQuery("");
                      setDiyBookId(null);
                    }}
                  >
                    <span>{t("mine.diy")}</span>
                    <span className="library-tab-count">
                      {bookInstalled.length}
                    </span>
                  </button>
                </div>
                <div
                  className={`library-toolrow${canSelect ? " with-check" : ""}`}
                >
                  {canSelect ? (
                    <button
                      type="button"
                      className={`diy-check library-row-check${
                        allSelected ? " on" : partialSelected ? " partial" : ""
                      }`}
                      aria-label={t("mine.diy.selectAll")}
                      onClick={toggleShelfSelectAll}
                      disabled={liveRows.length === 0}
                    >
                      {renderShelfCheck(allSelected, partialSelected)}
                    </button>
                  ) : null}
                  <LibrarySearch
                    value={libraryQuery}
                    onChange={setLibraryQuery}
                    placeholder={
                      pack.id === "dict" ? t("mine.searchDict") : t("mine.searchShelf")
                    }
                    clearLabel={t("words.clear")}
                  />
                  <div className="diy-toolbar-actions">
                    {pack.clear ? (
                      <button
                        type="button"
                        className="library-btn"
                        disabled={pack.id !== "dict" && pack.count === 0}
                        onClick={pack.clear}
                      >
                        {pack.clearLabel}
                      </button>
                    ) : null}
                    {pack.canPractice ? (
                      <>
                        <button
                          type="button"
                          className="library-btn"
                          disabled={liveRows.length === 0}
                          onClick={runShelfExport}
                        >
                          {hasSelection
                            ? t("mine.diy.exportSelected")
                            : t("export.action")}
                        </button>
                        <button
                          type="button"
                          className="library-btn primary"
                          disabled={liveRows.length === 0}
                          onClick={runShelfPractice}
                        >
                          {hasSelection
                            ? t("mine.diy.practiceSelected")
                            : t("mine.practice")}
                        </button>
                        {hasSelection && pack.id !== "dict" ? (
                          <button
                            type="button"
                            className="library-btn danger"
                            onClick={runShelfDeleteSelected}
                          >
                            {t("mine.diy.deleteSelected")}
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
                {pack.rows.length === 0 ? (
                  <p className="library-empty">{pack.empty}</p>
                ) : (
                  <ul className="library-list">
                    {pack.rows.map((row) => {
                      const isOn = !!shelfSelected[row.key];
                      return (
                        <li
                          key={row.key}
                          data-lib-key={canSelect && !row.removed ? row.key : undefined}
                          className={`library-row${canSelect ? "" : " no-check"}${
                            isOn ? " selected" : ""
                          }${row.removed ? " removed" : ""}`}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (row.removed) return;
                            if (!row.onOpen && !pack.canPractice && !row.onDel) return;
                            setLibCtx({
                              x: event.clientX,
                              y: event.clientY,
                              title: row.title,
                              canPractice: pack.canPractice,
                              shelfId: pack.id,
                              onOpen: row.onOpen,
                              onDel: row.onDel,
                            });
                          }}
                        >
                          {canSelect ? (
                            row.removed ? (
                              <span className="library-row-check spacer" aria-hidden />
                            ) : (
                              <button
                                type="button"
                                className={`diy-check library-row-check${isOn ? " on" : ""}`}
                                aria-label={t("mine.diy.selectRow")}
                                onPointerDown={(e) => {
                                  if (e.button !== 0) return;
                                  shelfBrushStart(row.key, e);
                                }}
                                onPointerMove={shelfBrushMove}
                                onPointerUp={shelfBrushEnd}
                                onPointerCancel={shelfBrushEnd}
                                onClick={(e) => e.preventDefault()}
                              >
                                {renderShelfCheck(isOn)}
                              </button>
                            )
                          ) : null}
                          <button
                            type="button"
                            className={`library-row-main${row.onOpen ? "" : " static"}`}
                            onClick={row.onOpen}
                            disabled={!row.onOpen}
                          >
                            <span className="library-row-title">{row.title}</span>
                            <span className="library-row-sub">{row.sub || ""}</span>
                            <time className="library-row-date">{row.date || ""}</time>
                          </button>
                          {row.removed && row.onUndo ? (
                            <button
                              type="button"
                              className="library-row-del"
                              aria-label={t("mine.diy.undoDelete")}
                              title={t("mine.diy.undoDelete")}
                              onClick={row.onUndo}
                            >
                              <FontAwesomeIcon icon={faArrowRotateLeft} />
                            </button>
                          ) : row.onDel ? (
                            <button
                              type="button"
                              className="library-row-del"
                              aria-label={t("words.delete")}
                              onClick={row.onDel}
                            >
                              <FontAwesomeIcon icon={faTrash} />
                            </button>
                          ) : (
                            <span className="library-row-del spacer" aria-hidden />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })()
        )}

        {tab === "discover" && (
          <>
            <div className="discover-search">
              <input
                type="search"
                value={discoverQuery}
                onChange={(event) => setDiscoverQuery(event.target.value)}
                placeholder={t("discover.search")}
                aria-label={t("discover.search")}
              />
            </div>
            {(booksBusy || bookProgress) && (
              <div className="book-progress" aria-live="polite">
                <div className="book-progress-meta">
                  <span>
                    {bookProgress?.title ? `${bookProgress.title} · ` : ""}
                    {bookProgress?.message || t(`books.phase.${bookProgress?.phase || "resolve"}`) || t("books.progress.indeterminate")}
                  </span>
                  <span>
                    {bookProgress && bookProgress.total > 0
                      ? t("books.progress", { pct: Math.round(bookProgress.percent) })
                      : t("books.progress.indeterminate")}
                  </span>
                </div>
                <div className={`book-progress-track${bookProgress && bookProgress.total <= 0 && bookProgress.percent < 100 ? " indeterminate" : ""}`}>
                  <div className="book-progress-fill" style={{ width: `${Math.max(4, Math.min(100, bookProgress?.percent ?? 8))}%` }} />
                </div>
              </div>
            )}
            {(() => {
              const gloss = (snap.settings.glossLang || "zh").toLowerCase();
              const dq = discoverQuery.trim().toLowerCase();
              const matchBook = (title: string, description?: string | null) => {
                if (!dq) return true;
                return (
                  title.toLowerCase().includes(dq) ||
                  (description ?? "").toLowerCase().includes(dq)
                );
              };
              const catalogRows = (bookCatalog?.books ?? []).filter(
                (entry) => onGlossTrack(entry, gloss) && matchBook(entry.title, entry.description),
              );
              const orphanRows = bookInstalled
                .filter((b) => !(bookCatalog?.books ?? []).some((c) => c.id === b.id))
                .filter((entry) => onGlossTrack(entry, gloss) && matchBook(entry.title, null));
              if (catalogRows.length === 0 && orphanRows.length === 0) {
                if (!dq) {
                  return (
                    <p className="section-note">
                      {t("discover.emptyFeeds")}{" "}
                      <button
                        type="button"
                        className="linkish"
                        onClick={openFeedsSheet}
                      >
                        {t("discover.feeds")}
                      </button>
                    </p>
                  );
                }
                return <p className="section-note">{t("discover.emptySearch")}</p>;
              }

              const renderCard = (opts: {
                id: string;
                title: string;
                description?: string | null;
                lemmaCount?: number | null;
                version?: string | null;
                installed: boolean;
                editable?: boolean;
              }) => {
                const { id, title, description, lemmaCount, version, installed, editable } = opts;
                const local = bookInstalled.find((b) => b.id === id);
                const canUpdate =
                  !!installed &&
                  !!version &&
                  !!local?.version &&
                  isNewerVersion(version, local.version);
                const prog = installed ? progressForPack("pack", id) : null;
                const total = prog?.total || lemmaCount || 0;
                const done = prog?.done ?? 0;
                const pct = prog
                  ? Math.max(0, Math.min(100, prog.percent))
                  : total > 0
                    ? 0
                    : 0;
                const downloading =
                  booksBusy &&
                  !!bookProgress &&
                  (bookProgress.id === id || bookProgress.title === title);
                return (
                  <article
                    key={id}
                    className={`discover-card${installed ? " installed" : ""}${canUpdate ? " update" : ""}`}
                  >
                    {installed ? (
                      <div className="discover-card-tools">
                        {editable ? (
                          <button
                            type="button"
                            className="discover-card-edit"
                            disabled={booksBusy}
                            title={t("discover.edit")}
                            aria-label={t("discover.edit")}
                            onClick={() => openDiyEditor(id)}
                          >
                            {t("discover.edit")}
                          </button>
                        ) : null}
                        {canUpdate ? (
                          <button
                            type="button"
                            className="discover-card-update"
                            disabled={booksBusy}
                            title={t("discover.update")}
                            aria-label={t("discover.update")}
                            onClick={() => void installWordbook(id)}
                          >
                            <FontAwesomeIcon icon={faRotate} />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="discover-card-export"
                          disabled={booksBusy}
                          title={t("export.action")}
                          aria-label={t("export.action")}
                          onClick={() => void openWordbookExport(id, title)}
                        >
                          <FontAwesomeIcon icon={faArrowUpFromBracket} />
                        </button>
                      </div>
                    ) : null}
                    <div className="discover-card-info">
                      <h3>{title}</h3>
                      {description ? <p>{description}</p> : null}
                      <span className="discover-card-count">
                        {t("books.lemmas", { n: String(lemmaCount ?? "—") })}
                        {version ? ` · v${version}` : ""}
                        {canUpdate ? ` · ${t("discover.updateAvailable")}` : ""}
                      </span>
                    </div>
                    <div className="discover-card-action">
                      {installed ? (
                        <>
                          <div
                            className="discover-learn"
                            title={t("practice.packProgress", {
                              done: String(done),
                              total: String(total || "—"),
                            })}
                          >
                            <div className="discover-learn-track">
                              <div
                                className="discover-learn-fill"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="discover-learn-pct">{pct}%</span>
                          </div>
                          <button
                            type="button"
                            className="btn-theme"
                            disabled={booksBusy}
                            onClick={() => askStartPack(id, title)}
                          >
                            {downloading
                              ? t("books.progress.indeterminate")
                              : t("discover.start")}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn-theme"
                          disabled={booksBusy}
                          onClick={() => void installWordbook(id)}
                        >
                          {downloading ? t("books.progress.indeterminate") : t("discover.download")}
                        </button>
                      )}
                    </div>
                  </article>
                );
              };

              return (
                <div className="discover-grid">
                  {catalogRows.map((entry) => {
                    const installed = bookInstalled.some((b) => b.id === entry.id);
                    return renderCard({
                      id: entry.id,
                      title: entry.title,
                      description: entry.description,
                      lemmaCount: entry.lemmaCount,
                      version: entry.version,
                      installed,
                    });
                  })}
                  {orphanRows.map((entry) =>
                    renderCard({
                      id: entry.id,
                      title: entry.title,
                      description:
                        entry.source === "diy"
                          ? t("mine.diyMineTag")
                          : t("discover.installed"),
                      lemmaCount: entry.lemmaCount,
                      version: entry.version,
                      installed: true,
                      editable: entry.source === "diy",
                    }),
                  )}
                </div>
              );
            })()}
          </>
        )}

        {tab === "settings" && (
          <>
            <section
              id="settings-interface"
              className="settings-section"
              data-settings-section="interface"
            >
              <h2 className="settings-heading">{t("nav.interface")}</h2>
              <div className="settings-block">
                <label className="field">
                  {t("look.locale")}
                  <NiceSelect
                    value={normalizeLocale(snap.settings.uiLocale)}
                    onChange={(locale) => void invoke("set_ui_locale", { locale })}
                    options={LOCALE_OPTIONS.map((item) => ({
                      value: item.value,
                      label: item.label,
                    }))}
                  />
                </label>
                <label className="field">
                  {t("look.dark")}
                  <Toggle
                    aria-label={t("look.dark")}
                    checked={dark}
                    onChange={(next) => void invoke("set_ui_dark", { dark: next })}
                  />
                </label>
                <div className="field">
                  {t("look.theme")}
                  <span className="colors">
                    {SWATCHES.map((swatch) => {
                      const on = color.toLowerCase() === swatch;
                      return (
                        <button
                          key={swatch}
                          type="button"
                          className={on ? "swatch on" : "swatch"}
                          style={{ background: swatch }}
                          aria-label={swatch}
                          onClick={() =>
                            void invoke("set_appearance", {
                              fontColor: swatch,
                              opacity: snap.settings.opacity,
                            })
                          }
                        >
                          {on ? (
                            <svg viewBox="0 0 16 16" aria-hidden>
                              <path
                                d="m3.6 8.2 2.8 2.8 6-6.4"
                                fill="none"
                                stroke="#fff"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          ) : null}
                        </button>
                      );
                    })}
                    <label className="swatch custom" title={t("look.custom")}>
                      <input
                        type="color"
                        value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#ff4d6d"}
                        aria-label={t("look.custom")}
                        onChange={(event) =>
                          void invoke("set_appearance", {
                            fontColor: event.target.value,
                            opacity: snap.settings.opacity,
                          })
                        }
                      />
                    </label>
                  </span>
                </div>
                <label className="field">
                  {t("nav.overlay")}
                  <Toggle
                    aria-label={t("nav.overlay")}
                    checked={snap.overlayVisible}
                    onChange={() => void invoke("toggle_overlay_cmd")}
                  />
                </label>
                <label className="field">
                  {t("look.size")}
                  <span>
                    {Math.round(snap.settings.fontSize)} px
                    <ThemeRange
                      min={10}
                      max={72}
                      value={Math.round(snap.settings.fontSize)}
                      onChange={(fontSize) => void invoke("set_font_size", { fontSize })}
                    />
                  </span>
                </label>
                <label className="field">
                  {t("look.opacity")}
                  <span>
                    {Math.round(snap.settings.opacity * 100)}%
                    <ThemeRange
                      min={20}
                      max={100}
                      value={Math.round(snap.settings.opacity * 100)}
                      onChange={(pctValue) =>
                        void invoke("set_appearance", {
                          fontColor: color,
                          opacity: pctValue / 100,
                        })
                      }
                    />
                  </span>
                </label>
                <label className="field">
                  {t("look.font")}
                  <NiceSelect
                    value={snap.settings.fontFamily || BUILTIN_FONT}
                    onChange={(family) => void invoke("set_font_family", { family })}
                    options={([BUILTIN_FONT] as string[])
                      .concat(fonts.filter((family) => family !== BUILTIN_FONT))
                      .filter((family, index, all) => all.indexOf(family) === index)
                      .map((family) => ({
                        value: family,
                        label:
                          family === BUILTIN_FONT
                            ? t("look.fontDefault", { name: family })
                            : family,
                        style: { fontFamily: fontStack(family) },
                      }))}
                  />
                </label>
                <label className="field">
                  {t("look.caption")}
                  <span>
                    {Math.round(captionOpacity * 100)}%
                    <ThemeRange
                      min={0}
                      max={100}
                      value={Math.round(captionOpacity * 100)}
                      onChange={(pctValue) =>
                        void invoke("set_caption_opacity", { opacity: pctValue / 100 })
                      }
                    />
                  </span>
                </label>
                <label className="field">
                  {t("look.effect")}
                  <Toggle
                    aria-label={t("look.effect")}
                    checked={(snap.settings.effect || "combo") !== "none"}
                    onChange={(on) =>
                      void invoke("set_effect", {
                        effect: on ? "combo" : "none",
                        power: snap.settings.effectPower || 0.7,
                      })
                    }
                  />
                </label>
                <label className="field">
                  {t("look.keySoundVolume")}
                  <span>
                    {Math.round(keySoundVolume * 100)}%
                    <ThemeRange
                      min={0}
                      max={100}
                      value={Math.round(keySoundVolume * 100)}
                      onChange={(pctValue) => {
                        const next = pctValue / 100;
                        writeKeySoundVolume(next);
                        setKeySoundVolume(next);
                        if (next > 0) {
                          playKeySound({ ok: true, key: "a" });
                        }
                      }}
                    />
                  </span>
                </label>
                <label className="field">
                  {t("look.comboSound")}
                  <Toggle
                    aria-label={t("look.comboSound")}
                    checked={comboSoundPrefs.enabled}
                    onChange={(enabled) => setComboPref({ enabled })}
                  />
                </label>
                {comboSoundPrefs.enabled ? (
                  <>
                    <label className="field">
                      {t("look.comboSoundBingo")}
                      <Toggle
                        aria-label={t("look.comboSoundBingo")}
                        checked={comboSoundPrefs.bingo}
                        onChange={(bingo) => setComboPref({ bingo })}
                      />
                    </label>
                    <label className="field">
                      {t("look.comboSoundCheer")}
                      <Toggle
                        aria-label={t("look.comboSoundCheer")}
                        checked={comboSoundPrefs.cheer}
                        onChange={(cheer) => setComboPref({ cheer })}
                      />
                    </label>
                    <label className="field">
                      {t("look.comboSoundMilestone")}
                      <Toggle
                        aria-label={t("look.comboSoundMilestone")}
                        checked={comboSoundPrefs.milestone}
                        onChange={(milestone) => setComboPref({ milestone })}
                      />
                    </label>
                  </>
                ) : null}
                {(snap.settings.effect || "combo") === "combo" && (
                  <>
                    <label className="field">
                      {t("look.power")}
                      <span>
                        {Math.round((snap.settings.effectPower || 0.7) * 100)}%
                        <ThemeRange
                          min={30}
                          max={100}
                          value={Math.round((snap.settings.effectPower || 0.7) * 100)}
                          onChange={(pctValue) =>
                            void invoke("set_effect", {
                              effect: "combo",
                              power: pctValue / 100,
                            })
                          }
                        />
                      </span>
                    </label>
                    <label className="field">
                      {t("look.place")}
                      <TextSeg
                        aria-label={t("look.place")}
                        value={snap.settings.comboPlace || "follow"}
                        onChange={(place) =>
                          void invoke("set_combo_style", {
                            color: snap.settings.comboColor || defaultComboTheme,
                            place,
                            scale: snap.settings.comboScale || 1,
                            blur: captionOpacity > 0.02,
                          })
                        }
                        options={[
                          { value: "follow", label: t("look.place.follow") },
                          { value: "tl", label: t("look.place.tl") },
                          { value: "tr", label: t("look.place.tr") },
                          { value: "bl", label: t("look.place.bl") },
                          { value: "br", label: t("look.place.br") },
                        ]}
                      />
                    </label>
                    <label className="field">
                      {t("look.scale")}
                      <span>
                        {Math.round((snap.settings.comboScale || 1) * 100)}%
                        <ThemeRange
                          min={60}
                          max={180}
                          value={Math.round((snap.settings.comboScale || 1) * 100)}
                          onChange={(pctValue) =>
                            void invoke("set_combo_style", {
                              color: snap.settings.comboColor || defaultComboTheme,
                              place: snap.settings.comboPlace || "follow",
                              scale: pctValue / 100,
                              blur: captionOpacity > 0.02,
                            })
                          }
                        />
                      </span>
                    </label>
                  </>
                )}
              </div>
              <div className="settings-block">
                {(() => {
                  const enabled = sanitizeToolbar(snap.settings.toolbarItems);
                  const enabledSet = new Set(enabled);
                  const rows = TOOLBAR_ROWS.filter((row) => row.id !== "next");
                  const enabledRows = rows
                    .filter((row) =>
                      row.pair === "nav" ? enabledSet.has("prev") : enabledSet.has(row.id),
                    )
                    .sort((a, b) => {
                      const ai =
                        a.pair === "nav" ? enabled.indexOf("prev") : enabled.indexOf(a.id);
                      const bi =
                        b.pair === "nav" ? enabled.indexOf("prev") : enabled.indexOf(b.id);
                      return ai - bi;
                    });
                  const disabledRows = rows.filter((row) =>
                    row.pair === "nav" ? !enabledSet.has("prev") : !enabledSet.has(row.id),
                  );
                  const orderedRows = [...enabledRows, ...disabledRows];
                  const labelOf = (row: (typeof TOOLBAR_ROWS)[number]) =>
                    row.pair === "nav" ? t("look.toolbar.nav") : t(`look.toolbar.${row.id}`);
                  const rowKey = (row: (typeof TOOLBAR_ROWS)[number]) =>
                    row.pair === "nav" ? "nav" : row.id;
                  const commit = (items: ToolbarId[]) => {
                    void invoke("set_toolbar_items", { items: sanitizeToolbar(items) });
                  };
                  return (
                    <>
                      <div className="settings-head-row">
                        <p className="note">{t("look.toolbarNote")}</p>
                        <button
                          type="button"
                          className="settings-reset-btn"
                          onClick={() =>
                            void invoke<Snapshot>("reset_toolbar_items").then(setSnap)
                          }
                        >
                          {t("look.toolbar.reset")}
                        </button>
                      </div>
                      <ToolbarSlotsList
                        orderedRows={orderedRows}
                        enabled={enabled}
                        enabledSet={enabledSet}
                        labelOf={labelOf}
                        rowKey={rowKey}
                        commit={commit}
                      />
                    </>
                  );
                })()}
              </div>
            </section>

            <section
              id="settings-practice"
              className="settings-section"
              data-settings-section="practice"
            >
              <h2 className="settings-heading">{t("nav.settingsPractice")}</h2>
              <div className="settings-block">
                <label className="field">
                  {t("practice.hint")}
                  <Toggle
                    aria-label={t("practice.hint")}
                    checked={snap.settings.showHint === true}
                    onChange={(show) => void invoke("set_show_hint", { show })}
                  />
                </label>
                <label className="field">
                  {t("practice.ipa")}
                  <Toggle
                    aria-label={t("practice.ipa")}
                    checked={snap.settings.showIpa !== false}
                    onChange={(show) => void invoke("set_show_ipa", { show })}
                  />
                </label>
                <label className="field">
                  {t("practice.autoNext")}
                  <Toggle
                    aria-label={t("practice.autoNext")}
                    checked={snap.settings.autoNext !== false}
                    onChange={(enabled) => void invoke("set_auto_next", { enabled })}
                  />
                </label>
                <label className="field">
                  {t("practice.lookup")}
                  <Toggle
                    aria-label={t("practice.lookup")}
                    checked={snap.settings.wordLookup === true}
                    onChange={(enabled) => void invoke("set_word_lookup", { enabled })}
                  />
                </label>
                <label className="field">
                  {t("look.glossLang")}
                  <NiceSelect
                    value={snap.settings.glossLang || "zh"}
                    onChange={(glossLang) => {
                      void invoke("set_gloss_lang", { glossLang });
                      void reloadGlossary(glossLang).then(() => setLemmaCount(glossarySize()));
                    }}
                    options={GLOSS_LANG_OPTIONS.map((item) => ({
                      value: item.value,
                      label: t(item.labelKey),
                    }))}
                  />
                </label>
              </div>
            </section>

            <section
              id="settings-voice"
              className="settings-section"
              data-settings-section="voice"
            >
              <h2 className="settings-heading">{t("nav.voice")}</h2>
              <div className="settings-block">
                <label className="field">
                  {t("voice.autoSpeak")}
                  <Toggle
                    aria-label={t("voice.autoSpeak")}
                    checked={snap.settings.autoSpeak !== false}
                    onChange={(enabled) => void invoke("set_auto_speak", { enabled })}
                  />
                </label>
                {(voiceBusy || voiceProgress) && voiceProgress?.op !== "runtime" && (
                  <div className="book-progress" aria-live="polite">
                    <div className="book-progress-meta">
                      <span>
                        {voiceProgress?.title ? `${voiceProgress.title} · ` : ""}
                        {voiceProgress?.message
                          || t(`voice.phase.${voiceProgress?.phase || "download"}`)
                          || t("voice.progress.indeterminate")}
                      </span>
                      <span>
                        {t("books.progress", {
                          pct: Math.round(voiceProgress?.percent ?? 0),
                        })}
                      </span>
                    </div>
                    <div
                      className={`book-progress-track${
                        voiceProgress && voiceProgress.total <= 0 && (voiceProgress.percent ?? 0) < 100
                          ? " indeterminate"
                          : ""
                      }`}
                    >
                      <div
                        className="book-progress-fill"
                        style={{
                          width: `${Math.max(4, Math.min(100, voiceProgress?.percent ?? 8))}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
                <div className="field">
                  {t("voice.engine")}
                  <NiceSelect
                    value={
                      snap.settings.ttsEngine === "piper" ? "piper" : "system"
                    }
                    onChange={(engine) => {
                      void invoke<Snapshot>("set_tts_engine", { engine }).then(async (next) => {
                        setSnap(next);
                        setMessage(null);
                        try {
                          setVoices(await invoke<VoiceInfo[]>("list_voices"));
                        } catch {
                          /* ignore */
                        }
                      });
                    }}
                    options={[
                      { value: "system", label: t("voice.system") },
                      { value: "piper", label: t("voice.local") },
                    ]}
                  />
                </div>
                {(snap.settings.ttsEngine || "system") === "system" ? (
                  <div className="field">
                    {t("voice.timbre")}
                    <div className="row" style={{ gap: 8, width: "100%" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <NiceSelect
                          value={snap.settings.voiceId ?? ""}
                          onChange={(voiceId) =>
                            void invoke("set_voice", { voiceId: voiceId || null })
                          }
                          options={[
                            { value: "", label: t("voice.default") },
                            ...voices.map((voice) => ({
                              value: voice.id,
                              label: `${voice.name} · ${voice.language}`,
                            })),
                          ]}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          void invoke("preview_voice", {
                            voiceId: snap.settings.voiceId,
                          }).catch((err) => setMessage(String(err)))
                        }
                      >
                        {t("voice.preview")}
                      </button>
                    </div>
                  </div>
                ) : null}
                {(snap.settings.ttsEngine || "system") === "piper" ? (
                  <>
                    {!piperRuntimeReady ? (
                      <div className="field">
                        {t("voice.runtime")}
                        {voiceBusy && voiceProgress?.op === "runtime" ? (
                          <div className="runtime-inline" aria-live="polite">
                            <div className="runtime-inline-track">
                              <div
                                className="book-progress-fill"
                                style={{
                                  width: `${Math.max(
                                    4,
                                    Math.min(100, voiceProgress.percent ?? 8),
                                  )}%`,
                                }}
                              />
                            </div>
                            <span className="runtime-inline-pct">
                              {Math.round(voiceProgress.percent ?? 0)}%
                            </span>
                            <button
                              type="button"
                              className="runtime-cancel"
                              onClick={() => void invoke("cancel_piper_install")}
                            >
                              {t("voice.runtimeCancel")}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn-dark"
                            disabled={voiceBusy}
                            onClick={() => {
                              setVoiceBusy(true);
                              setVoiceProgress({
                                op: "runtime",
                                phase: "download",
                                loaded: 0,
                                total: 0,
                                percent: 2,
                                title: "Piper",
                                message: null,
                              });
                              void invoke("install_piper_runtime")
                                .then(async () => {
                                  setPiperRuntimeReady(true);
                                  await refreshVoices();
                                })
                                .catch((err) => {
                                  const msg = String(err);
                                  if (!/取消|cancel/i.test(msg)) setMessage(msg);
                                })
                                .finally(() => {
                                  setVoiceBusy(false);
                                  setVoiceProgress(null);
                                });
                            }}
                          >
                            {t("voice.runtimeInstall")}
                          </button>
                        )}
                      </div>
                    ) : null}
                    <div className="field">
                      {t("voice.timbre")}
                      <div className="row" style={{ gap: 8, width: "100%" }}>
                        <span className="settings-voice-meta">
                          {(() => {
                            const current = voices.find(
                              (v) => v.installed && v.id === snap.settings.voiceId,
                            );
                            const fallback = voices.find((v) => v.installed);
                            const pick = current || fallback;
                            return pick
                              ? `${pick.name} · ${pick.language}`
                              : t("voice.default");
                          })()}
                        </span>
                        <span className="settings-voice-actions">
                          <button
                            type="button"
                            disabled={!voices.some((v) => v.installed)}
                            onClick={() =>
                              void invoke("preview_voice", {
                                voiceId: snap.settings.voiceId,
                              }).catch((err) => setMessage(String(err)))
                            }
                          >
                            {t("voice.preview")}
                          </button>
                          <button
                            type="button"
                            className="btn-theme"
                            onClick={() => {
                              setVoiceBusy(false);
                              setInstallingVoiceId(null);
                              setVoiceProgress(null);
                              setVoicePickerOpen(true);
                            }}
                          >
                            {t("voice.change")}
                          </button>
                        </span>
                      </div>
                    </div>
                  </>
                ) : null}
                <label className="field">
                  {t("voice.rate")}
                  <TextSeg
                    aria-label={t("voice.rate")}
                    value={
                      RATE_OPTIONS.find(
                        (item) => Math.abs(Number(item) - snap.settings.rate) < 0.001,
                      ) ?? "1"
                    }
                    onChange={(rate) => void invoke("set_rate", { rate: Number(rate) })}
                    options={RATE_OPTIONS.map((rate) => ({
                      value: rate,
                      label: rate.includes(".") ? rate : `${rate}.0`,
                    }))}
                  />
                </label>
              </div>
            </section>

            <section
              id="settings-keys"
              className="settings-section"
              data-settings-section="keys"
            >
              <h2 className="settings-heading settings-heading-row">
                <span>{t("nav.keys")}</span>
                <button
                  type="button"
                  className="settings-reset-btn"
                  onClick={() => void resetHotkeys()}
                >
                  {t("keys.reset")}
                </button>
              </h2>
              <div className="settings-block">
                <HotkeyField
                  label={t("keys.prev")}
                  value={snap.settings.hotkeys?.prev ?? ""}
                  onCommit={(accelerator) => saveHotkey("prev", accelerator)}
                />
                <HotkeyField
                  label={t("keys.next")}
                  value={snap.settings.hotkeys?.next ?? ""}
                  onCommit={(accelerator) => saveHotkey("next", accelerator)}
                />
                <HotkeyField
                  label={t("keys.repeat")}
                  value={snap.settings.hotkeys?.repeat ?? ""}
                  onCommit={(accelerator) => saveHotkey("repeat", accelerator)}
                />
                <HotkeyField
                  label={t("keys.toggle")}
                  value={snap.settings.hotkeys?.toggle ?? ""}
                  onCommit={(accelerator) => saveHotkey("toggle", accelerator)}
                />
                <HotkeyField
                  label={t("keys.bookmark")}
                  value={snap.settings.hotkeys?.bookmark ?? ""}
                  onCommit={(accelerator) => saveHotkey("bookmark", accelerator)}
                />
                <HotkeyField
                  label={t("keys.panel")}
                  value={snap.settings.hotkeys?.panel ?? ""}
                  onCommit={(accelerator) => saveHotkey("panel", accelerator)}
                />
                <HotkeyField
                  label={t("keys.rate")}
                  value={snap.settings.hotkeys?.rate ?? ""}
                  onCommit={(accelerator) => saveHotkey("rate", accelerator)}
                />
                <HotkeyField
                  label={t("keys.hint")}
                  value={snap.settings.hotkeys?.hint ?? ""}
                  onCommit={(accelerator) => saveHotkey("hint", accelerator)}
                />
              </div>
            </section>
          </>
        )}


        </div>
          </>
        )}

        {practiceSheet ? (
          <div
            className="practice-drawer-backdrop"
            onClick={() => setPracticeSheet(null)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setPracticeSheet(null);
            }}
          >
            <div
              className="practice-drawer"
              role="dialog"
              aria-modal="true"
              aria-label={
                practiceSheet === "packs" ? t("practice.catalog") : t("practice.items")
              }
              onClick={(event) => event.stopPropagation()}
            >
              <div className="practice-drawer-head">
                <h3>
                  {practiceSheet === "packs" ? (
                    t("practice.catalog")
                  ) : (
                    <>
                      <span>{t("practice.items")}</span>
                      {snap.items.length > 0 ? (
                        <span className="practice-drawer-count">
                          {snap.index + 1}/{snap.items.length}
                        </span>
                      ) : null}
                    </>
                  )}
                </h3>
                <button
                  type="button"
                  className="practice-drawer-close"
                  aria-label={t("chrome.close")}
                  onClick={() => setPracticeSheet(null)}
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>
              {practiceSheet === "packs" ? (
                <div className="practice-drawer-body">
                  {(() => {
                    type PackRow = {
                      id: string;
                      title: string;
                      total: number;
                      done: number;
                      percent: number;
                      active: boolean;
                      onPick: () => void;
                    };
                    const systemIds = [
                      {
                        id: "wrong",
                        title: t("mine.wrong"),
                        fallback: wrongBook.length,
                        onPick: () => void openPack("wrong"),
                      },
                      {
                        id: "bookmarks",
                        title: t("mine.bookmarks"),
                        fallback: (snap.bookmarks ?? []).length,
                        onPick: () => void openPack("bookmarks"),
                      },
                      {
                        id: "review",
                        title: t("practice.source.review"),
                        fallback: snap.reviewDue ?? 0,
                        onPick: () => void openPack("review"),
                      },
                    ] as const;

                    const rows: PackRow[] = [
                      ...systemIds.map((pack) => {
                        const prog = progressForPack("pack", pack.id);
                        return {
                          id: pack.id,
                          title: pack.title,
                          total: prog?.total || pack.fallback,
                          done: prog?.done ?? 0,
                          percent: prog?.percent ?? 0,
                          active:
                            snap.practiceSource === "pack" && snap.wordbookId === pack.id,
                          onPick: pack.onPick,
                        };
                      }),
                      ...bookInstalled
                        .filter((book) => onGlossTrack(book, snap.settings.glossLang || "zh"))
                        .map((book) => {
                        const prog = progressForPack("pack", book.id);
                        return {
                          id: book.id,
                          title: book.title,
                          total: prog?.total || book.lemmaCount || 0,
                          done: prog?.done ?? 0,
                          percent: prog?.percent ?? 0,
                          active: snap.wordbookId === book.id,
                          onPick: () => {
                            setPracticeSheet(null);
                            askStartPack(book.id, book.title);
                          },
                        };
                      }),
                    ];

                    if (rows.length === 0) {
                      return (
                        <p className="practice-sheet-empty">{t("practice.catalogEmpty")}</p>
                      );
                    }

                    return (
                      <ul className="practice-pack-list">
                        {rows.map((row) => {
                          const pct = Math.max(0, Math.min(100, row.percent));
                          const hasTrack = row.total > 0;
                          return (
                            <li key={row.id}>
                              <button
                                type="button"
                                className={`practice-pack-row${row.active ? " on" : ""}`}
                                onClick={row.onPick}
                              >
                                <span className="practice-pack-row-top">
                                  <strong>{row.title}</strong>
                                  {hasTrack ? (
                                    <span className="practice-pack-pct">{pct}%</span>
                                  ) : null}
                                </span>
                                {hasTrack ? (
                                  <span className="practice-pack-track" aria-hidden>
                                    <span
                                      className="practice-pack-fill"
                                      style={{
                                        width: `${pct > 0 ? Math.max(2, pct) : 0}%`,
                                      }}
                                    />
                                  </span>
                                ) : null}
                                <span className="practice-pack-meta">
                                  {hasTrack
                                    ? t("practice.packProgress", {
                                        done: String(row.done),
                                        total: String(row.total),
                                      })
                                    : "0"}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    );
                  })()}
                </div>
              ) : (
                <div className="practice-drawer-body">
                  {snap.items.length === 0 ? (
                    <p className="practice-sheet-empty">{t("practice.itemsEmpty")}</p>
                  ) : (
                    <ul className="practice-sheet-list">
                      {(() => {
                        const doneSet = new Set(snap.sourceProgress?.completed ?? []);
                        return snap.items.map((entry, index) => {
                          const on = index === snap.index;
                          const done = doneSet.has(entry.text);
                          return (
                            <li key={`${index}-${entry.text}`}>
                              <button
                                type="button"
                                className={`practice-sheet-row${on ? " on" : ""}`}
                                onClick={() => {
                                  void invoke("jump_queue", { index });
                                  setPracticeSheet(null);
                                }}
                              >
                                <span className="practice-sheet-row-main">
                                  <strong>
                                    {index + 1}. {entry.text}
                                  </strong>
                                  {entry.hint ? <span>{entry.hint}</span> : null}
                                </span>
                                <span
                                  className={`practice-sheet-badge${done ? " done" : ""}${on ? " now" : ""}`}
                                >
                                  {on
                                    ? t("practice.itemCurrent")
                                    : done
                                      ? t("practice.itemDone")
                                      : t("practice.itemTodo")}
                                </span>
                              </button>
                            </li>
                          );
                        });
                      })()}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
      </div>

      {sessionPrompt ? (
        <div
          className="practice-sheet-backdrop"
          onClick={() => setSessionPrompt(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setSessionPrompt(null);
          }}
        >
          <div
            className="session-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("discover.sessionTitle")}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="session-dialog-head">
              <h3>{sessionPrompt.title}</h3>
              <button
                type="button"
                className="session-dialog-close"
                aria-label={t("chrome.close")}
                onClick={() => setSessionPrompt(null)}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <div className="session-dialog-body">
              <div className="session-mode" role="group" aria-label={t("discover.sessionTitle")}>
                <button
                  type="button"
                  className={`session-mode-btn${sessionMode === "sequential" ? " on" : ""}`}
                  onClick={() => setSessionMode("sequential")}
                >
                  {t("discover.sessionSeq")}
                </button>
                <button
                  type="button"
                  className={`session-mode-btn${sessionMode === "random" ? " on" : ""}`}
                  onClick={() => setSessionMode("random")}
                >
                  {t("discover.sessionRandom")}
                </button>
              </div>
              <p className="session-mode-hint">
                {sessionMode === "random"
                  ? t("discover.sessionRandomHint")
                  : t("discover.sessionSeqHint")}
              </p>
              <div className="session-size">
                <span className="session-size-label">{t("discover.sessionSize")}</span>
                <div className="session-size-picks" role="group" aria-label={t("discover.sessionSize")}>
                  {[20, 50, 100].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`session-size-btn${sessionSize === n ? " on" : ""}`}
                      onClick={() => setSessionSize(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="btn-theme session-go"
                onClick={() =>
                  void openPack(sessionPrompt.id, {
                    mode: sessionMode,
                    size: sessionSize,
                  })
                }
              >
                {t("discover.sessionGo")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {createBookOpen ? (
        <div
          className="practice-sheet-backdrop"
          onClick={() => setCreateBookOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setCreateBookOpen(false);
          }}
        >
          <div
            className="session-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("mine.diyCreateTitle")}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="session-dialog-head">
              <h3>{t("mine.diyCreateTitle")}</h3>
              <button
                type="button"
                className="session-dialog-close"
                aria-label={t("chrome.close")}
                onClick={() => setCreateBookOpen(false)}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <div className="session-dialog-body">
              <label className="session-field">
                <span className="session-field-label">{t("mine.diyCreateTitle")}</span>
                <input
                  autoFocus
                  value={createBookTitle}
                  placeholder={t("mine.diyCreatePlaceholder")}
                  onChange={(e) => setCreateBookTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void createDiyBook(createBookTitle);
                  }}
                />
              </label>
              <div className="session-dialog-actions">
                <button
                  type="button"
                  className="library-btn"
                  onClick={() => setCreateBookOpen(false)}
                >
                  {t("chrome.cancel")}
                </button>
                <button
                  type="button"
                  className="btn-theme"
                  disabled={booksBusy || !createBookTitle.trim()}
                  onClick={() => void createDiyBook(createBookTitle)}
                >
                  {t("mine.diyCreateConfirm")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDialog ? (
        <div
          className="practice-sheet-backdrop"
          onClick={() => setConfirmDialog(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setConfirmDialog(null);
          }}
        >
          <div
            className="session-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("chrome.confirm")}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="session-dialog-head">
              <h3>{t("chrome.confirm")}</h3>
              <button
                type="button"
                className="session-dialog-close"
                aria-label={t("chrome.close")}
                onClick={() => setConfirmDialog(null)}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <div className="session-dialog-body">
              <p className="session-mode-hint">{confirmDialog.message}</p>
              <div className="session-dialog-actions">
                <button
                  type="button"
                  className="library-btn"
                  onClick={() => setConfirmDialog(null)}
                >
                  {t("chrome.cancel")}
                </button>
                <button
                  type="button"
                  className="btn-theme"
                  onClick={() => {
                    const run = confirmDialog.onConfirm;
                    setConfirmDialog(null);
                    run();
                  }}
                >
                  {confirmDialog.confirmLabel ?? t("chrome.confirm")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {voicePickerOpen ? (
        <div
          className="practice-drawer-backdrop"
          onClick={() => setVoicePickerOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setVoicePickerOpen(false);
          }}
        >
          <div
            className="practice-drawer voice-picker-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={t("voice.changeTitle")}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="practice-drawer-head">
              <h3>{t("voice.changeTitle")}</h3>
              <button
                type="button"
                className="practice-drawer-close"
                aria-label={t("chrome.close")}
                onClick={() => setVoicePickerOpen(false)}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <div className="practice-drawer-body voice-picker-body">
              {!piperRuntimeReady ? (
                <p className="note">{t("voice.runtimeNote")}</p>
              ) : null}
              <div className="voice-filters">
                <div className="field">
                  {t("voice.filter.lang")}
                  <TextSeg
                    aria-label={t("voice.filter.lang")}
                    value={voiceLang}
                    onChange={setVoiceLang}
                    options={[
                      { value: "all", label: t("voice.filter.all") },
                      { value: "en-US", label: "US" },
                      { value: "en-GB", label: "GB" },
                    ]}
                  />
                </div>
                <div className="field">
                  {t("voice.filter.gender")}
                  <TextSeg
                    aria-label={t("voice.filter.gender")}
                    value={voiceGender}
                    onChange={setVoiceGender}
                    options={[
                      { value: "all", label: t("voice.filter.all") },
                      { value: "female", label: t("voice.gender.female") },
                      { value: "male", label: t("voice.gender.male") },
                    ]}
                  />
                </div>
              </div>
              {piperCatalog && piperCatalog.voices.length > 0 ? (
                <ul className="voice-list">
                  {piperCatalog.voices
                    .filter((entry) => {
                      if (voiceLang !== "all" && entry.language !== voiceLang) return false;
                      if (voiceGender !== "all" && (entry.gender || "unknown") !== voiceGender) {
                        return false;
                      }
                      return true;
                    })
                    .sort((a, b) => {
                      const ai = voices.some((v) => v.id === a.id && v.installed) ? 0 : 1;
                      const bi = voices.some((v) => v.id === b.id && v.installed) ? 0 : 1;
                      return ai - bi;
                    })
                    .map((entry) => {
                      const installed = voices.some((v) => v.id === entry.id && v.installed);
                      const active = snap.settings.voiceId === entry.id;
                      const locale =
                        entry.language === "en-US"
                          ? "US"
                          : entry.language === "en-GB"
                            ? "GB"
                            : entry.language;
                      const meta: string[] = [locale];
                      if (entry.gender === "female" || entry.gender === "male") {
                        meta.push(t(`voice.gender.${entry.gender}`));
                      }
                      if (entry.sizeHintMb) {
                        meta.push(t("voice.sizeMb", { n: entry.sizeHintMb }));
                      }
                      return (
                        <li
                          key={entry.id}
                          className={`voice-row${active ? " on" : ""}${installed ? " installed" : ""}`}
                        >
                          <div className="voice-row-copy">
                            <strong className="voice-row-name">{entry.name}</strong>
                            <span className="voice-row-meta">{meta.join(" · ")}</span>
                          </div>
                          <div className="voice-row-actions">
                            {installed ? (
                              <>
                                <button
                                  type="button"
                                  className="voice-row-btn"
                                  onClick={() =>
                                    void invoke("preview_voice", { voiceId: entry.id }).catch(
                                      (err) => setMessage(String(err)),
                                    )
                                  }
                                >
                                  {t("voice.preview")}
                                </button>
                                {active ? (
                                  <span className="voice-row-using">{t("voice.using")}</span>
                                ) : (
                                  <button
                                    type="button"
                                    className="voice-row-btn primary"
                                    onClick={() =>
                                      void invoke("set_voice", { voiceId: entry.id })
                                    }
                                  >
                                    {t("voice.use")}
                                  </button>
                                )}
                              </>
                            ) : (
                              <button
                                type="button"
                                className="voice-row-btn primary"
                                disabled={installingVoiceId != null}
                                onClick={() => {
                                  if (installingVoiceId) return;
                                  setInstallingVoiceId(entry.id);
                                  setVoiceBusy(true);
                                  setVoiceProgress({
                                    op: "voice",
                                    id: entry.id,
                                    title: entry.name,
                                    phase: "download",
                                    loaded: 0,
                                    total: 0,
                                    percent: 2,
                                    message: null,
                                  });
                                  void invoke("install_piper_voice", { id: entry.id })
                                    .then(async () => {
                                      await refreshVoices();
                                      if (!snap.settings.voiceId) {
                                        await invoke("set_voice", { voiceId: entry.id });
                                      }
                                    })
                                    .catch((err) => setMessage(String(err)))
                                    .finally(() => {
                                      setInstallingVoiceId(null);
                                      setVoiceBusy(false);
                                      setVoiceProgress(null);
                                    });
                                }}
                              >
                                {installingVoiceId === entry.id
                                  ? `${t("voice.install")}…`
                                  : t("voice.install")}
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                </ul>
              ) : (
                <p className="note">{t("books.catalogEmpty")}</p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {detailLemma ? (
        <div
          className="word-detail-backdrop"
          onClick={() => setDetailLemma(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setDetailLemma(null);
          }}
        >
          <div className="word-detail-shell" onClick={(event) => event.stopPropagation()}>
            <WordDetail
              lemma={detailLemma}
              glossLang={snap.settings.glossLang || "zh"}
              color={ink(color, 1)}
              onClose={() => setDetailLemma(null)}
            />
          </div>
        </div>
      ) : null}

      {exportJob ? (
        <ExportSheet
          title={exportJob.title}
          rows={exportJob.rows}
          t={t}
          onClose={() => setExportJob(null)}
          onNeedPro={() => {
            setExportJob(null);
            if (showAccountPage) setTab("account");
          }}
        />
      ) : null}

      {importOpen ? (
        <ImportSheet
          t={t}
          busy={booksBusy}
          onClose={() => setImportOpen(false)}
          onInstalled={(book) => void finishDiyImport(book)}
          onError={(msg) => setMessage(msg)}
        />
      ) : null}

      {feedsOpen ? (
        <FeedSheet
          t={t}
          feeds={bookFeeds}
          busy={booksBusy}
          onClose={() => setFeedsOpen(false)}
          onRefresh={() => syncWordbookFeeds()}
          onAdd={(url) => addWordbookFeed(url)}
          onRemove={(id) => removeWordbookFeed(id)}
        />
      ) : null}

      {libCtx ? (
        <ContextMenu
          x={libCtx.x}
          y={libCtx.y}
          items={
            [
              ...(libCtx.onOpen
                ? [{ type: "item" as const, id: "detail", label: t("ctx.openDetail") }]
                : []),
              ...(libCtx.canPractice
                ? [{ type: "item" as const, id: "practice", label: t("ctx.practiceItem") }]
                : []),
              ...(libCtx.onDel
                ? [
                    { type: "sep" as const },
                    { type: "item" as const, id: "delete", label: t("ctx.delete"), danger: true },
                  ]
                : []),
            ] satisfies ContextMenuItem[]
          }
          onClose={() => setLibCtx(null)}
          onPick={(id) => {
            if (id === "detail") libCtx.onOpen?.();
            else if (id === "practice") void openPack(libCtx.shelfId);
            else if (id === "delete") libCtx.onDel?.();
          }}
        />
      ) : null}
    </main>
  );
}

function ToolbarSlotsList({
  orderedRows,
  enabled,
  enabledSet,
  labelOf,
  rowKey,
  commit,
}: {
  orderedRows: Array<(typeof TOOLBAR_ROWS)[number]>;
  enabled: ToolbarId[];
  enabledSet: Set<ToolbarId>;
  labelOf: (row: (typeof TOOLBAR_ROWS)[number]) => string;
  rowKey: (row: (typeof TOOLBAR_ROWS)[number]) => string;
  commit: (items: ToolbarId[]) => void;
}) {
  const dragKeyRef = useRef<string | null>(null);
  const overKeyRef = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  function endDrag() {
    const from = dragKeyRef.current;
    const to = overKeyRef.current;
    dragKeyRef.current = null;
    overKeyRef.current = null;
    setDragging(null);
    setOverKey(null);
    if (!from || !to || from === to) return;
    commit(reorderToolbarBlocks(enabled, from, to));
  }

  return (
    <ul className="toolbar-slots">
      {orderedRows.map((row) => {
        const on = row.pair === "nav" ? enabledSet.has("prev") : enabledSet.has(row.id);
        const key = rowKey(row);
        return (
          <li
            key={key}
            data-toolbar-key={key}
            className={[
              on ? "on" : "",
              dragging === key ? "dragging" : "",
              overKey === key && dragging && overKey !== dragging ? "drag-over" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span className="toolbar-slot-main">
              {on ? (
                <span
                  className="toolbar-drag"
                  aria-hidden
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    dragKeyRef.current = key;
                    overKeyRef.current = key;
                    setDragging(key);
                    setOverKey(key);
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    if (!dragKeyRef.current) return;
                    const hit = document
                      .elementFromPoint(event.clientX, event.clientY)
                      ?.closest<HTMLElement>("li[data-toolbar-key]");
                    if (!hit || !hit.classList.contains("on")) return;
                    const next = hit.dataset.toolbarKey ?? null;
                    if (!next || next === overKeyRef.current) return;
                    overKeyRef.current = next;
                    setOverKey(next);
                  }}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                >
                  ⋮⋮
                </span>
              ) : (
                <span className="toolbar-drag spacer" aria-hidden />
              )}
              <span className="toolbar-slot-label">{labelOf(row)}</span>
            </span>
            <Toggle
              aria-label={labelOf(row)}
              checked={on}
              onChange={(nextOn) => {
                if (row.pair === "nav") {
                  commit(toggleNavPair(enabled, nextOn));
                  return;
                }
                if (nextOn) commit([...enabled, row.id]);
                else commit(enabled.filter((item) => item !== row.id));
              }}
            />
          </li>
        );
      })}
    </ul>
  );
}

function HotkeyField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (accelerator: string) => Promise<void>;
}) {
  const [recording, setRecording] = useState(false);

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setRecording(false);
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      void onCommit("");
      return;
    }
    if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
    const accelerator = eventToAccelerator(event);
    if (!accelerator) return;
    void onCommit(accelerator);
    setRecording(false);
    event.currentTarget.blur();
  }

  return (
    <label className="hotkey">
      <span>{label}</span>
      <input
        type="text"
        readOnly
        value={recording ? "" : formatAccelerator(value)}
        placeholder={recording ? "按下快捷键…" : "点击设置"}
        onFocus={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={onKeyDown}
      />
    </label>
  );
}

function eventToAccelerator(event: React.KeyboardEvent) {
  const bare = !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
  const functionKey = /^F\d{1,2}$/.test(event.code);
  if (bare && !functionKey) return null;
  if (event.code === "Escape") return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("ctrl");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  if (event.metaKey) parts.push("super");
  parts.push(event.code.toLowerCase());
  return parts.join("+");
}

function formatAccelerator(spec: string) {
  if (!spec) return "";
  return spec.split("+").map(formatToken).join("+");
}

function formatToken(token: string) {
  const names: Record<string, string> = {
    ctrl: "Ctrl",
    alt: "Alt",
    shift: "Shift",
    super: "Win",
    arrowleft: "←",
    arrowright: "→",
    arrowup: "↑",
    arrowdown: "↓",
    space: "Space",
    escape: "Esc",
    enter: "Enter",
    tab: "Tab",
    backspace: "Backspace",
    delete: "Delete",
    backquote: "`",
    period: ".",
    comma: ",",
  };
  const known = names[token];
  if (known) return known;
  if (token.startsWith("key") && token.length === 4) return token.slice(3).toUpperCase();
  if (token.startsWith("digit")) return token.slice(5);
  if (token.startsWith("f") && /^f\d+$/.test(token)) return token.toUpperCase();
  return token;
}
