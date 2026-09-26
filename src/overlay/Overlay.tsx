import { useEffect, useRef, useState, type ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBolt,
  faBookmark,
  faChevronLeft,
  faChevronRight,
  faCopy,
  faMagnifyingGlass,
  faRotateRight,
  faTableColumns,
} from "@fortawesome/free-solid-svg-icons";
import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { blankMask } from "../blank";
import { ink } from "../color";
import { playKeySound, warmKeySounds, readKeySoundId } from "../effects/keySound";
import { playComboSound, warmComboSounds } from "../effects/comboSound";
import { readParticleSkin } from "../effects/particleSkin";
import { SKIN_INK, showSkinsNav } from "../edition";
import "../edition/boot";
import { fontStack } from "../font";
import { gainStreak, levelOf, STREAK_MS, defaultComboTheme } from "../effects/streak";
import type { BurstKind } from "../effects/streak";
import {
  ensureGlossary,
  entryOf,
  clipOneLine,
  oneLineGloss,
  candidatesFor,
  wordAt,
  sensesOf,
  type GlossCardPayload,
} from "../glossary";
import { resolvePracticeGloss, isWordLikeText } from "../wordbook/glossTrack";
import type { ClipPayload, Snapshot } from "../types";
import { todayKey } from "../types";
import { createT } from "../i18n";
import {
  formatRate,
  nextRate,
  sanitizeToolbar,
  type ToolbarId,
} from "../toolbar";
import "./overlay.css";
import "../effects/skin-ink.css";

function isIdle(char: string | undefined) {
  if (!char) return false;
  return /\s/u.test(char) || /[\p{P}\p{S}]/u.test(char);
}

/** Gradient ink clip only works on letters/digits — punctuation stays solid. */
function canTakeInk(char: string) {
  return /[\p{L}\p{N}]/u.test(char);
}

function skipIdle(index: number, source: string) {
  let next = index;
  while (isIdle(source[next])) next += 1;
  return next;
}

function retreat(index: number, source: string) {
  if (index <= 0) return 0;
  let next = index - 1;
  while (next > 0 && isIdle(source[next])) next -= 1;
  return next;
}

function comboStyle(settings: Snapshot["settings"], accent?: string | null) {
  return {
    sparks: false,
    place: settings.comboPlace || "follow",
    scale: settings.comboScale || 1,
    blur: settings.comboBlur !== false,
    theme: accent || settings.fontColor || defaultComboTheme,
    fontSize: settings.fontSize || 28,
  };
}

function captionBox(
  root: HTMLElement | null,
  line: HTMLElement | null,
  origin: { x: number; y: number },
) {
  const box =
    (line?.querySelector(".caption") as HTMLElement | null) || line || root;
  if (!box) {
    return {
      anchorX: origin.x,
      anchorY: origin.y,
      anchorW: 420,
      anchorH: 40,
    };
  }
  // getBoundingClientRect is relative to this webview; add window screen origin.
  const rect = box.getBoundingClientRect();
  return {
    anchorX: origin.x + rect.left,
    anchorY: origin.y + rect.top,
    anchorW: Math.max(1, rect.width),
    anchorH: Math.max(1, rect.height),
  };
}

async function overlayOrigin() {
  const win = getCurrentWindow();
  const factor = await win.scaleFactor();
  const pos = await win.outerPosition();
  return { x: pos.x / factor, y: pos.y / factor };
}

export default function Overlay() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [glossaryReady, setGlossaryReady] = useState(0);
  const [count, setCount] = useState(0);
  const [rejected, setRejected] = useState(false);
  const [miss, setMiss] = useState<string | null>(null);
  const [hot, setHot] = useState(false);
  const [focused, setFocused] = useState(false);
  const [fresh, setFresh] = useState<number | null>(null);
  const [blanks, setBlanks] = useState<boolean[]>([]);
  const [picked, setPicked] = useState<{ start: number; end: number } | null>(null);
  const [liveFont, setLiveFont] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLParagraphElement>(null);
  const streakRef = useRef(0);
  const maxRef = useRef(Number(localStorage.getItem("bubtype.maxStreak") || "0"));
  const streakAt = useRef(0);
  const idleTimer = useRef(0);
  const freshTimer = useRef(0);
  const missTimer = useRef(0);
  const shookAt = useRef(0);
  const originRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef(false);
  const userResizeRef = useRef(false);
  const skipFitUntilRef = useRef(0);
  const lastSizeRef = useRef({ w: 0, h: 0 });
  const resizeStartRef = useRef({ w: 0, h: 0, font: 28 });
  const resizeAnchorRef = useRef<{
    fixRight: boolean;
    fixBottom: boolean;
    right: number;
    bottom: number;
  } | null>(null);
  const packedFontRef = useRef<number | null>(null);
  const fittingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);
  const fontRef = useRef(28);

  const PAD_X = 12;
  const PAD_Y = 4;
  const FONT_MIN = 10;
  const FONT_MAX = 72;

  function clampFont(font: number) {
    return Math.round(Math.min(FONT_MAX, Math.max(FONT_MIN, font)));
  }

  function waitPaint(): Promise<void> {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });
  }

  /** Packed content size for current font + sentence/hint + toolbar. */
  function measureContentSize(): { w: number; h: number } {
    const root = rootRef.current;
    const stage = stageRef.current;
    const line = lineRef.current;
    if (!root || !stage) return { w: 120, h: 40 };

    const ipa = stage.querySelector(".overlay-ipa") as HTMLElement | null;
    const hint = stage.querySelector(".overlay-hint") as HTMLElement | null;
    const chrome = stage.querySelector(".chrome") as HTMLElement | null;
    const sizer = stage.querySelector(".dictation-sizer") as HTMLElement | null;
    const tools = stage.querySelector(".tools") as HTMLElement | null;

    const lineW = Math.max(
      line?.scrollWidth ?? 0,
      line?.offsetWidth ?? 0,
      sizer?.scrollWidth ?? 0,
      ...(Array.from(line?.querySelectorAll(".caption, .ghost-line") ?? []) as HTMLElement[]).map(
        (el) => el.scrollWidth,
      ),
    );
    const ipaW = ipa ? Math.max(ipa.scrollWidth, ipa.offsetWidth) : 0;
    const hintW = hint ? Math.max(hint.scrollWidth, hint.offsetWidth) : 0;
    // Toolbar is absolute top-right; short captions must still leave room for it.
    const toolsW =
      tools && getComputedStyle(tools).display !== "none"
        ? Math.max(tools.scrollWidth, tools.offsetWidth)
        : 0;

    const style = getComputedStyle(root);
    const padX =
      (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const padTop = parseFloat(style.paddingTop) || 0;
    const padBottom = parseFloat(style.paddingBottom) || 0;
    const stageStyle = getComputedStyle(stage);
    const gap = parseFloat(stageStyle.gap) || 6;
    const stagePadTop = parseFloat(stageStyle.paddingTop) || 0;
    const ipaH = ipa ? ipa.offsetHeight : 0;
    const hintH = hint ? hint.offsetHeight : 0;
    const chromePad = chrome
      ? (parseFloat(getComputedStyle(chrome).paddingTop) || 0) +
        (parseFloat(getComputedStyle(chrome).paddingBottom) || 0)
      : 8;
    const lineH = Math.max(
      line?.scrollHeight ?? 0,
      line?.offsetHeight ?? 0,
      sizer?.offsetHeight ?? 0,
    );
    const rows = 1 + (ipa ? 1 : 0) + (hint ? 1 : 0);
    const gaps = gap * Math.max(0, rows - 1);

    return {
      w: Math.ceil(Math.max(lineW, ipaW, hintW, toolsW, 48) + padX + PAD_X),
      h: Math.ceil(
        padTop + stagePadTop + gaps + chromePad + lineH + ipaH + hintH + padBottom + PAD_Y,
      ),
    };
  }

  function scaleFromPointerDelta(
    direction: string,
    startW: number,
    startH: number,
    dx: number,
    dy: number,
  ) {
    let rw = 1;
    let rh = 1;
    if (direction.includes("East")) rw = (startW + dx) / startW;
    if (direction.includes("West")) rw = (startW - dx) / startW;
    if (direction.includes("South")) rh = (startH + dy) / startH;
    if (direction.includes("North")) rh = (startH - dy) / startH;
    const horiz = direction.includes("East") || direction.includes("West");
    const vert = direction.includes("North") || direction.includes("South");
    // Uniform scale: one font ↔ one aspect box. Pure X or Y still scales both axes.
    if (horiz && vert) return Math.sqrt(Math.max(0.01, rw) * Math.max(0.01, rh));
    if (horiz) return Math.max(0.01, rw);
    return Math.max(0.01, rh);
  }

  /**
   * One font ↔ one content box. Window always equals that box.
   * `preview`: CSS-only font (no backend snapshot) — used while dragging to avoid jitter.
   */
  async function packToContent(force = false, previewFont?: number) {
    if (fittingRef.current) return;
    if (userResizeRef.current && !force) return;
    const win = getCurrentWindow();
    fittingRef.current = true;
    if (!userResizeRef.current) {
      skipFitUntilRef.current = Date.now() + 300;
    }
    try {
      const targetFont = previewFont != null ? previewFont : fontRef.current;
      // Same font already packed this drag — skip (stops hold-still oscillation).
      if (
        previewFont != null &&
        packedFontRef.current === targetFont &&
        lastSizeRef.current.w > 0
      ) {
        return;
      }
      fontRef.current = targetFont;
      if (rootRef.current) rootRef.current.style.fontSize = `${targetFont}px`;
      await waitPaint();
      const factor = await win.scaleFactor();
      let pos = await win.outerPosition();
      let x = pos.x / factor;
      let y = pos.y / factor;
      const monitor = await currentMonitor();
      const screenW = monitor ? monitor.size.width / factor : 1200;
      const screenH = monitor ? monitor.size.height / factor : 800;
      const roomW = Math.max(64, Math.min(screenW * 0.95, screenW - 16));
      const roomH = Math.max(28, Math.min(screenH * 0.92, screenH - 16));

      for (let i = 0; i < 8; i += 1) {
        const need = measureContentSize();
        if ((need.w > roomW + 1 || need.h > roomH + 1) && fontRef.current > FONT_MIN) {
          const fit = Math.min(roomW / Math.max(need.w, 1), roomH / Math.max(need.h, 1));
          const nextFont = clampFont(fontRef.current * Math.min(0.96, fit));
          if (nextFont >= fontRef.current) break;
          fontRef.current = nextFont;
          if (rootRef.current) rootRef.current.style.fontSize = `${nextFont}px`;
          if (previewFont == null) {
            await invoke("set_font_size", { fontSize: nextFont });
          }
          await waitPaint();
          continue;
        }
        const nextW = Math.min(Math.max(48, need.w), roomW);
        const nextH = Math.min(Math.max(28, need.h), roomH);
        x = Math.min(x, screenW - nextW - 8);
        y = Math.min(y, screenH - nextH - 8);
        x = Math.max(8, x);
        y = Math.max(8, y);

        const anchor = resizeAnchorRef.current;
        if (anchor) {
          if (anchor.fixRight) x = anchor.right - nextW;
          if (anchor.fixBottom) y = anchor.bottom - nextH;
        }

        const size = await win.innerSize();
        const curW = size.width / factor;
        const curH = size.height / factor;
        // 2px deadzone — subpixel measure noise must not setSize in a loop.
        if (Math.abs(nextW - curW) >= 2 || Math.abs(nextH - curH) >= 2) {
          await win.setSize(new LogicalSize(nextW, nextH));
        }
        const curPos = await win.outerPosition();
        if (Math.abs(curPos.x / factor - x) >= 2 || Math.abs(curPos.y / factor - y) >= 2) {
          await win.setPosition(new LogicalPosition(x, y));
        }
        if (previewFont == null) {
          await invoke("remember_bounds", {
            x,
            y,
            width: nextW,
            height: nextH,
            syncFont: false,
          });
        }
        lastSizeRef.current = { w: nextW, h: nextH };
        originRef.current = { x, y };
        packedFontRef.current = fontRef.current;
        return;
      }
    } catch {
      /* ignore */
    } finally {
      fittingRef.current = false;
    }
  }

  async function applyFontAndPack(font: number, force = false) {
    const next = clampFont(font);
    fontRef.current = next;
    if (rootRef.current) rootRef.current.style.fontSize = `${next}px`;
    await invoke("set_font_size", { fontSize: next });
    await waitPaint();
    await packToContent(force);
  }

  const applyFontAndPackRef = useRef(applyFontAndPack);
  applyFontAndPackRef.current = applyFontAndPack;

  useEffect(() => {
    warmKeySounds();
    warmComboSounds();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const lang = snap?.settings.glossLang || "zh";
    void ensureGlossary(lang).then(() => {
      if (!cancelled) setGlossaryReady((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [snap?.settings.glossLang]);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    const loadSnap = (attempt = 0) => {
      void invoke<Snapshot>("get_snapshot")
        .then(setSnap)
        .catch((err: unknown) => {
          const text = String(err);
          if (attempt < 12 && /还在启动|not managed|manage/i.test(text)) {
            window.setTimeout(() => loadSnap(attempt + 1), 80);
          }
        });
    };
    loadSnap();
    void listen<Snapshot>("snapshot", (event) => setSnap(event.payload)).then((fn) => {
      unlisteners.push(fn);
    });
    void listen("stop-clip", () => {
      audioRef.current?.pause();
    }).then((fn) => unlisteners.push(fn));
    void listen<ClipPayload>("play-clip", (event) => {
      playClip(event.payload);
    }).then((fn) => unlisteners.push(fn));
    void listen("gloss-closed", () => {
      setPicked(null);
    }).then((fn) => unlisteners.push(fn));

    const win = getCurrentWindow();
    const track = async () => {
      const factor = await win.scaleFactor();
      const pos = await win.outerPosition();
      originRef.current = { x: pos.x / factor, y: pos.y / factor };
    };
    void track();
    let timer = 0;
    const remember = () => {
      void track();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void (async () => {
          // Custom scale-resize owns size while dragging — never fight it here.
          if (fittingRef.current || userResizeRef.current) return;
          if (Date.now() < skipFitUntilRef.current) return;
          const factor = await win.scaleFactor();
          const pos = await win.outerPosition();
          const size = await win.innerSize();
          const width = size.width / factor;
          const height = size.height / factor;
          lastSizeRef.current = { w: width, h: height };
          await invoke("remember_bounds", {
            x: pos.x / factor,
            y: pos.y / factor,
            width,
            height,
            syncFont: false,
          });
        })();
      }, 120);
    };
    void win.onResized(remember).then((fn) => unlisteners.push(fn));
    void win.onMoved(remember).then((fn) => unlisteners.push(fn));
    void win.innerSize().then(async (size) => {
      const factor = await win.scaleFactor();
      lastSizeRef.current = { w: size.width / factor, h: size.height / factor };
    });
    return () => {
      window.clearTimeout(timer);
      unlisteners.forEach((fn) => fn());
      audioRef.current?.pause();
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    };
  }, []);

  useEffect(() => {
    if (snap) fontRef.current = snap.settings.fontSize;
  }, [snap?.settings.fontSize]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !snap) return;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const steps = Math.max(1, Math.min(4, Math.round(Math.abs(event.deltaY) / 40)));
      const dir = event.deltaY > 0 ? -1 : 1;
      const cur = fontRef.current;
      const next = Math.round(
        Math.min(FONT_MAX, Math.max(FONT_MIN, cur + dir * steps * 2)),
      );
      if (next === Math.round(Math.min(FONT_MAX, Math.max(FONT_MIN, cur)))) return;
      void applyFontAndPackRef.current(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [snap]);

  useEffect(() => {
    const sentence = snap?.items[snap.index]?.text ?? "";
    setCount(skipIdle(0, sentence));
    setRejected(false);
    setMiss(null);
    window.clearTimeout(missTimer.current);
    setFresh(null);
    setPicked(null);
    const mode = snap?.settings.practiceMode || "type";
    if (mode === "blank" && sentence) {
      setBlanks(blankMask(sentence, (snap?.index ?? 0) * 17 + sentence.length));
    } else {
      setBlanks([]);
    }
    window.requestAnimationFrame(() => {
      void packToContent();
    });
  }, [snap?.index, snap?.settings.practiceMode, snap?.items[snap?.index ?? 0]?.text]);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      void packToContent();
    });
  }, [snap?.settings.fontSize, snap?.settings.showHint, snap?.settings.showIpa, glossaryReady, snap?.items[snap?.index ?? 0]?.hint, snap?.items[snap?.index ?? 0]?.text]);

  const effectId = snap?.settings.effect ?? "combo";
  const comboKey = snap
    ? `${snap.settings.fontColor}|${snap.settings.comboPlace}|${snap.settings.comboScale}|${snap.settings.comboBlur}|${snap.settings.captionOpacity}`
    : "";
  const ready = snap != null;
  useEffect(() => {
    if (!snap) return;
    let cancel = false;
    void (async () => {
      const win = getCurrentWindow();
      const factor = await win.scaleFactor();
      const pos = await win.outerPosition();
      if (cancel) return;
      originRef.current = { x: pos.x / factor, y: pos.y / factor };
      const on = (snap.settings.effect || "combo") === "combo";
      if (!on) streakRef.current = 0;
      void invoke("push_power", {
        hit: {
          x: 0,
          y: 0,
          ok: false,
          streak: on ? streakRef.current : 0,
          maxStreak: maxRef.current,
          level: on ? levelOf(streakRef.current) : 0,
          burst: "",
          burstKind: "",
          color: snap.settings.fontColor || defaultComboTheme,
          power: snap.settings.effectPower || 0.7,
          active: on,
          ...captionBox(rootRef.current, lineRef.current, originRef.current),
          ...comboStyle(snap.settings),
        },
      });
    })();
    return () => {
      cancel = true;
    };
  }, [effectId, ready, comboKey]);

  useEffect(
    () => () => {
      window.clearTimeout(idleTimer.current);
      window.clearTimeout(freshTimer.current);
    },
    [],
  );

  function playClip(payload: ClipPayload) {
    audioRef.current?.pause();
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    const binary = atob(payload.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: payload.mime }));
    audioUrl.current = url;
    const audio = new Audio(url);
    audioRef.current = audio;
    void audio.play();
  }

  if (!snap) return <div className="overlay" onContextMenu={(e) => e.preventDefault()} />;

  const t = createT(snap.settings.uiLocale);
  const item = snap.items[snap.index];
  const text = item?.text ?? "";
  const dictation =
    (snap.settings.practiceMode || "type") === "dictation" || snap.mode === "listen";
  const blankMode = (snap.settings.practiceMode || "type") === "blank";
  const effectOn = (snap.settings.effect || "combo") === "combo";
  const font = liveFont ?? snap.settings.fontSize;
  const family = fontStack(snap.settings.fontFamily || "JetBrains Mono");
  const color = ink(snap.settings.fontColor, snap.settings.opacity);
  const pending = ink(snap.settings.fontColor, snap.settings.opacity * 0.38);
  const power = snap.settings.effectPower || 0.7;
  const settings = snap.settings;
  const keyPack = readKeySoundId(snap.settings.keySound);
  const particleSkin = readParticleSkin(snap.settings.particleSkin);
  const skinInk = showSkinsNav ? SKIN_INK[particleSkin] ?? null : null;
  const accentSolid = skinInk?.accent
    ? ink(skinInk.accent, snap.settings.opacity)
    : color;
  const pendingColor = skinInk?.pending ?? pending;
  const frameColor = skinInk?.accent ?? snap.settings.fontColor;
  const captionOpacity =
    typeof snap.settings.captionOpacity === "number"
      ? snap.settings.captionOpacity
      : snap.settings.comboBlur === false
        ? 0
        : 0.82;
  const captionOn = captionOpacity > 0.02;
  const barePlaceholder = dictation && count === 0 && !focused;
  const captionChrome = captionOn && !barePlaceholder;
  const showHint = snap.settings.showHint === true;
  const showIpa = snap.settings.showIpa !== false;
  const wordLookup = snap.settings.wordLookup === true;
  const toolbarItems = sanitizeToolbar(snap.settings.toolbarItems);
  // Prefer current glossary; pack hint only when pack gloss matches settings.
  void glossaryReady;
  const lemmaKey = text.trim();
  const wordLike = isWordLikeText(lemmaKey);
  const glossEntry = wordLike && lemmaKey ? entryOf(lemmaKey) : null;
  const hintText = showHint
    ? clipOneLine(
        resolvePracticeGloss({
          wantGloss: snap.settings.glossLang || "zh",
          packId: snap.wordbookId,
          packGlossLang: snap.practiceGlossLang,
          hint: item?.hint,
          fromGlossary: wordLike ? oneLineGloss(glossEntry || lemmaKey, 32) : "",
        }),
        32,
      )
    : "";
  const ipaText = showIpa && wordLike ? glossEntry?.ipa?.trim() || "" : "";
  const sentenceKey = snap.index;
  const bookmarked = (snap.bookmarks ?? []).some((entry) => entry.text === text);

  function renderCaret() {
    if (!focused) return null;
    return <span className="caret" aria-hidden />;
  }

  function renderTyped(source: string) {
    return [...source].map((char, index) => {
      const paint = skinInk && canTakeInk(char);
      return (
        <span
          key={`${sentenceKey}-t-${index}`}
          style={paint ? undefined : { color: accentSolid }}
          className={paint ? skinInk?.typedClass : undefined}
        >
          {char === " " ? "\u00a0" : char}
        </span>
      );
    });
  }

  function renderChar(index: number, char: string) {
    const hiddenBlank = blankMode && blanks[index] && index >= count;
    const typed = index < count;
    const paint = typed && !!skinInk && canTakeInk(char);
    return (
      <span
        key={`${sentenceKey}-${index}`}
        data-i={index}
        style={{
          color: paint ? undefined : typed ? accentSolid : pendingColor,
          opacity: hiddenBlank ? 0 : undefined,
        }}
        className={[
          paint ? skinInk?.typedClass : "",
          rejected && index === count ? "bad" : "",
          effectOn && fresh === index ? "fresh" : "",
          hiddenBlank ? "blank" : "",
          wordLookup ? "word-tap" : "",
        ]
          .filter(Boolean)
          .join(" ") || undefined}
      >
        {hiddenBlank ? "_" : char === " " ? "\u00a0" : char}
      </span>
    );
  }

  /** Whole-word accent pill (Voya-style): one background, white ink — not per-letter. */
  function renderPracticeLine() {
    const chars = [...text];
    const nodes: ReactNode[] = [];
    let index = 0;
    while (index < chars.length) {
      if (focused && index === count) {
        nodes.push(<span key={`caret-${index}`} className="caret" aria-hidden />);
      }
      if (picked && index === picked.start) {
        const end = picked.end;
        const slice = chars.slice(picked.start, end);
        nodes.push(
          <span
            key={`hit-${picked.start}`}
            className="word-hit"
            style={{ backgroundColor: color }}
            data-i={picked.start}
          >
            {slice.map((char, offset) => {
              const i = picked.start + offset;
              const hiddenBlank = blankMode && blanks[i] && i >= count;
              return (
                <span key={`${sentenceKey}-h-${i}`} data-i={i}>
                  {hiddenBlank ? "_" : char}
                </span>
              );
            })}
          </span>,
        );
        index = end;
        continue;
      }
      nodes.push(renderChar(index, chars[index]));
      index += 1;
    }
    return nodes;
  }

  function track(ok: boolean, done: boolean, streak: number) {
    void invoke("track_practice", {
      ok,
      done,
      text,
      hint: item?.hint ?? null,
      streak,
      day: todayKey(),
    });
  }

  function caret(index: number) {
    const root = rootRef.current;
    const line = lineRef.current;
    if (!root || !line) return { x: 16, y: 16 };
    const rootBox = root.getBoundingClientRect();
    const span = line.querySelectorAll("span")[index] as HTMLElement | undefined;
    const box = (span ?? line).getBoundingClientRect();
    return {
      x: span ? box.left - rootBox.left + box.width / 2 : box.right - rootBox.left - 4,
      y: box.top - rootBox.top + box.height / 2,
    };
  }

  function shake(level: number) {
    const line = lineRef.current;
    if (!line) return;
    const now = performance.now();
    if (now - shookAt.current < 100) return;
    shookAt.current = now;
    const unit = Math.max(0.55, font / 28);
    const min = power * unit;
    const max = (3 + level) * power * unit;
    const span = Math.max(min, max);
    line.style.transform = `translate(${(Math.random() > 0.5 ? 1 : -1) * span}px, ${(Math.random() > 0.5 ? 1 : -1) * (min + Math.random() * (span - min))}px)`;
    window.setTimeout(() => {
      if (lineRef.current === line) line.style.transform = "";
    }, 75);
  }

  function publish(hit: {
    x: number;
    y: number;
    ok: boolean;
    streak: number;
    level: number;
    burst: string;
    burstKind: string;
    sparks?: boolean;
  }) {
    if (hit.burstKind) playComboSound(hit.burstKind as BurstKind);
    const skin = particleSkin;
    void (async () => {
      try {
        originRef.current = await overlayOrigin();
      } catch {
        /* keep last origin */
      }
      const origin = originRef.current;
      void invoke("push_power", {
        hit: {
          ...hit,
          maxStreak: maxRef.current,
          color,
          power,
          active: true,
          ...captionBox(rootRef.current, lineRef.current, origin),
          ...comboStyle(settings, skinInk?.accent),
          sparks: hit.sparks ?? false,
          skin,
        },
      });
    })();
  }

  function endStreak() {
    streakRef.current = 0;
    publish({ x: 0, y: 0, ok: false, streak: 0, level: 0, burst: "", burstKind: "" });
  }

  async function openGloss(charIndex: number) {
    if (!snap?.settings.wordLookup) return;
    await ensureGlossary();
    const hit = wordAt(text, charIndex);
    if (!hit) return;
    setPicked({ start: hit.start, end: hit.end });
    const origin = await overlayOrigin().catch(() => originRef.current);
    originRef.current = origin;
    const cands = candidatesFor(text, hit.word, hit.start);
    const selected = cands[0]?.text || hit.word;
    const entry = entryOf(selected);
    const needles = new Set(
      [entry?.lemma, entry?.display, selected]
        .filter((s): s is string => Boolean(s && String(s).trim()))
        .map((s) => String(s).trim().toLowerCase()),
    );
    const saved = (snap.bookmarks ?? []).some((item) =>
      needles.has(item.text.trim().toLowerCase()),
    );
    const spans = lineRef.current?.querySelectorAll("[data-i]");
    let box = {
      anchorX: origin.x,
      anchorY: origin.y,
      anchorW: 40,
      anchorH: 20,
    };
    if (spans) {
      const first = Array.from(spans).find(
        (node) => Number((node as HTMLElement).dataset.i) === hit.start,
      ) as HTMLElement | undefined;
      const last = Array.from(spans).find(
        (node) => Number((node as HTMLElement).dataset.i) === hit.end - 1,
      ) as HTMLElement | undefined;
      if (first) {
        const a = first.getBoundingClientRect();
        const b = (last ?? first).getBoundingClientRect();
        box = {
          anchorX: origin.x + a.left,
          anchorY: origin.y + a.top,
          anchorW: Math.max(1, b.right - a.left),
          anchorH: Math.max(1, Math.max(a.height, b.height)),
        };
      }
    }
    const card: GlossCardPayload = {
      open: true,
      lemma: entry?.lemma || selected.toLowerCase(),
      display: entry?.display || selected,
      ipa: entry?.ipa || "",
      senses: sensesOf(selected),
      candidates: cands,
      selected,
      seen: 0,
      saved: Boolean(saved),
      color: snap.settings.fontColor || defaultComboTheme,
      sentence: text,
      ...box,
    };
    void invoke("push_gloss", { card });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.currentTarget.blur();
      void invoke("set_capture", { locked: false });
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      setRejected(false);
      setMiss(null);
      window.clearTimeout(missTimer.current);
      const next = retreat(count, text);
      const spot = caret(Math.max(0, count - 1));
      setCount(next);
      playKeySound({ ok: true, key: "Backspace", pack: keyPack });
      if (effectOn) {
        const dropped = streakRef.current > 0;
        if (dropped) streakRef.current -= 1;
        const level = levelOf(streakRef.current);
        publish({
          x: originRef.current.x + spot.x,
          y: originRef.current.y + spot.y,
          ok: false,
          sparks: true,
          streak: streakRef.current,
          level,
          burst: dropped ? "-1" : "",
          burstKind: dropped ? "down" : "",
        });
        if (streakRef.current === 0) window.clearTimeout(idleTimer.current);
      }
      return;
    }
    if (event.key.length !== 1 || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    const cursor = skipIdle(count, text);
    if (cursor !== count) setCount(cursor);
    const expected = text[cursor];
    if (!expected) return;
    const spot = caret(cursor);
    const at = {
      x: originRef.current.x + spot.x,
      y: originRef.current.y + spot.y,
    };
    if (event.key.toLocaleLowerCase() !== expected.toLocaleLowerCase()) {
      setRejected(true);
      setMiss(event.key);
      window.clearTimeout(missTimer.current);
      missTimer.current = window.setTimeout(() => {
        setMiss(null);
        setRejected(false);
      }, 320);
      track(false, false, 0);
      shake(0);
      playKeySound({ ok: false, key: event.key, pack: keyPack });
      if (effectOn) {
        const lost = streakRef.current;
        streakRef.current = 0;
        window.clearTimeout(idleTimer.current);
        publish({
          x: at.x,
          y: at.y,
          ok: false,
          streak: 0,
          level: 0,
          burst: lost > 0 ? `-${lost}` : "",
          burstKind: lost > 0 ? "down" : "",
        });
      }
      return;
    }
    const nextCount = skipIdle(cursor + 1, text);
    const done = nextCount >= text.length;
    setMiss(null);
    window.clearTimeout(missTimer.current);
    playKeySound({ ok: true, key: event.key, pack: keyPack });
    if (effectOn) {
      if (Date.now() - streakAt.current > STREAK_MS) streakRef.current = 0;
      const next = gainStreak(streakRef.current, maxRef.current, done);
      streakRef.current = next.streak;
      if (next.max !== maxRef.current) {
        maxRef.current = next.max;
        localStorage.setItem("bubtype.maxStreak", String(next.max));
      }
      streakAt.current = Date.now();
      window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => endStreak(), STREAK_MS);
      setFresh(cursor);
      window.clearTimeout(freshTimer.current);
      freshTimer.current = window.setTimeout(() => setFresh(null), 180);
      shake(next.level);
      publish({
        x: at.x,
        y: at.y,
        ok: true,
        streak: next.streak,
        level: next.level,
        burst: next.burst.text,
        burstKind: next.burst.kind,
      });
      track(true, done, next.streak);
    } else {
      track(true, done, streakRef.current);
    }
    setCount(nextCount);
    setRejected(false);
    if (done && settings.autoNext !== false) {
      void invoke("step_queue", { delta: 1 });
    }
  }

  function beginResize(
    event: React.PointerEvent<HTMLDivElement>,
    direction:
      | "North"
      | "South"
      | "East"
      | "West"
      | "NorthWest"
      | "NorthEast"
      | "SouthWest"
      | "SouthEast",
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (userResizeRef.current) return;

    const startPointerX = event.clientX;
    const startPointerY = event.clientY;
    const startFont = fontRef.current;
    const packed = measureContentSize();
    const startW = Math.max(1, packed.w);
    const startH = Math.max(1, packed.h);
    resizeStartRef.current = { w: startW, h: startH, font: startFont };

    userResizeRef.current = true;
    skipFitUntilRef.current = Date.now() + 60_000;
    void invoke("set_capture", { locked: true });

    let raf = 0;
    let pendingFont = startFont;
    let packedAtFont = startFont;
    let running = false;
    packedFontRef.current = startFont;

    void (async () => {
      const win = getCurrentWindow();
      const factor = await win.scaleFactor();
      const pos = await win.outerPosition();
      const x = pos.x / factor;
      const y = pos.y / factor;
      resizeAnchorRef.current = {
        fixRight: direction.includes("West"),
        fixBottom: direction.includes("North"),
        right: x + startW,
        bottom: y + startH,
      };

      const pump = () => {
        raf = 0;
        if (!userResizeRef.current || running) return;
        if (pendingFont === packedAtFont) return;
        running = true;
        const font = pendingFont;
        void packToContent(true, font).finally(() => {
          packedAtFont = font;
          packedFontRef.current = font;
          running = false;
          // Font changed again while packing — one more frame, then stop if stable.
          if (userResizeRef.current && pendingFont !== packedAtFont && !raf) {
            raf = window.requestAnimationFrame(pump);
          }
        });
      };

      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - startPointerX;
        const dy = ev.clientY - startPointerY;
        const scale = scaleFromPointerDelta(direction, startW, startH, dx, dy);
        const next = clampFont(startFont * scale);
        // Hold still (or micro-jitter that maps to same font) → do nothing.
        if (next === pendingFont) return;
        pendingFont = next;
        fontRef.current = next;
        setLiveFont(next);
        if (!raf && !running) raf = window.requestAnimationFrame(pump);
      };

      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        if (raf) window.cancelAnimationFrame(raf);
        void (async () => {
          try {
            await applyFontAndPack(pendingFont, true);
          } finally {
            resizeAnchorRef.current = null;
            packedFontRef.current = null;
            userResizeRef.current = false;
            setLiveFont(null);
            skipFitUntilRef.current = Date.now() + 200;
            if (document.activeElement !== rootRef.current) {
              void invoke("set_capture", { locked: false });
            }
          }
        })();
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    })();
  }

  function onTool(id: ToolbarId, event: React.PointerEvent) {
    event.stopPropagation();
    event.preventDefault();
    runTool(id);
  }

  async function copyCurrentText() {
    const value = text.trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      /* ignore — no permission / non-secure context */
    }
  }

  function runTool(id: ToolbarId | "hint" | "hide") {
    if (id === "panel") {
      void invoke("show_panel");
      return;
    }
    if (id === "combo") {
      void invoke("set_effect", {
        effect: effectOn ? "none" : "combo",
        power: settings.effectPower || 0.7,
      });
      return;
    }
    if (id === "lookup") {
      void invoke("set_word_lookup", { enabled: !wordLookup });
      return;
    }
    if (id === "prev") {
      void invoke("step_queue", { delta: -1 });
      return;
    }
    if (id === "next") {
      void invoke("step_queue", { delta: 1 });
      return;
    }
    if (id === "replay") {
      void invoke("repeat_speak");
      return;
    }
    if (id === "copy") {
      void copyCurrentText();
      return;
    }
    if (id === "rate") {
      void invoke("set_rate", { rate: nextRate(settings.rate || 1) });
      return;
    }
    if (id === "bookmark") {
      void invoke("bookmark_current");
      return;
    }
    if (id === "hint") {
      void invoke("set_show_hint", { show: !showHint });
      return;
    }
    if (id === "hide") {
      void invoke("toggle_overlay_cmd");
    }
  }

  async function onContextMenu(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const at = new LogicalPosition(event.clientX, event.clientY);
    const act = (id: ToolbarId | "hint" | "hide") => () => {
      void runTool(id);
    };
    const menu = await Menu.new({
      items: [
        await MenuItem.new({ id: "prev", text: t("tool.prev"), action: act("prev") }),
        await MenuItem.new({ id: "next", text: t("tool.next"), action: act("next") }),
        await MenuItem.new({ id: "replay", text: t("tool.replay"), action: act("replay") }),
        await MenuItem.new({ id: "copy", text: t("tool.copy"), action: act("copy") }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await CheckMenuItem.new({
          id: "hint",
          text: t("practice.hint"),
          checked: showHint,
          action: act("hint"),
        }),
        await CheckMenuItem.new({
          id: "lookup",
          text: wordLookup ? t("tool.lookupOn") : t("tool.lookupOff"),
          checked: wordLookup,
          action: act("lookup"),
        }),
        await CheckMenuItem.new({
          id: "combo",
          text: effectOn ? t("tool.comboOn") : t("tool.comboOff"),
          checked: effectOn,
          action: act("combo"),
        }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await MenuItem.new({
          id: "rate",
          text: t("tool.rate", { rate: formatRate(settings.rate || 1) }),
          action: act("rate"),
        }),
        await CheckMenuItem.new({
          id: "bookmark",
          text: bookmarked ? t("tool.bookmarkOn") : t("tool.bookmarkOff"),
          checked: bookmarked,
          action: act("bookmark"),
        }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await MenuItem.new({ id: "panel", text: t("tool.panel"), action: act("panel") }),
        await MenuItem.new({ id: "hide", text: t("ctx.hideOverlay"), action: act("hide") }),
      ],
    });
    await menu.popup(at);
  }

  function toolButton(id: ToolbarId) {
    if (id === "panel") {
      return (
        <button
          key={id}
          type="button"
          className="tool"
          title={t("tool.panel")}
          aria-label={t("tool.panel")}
          onPointerDown={(event) => onTool("panel", event)}
        >
          <FontAwesomeIcon icon={faTableColumns} />
        </button>
      );
    }
    if (id === "combo") {
      return (
        <button
          key={id}
          type="button"
          className={`tool${effectOn ? " on" : ""}`}
          title={effectOn ? t("tool.comboOn") : t("tool.comboOff")}
          aria-label={effectOn ? t("tool.comboOn") : t("tool.comboOff")}
          aria-pressed={effectOn}
          onPointerDown={(event) => onTool("combo", event)}
        >
          <FontAwesomeIcon icon={faBolt} />
        </button>
      );
    }
    if (id === "lookup") {
      return (
        <button
          key={id}
          type="button"
          className={`tool${wordLookup ? " on" : ""}`}
          title={wordLookup ? t("tool.lookupOn") : t("tool.lookupOff")}
          aria-label={wordLookup ? t("tool.lookupOn") : t("tool.lookupOff")}
          aria-pressed={wordLookup}
          onPointerDown={(event) => onTool("lookup", event)}
        >
          <FontAwesomeIcon icon={faMagnifyingGlass} />
        </button>
      );
    }
    if (id === "prev") {
      return (
        <button
          key={id}
          type="button"
          className="tool"
          title={t("tool.prev")}
          aria-label={t("tool.prev")}
          onPointerDown={(event) => onTool("prev", event)}
        >
          <FontAwesomeIcon icon={faChevronLeft} />
        </button>
      );
    }
    if (id === "next") {
      return (
        <button
          key={id}
          type="button"
          className="tool"
          title={t("tool.next")}
          aria-label={t("tool.next")}
          onPointerDown={(event) => onTool("next", event)}
        >
          <FontAwesomeIcon icon={faChevronRight} />
        </button>
      );
    }
    if (id === "replay") {
      return (
        <button
          key={id}
          type="button"
          className="tool"
          title={t("tool.replay")}
          aria-label={t("tool.replay")}
          onPointerDown={(event) => onTool("replay", event)}
        >
          <FontAwesomeIcon icon={faRotateRight} />
        </button>
      );
    }
    if (id === "copy") {
      return (
        <button
          key={id}
          type="button"
          className="tool"
          title={t("tool.copy")}
          aria-label={t("tool.copy")}
          onPointerDown={(event) => onTool("copy", event)}
        >
          <FontAwesomeIcon icon={faCopy} />
        </button>
      );
    }
    if (id === "rate") {
      const label = t("tool.rate", { rate: formatRate(settings.rate || 1) });
      return (
        <button
          key={id}
          type="button"
          className="tool tool-rate"
          title={label}
          aria-label={label}
          onPointerDown={(event) => onTool("rate", event)}
        >
          <span>{formatRate(settings.rate || 1)}</span>
        </button>
      );
    }
    return (
      <button
        key={id}
        type="button"
        className={`tool${bookmarked ? " on" : ""}`}
        title={bookmarked ? t("tool.bookmarkOn") : t("tool.bookmarkOff")}
        aria-label={bookmarked ? t("tool.bookmarkOn") : t("tool.bookmarkOff")}
        aria-pressed={bookmarked}
        onPointerDown={(event) => onTool("bookmark", event)}
      >
        <FontAwesomeIcon icon={faBookmark} />
      </button>
    );
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.dataset.resize) return;
    if (target.closest(".tools")) return;
    dragRef.current = false;
    const startX = event.clientX;
    const startY = event.clientY;
    const tapIndex =
      wordLookup && target.closest("[data-i]")
        ? Number((target.closest("[data-i]") as HTMLElement).dataset.i)
        : NaN;
    void invoke("set_capture", { locked: true });
    const move = (ev: PointerEvent) => {
      if (dragRef.current) return;
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 4) {
        dragRef.current = true;
        void getCurrentWindow().startDragging();
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!dragRef.current) {
        if (Number.isFinite(tapIndex)) {
          void invoke("set_capture", { locked: false });
          void openGloss(tapIndex);
        } else {
          rootRef.current?.focus();
        }
      } else {
        void invoke("set_capture", { locked: false });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      ref={rootRef}
      className={`overlay${hot ? " hot" : ""}${focused ? " focused" : ""}${rejected ? " rejected" : ""}`}
      style={
        {
          fontSize: font,
          color,
          fontFamily: family,
          ["--frame" as string]: /^#[0-9a-fA-F]{6}$/i.test(frameColor)
            ? frameColor
            : "#ff4d6d",
          ["--theme" as string]:
            skinInk?.accent ??
            (snap.settings.fontColor || defaultComboTheme),
        } as React.CSSProperties
      }
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => setHot(false)}
    >
      <div className="stage" ref={stageRef}>
        {toolbarItems.length > 0 ? (
          <div className="tools" onPointerDown={(event) => event.stopPropagation()}>
            {toolbarItems.map((id) => toolButton(id))}
          </div>
        ) : null}
        <div className="chrome">
          <div className="frame" aria-hidden />
          <div className="stack">
            <p ref={lineRef} className="line">
              {dictation ? (
                <span className="dictation-sizer" aria-hidden>
                  <span
                    className={captionOn ? "caption" : "ghost-line"}
                    style={
                      captionOn
                        ? { background: `rgba(0, 0, 0, ${captionOpacity})` }
                        : undefined
                    }
                  >
                    {text || "···"}
                  </span>
                </span>
              ) : null}
              <span
                className={captionChrome ? "caption" : barePlaceholder ? "ghost-line" : undefined}
                style={
                  captionChrome
                    ? { background: `rgba(0, 0, 0, ${captionOpacity})` }
                    : undefined
                }
              >
                {dictation ? (
                  <>
                    {count > 0 ? renderTyped(text.slice(0, count)) : null}
                    {miss ? <span className="bad miss-flash">{miss}</span> : null}
                    {renderCaret()}
                    {count === 0 && !focused && !miss ? (
                      <span className="ghost">···</span>
                    ) : null}
                  </>
                ) : (
                  <>
                    {renderPracticeLine()}
                    {focused && count >= text.length ? <span className="caret" aria-hidden /> : null}
                  </>
                )}
              </span>
            </p>
            {ipaText ? <p className="overlay-ipa">/{ipaText.replace(/^\/|\/$/g, "")}/</p> : null}
            {showHint && hintText ? <p className="overlay-hint">{hintText}</p> : null}
          </div>
          {(
            [
              ["n", "North"],
              ["s", "South"],
              ["e", "East"],
              ["w", "West"],
              ["nw", "NorthWest"],
              ["ne", "NorthEast"],
              ["sw", "SouthWest"],
              ["se", "SouthEast"],
            ] as const
          ).map(([place, direction]) => (
            <div
              key={place}
              className={`hit ${place}`}
              data-resize={place}
              onPointerDown={(event) => beginResize(event, direction)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
