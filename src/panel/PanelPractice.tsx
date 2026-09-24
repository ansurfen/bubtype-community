import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBolt,
  faBookmark,
  faChevronDown,
  faChevronLeft,
  faChevronRight,
  faLanguage,
  faRotateRight,
  faVolumeHigh,
} from "@fortawesome/free-solid-svg-icons";
import { invoke } from "@tauri-apps/api/core";
import { blankMask } from "../blank";
import ContextMenu, { type ContextMenuItem } from "../chrome/ContextMenu";
import { ink } from "../color";
import ComboMeter, { useComboFx } from "../effects/ComboMeter";
import HitParticles, {
  SKIN_INK,
  type ParticleSkinId,
} from "../effects/HitParticles";
import { playKeySound, warmKeySounds, readKeySoundId } from "../effects/keySound";
import { playComboSound, warmComboSounds } from "../effects/comboSound";
import {
  PARTICLE_SKIN_EVENT,
  PARTICLE_SKIN_KEY,
  readParticleSkin,
} from "../effects/particleSkin";
import { showSkinsNav, subscribeEntitlement } from "../edition";
import { gainStreak, STREAK_MS, defaultComboTheme } from "../effects/streak";
import type { BurstKind } from "../effects/streak";
import { BUILTIN_FONT, fontStack } from "../font";
import { ensureGlossary, entryOf, oneLineGloss, clipOneLine, type Entry } from "../glossary";
import { resolvePracticeGloss, isWordLikeText } from "../wordbook/glossTrack";
import type { Snapshot } from "../types";
import { todayKey } from "../types";
import type { TFn } from "../i18n";
import { formatRate, nextRate } from "../toolbar";

/** Idle lock after no interaction — blur content + “Press any key”. */
const IDLE_MS = 20_000;

type Props = {
  snap: Snapshot;
  t: TFn;
  onExit: () => void;
  onOpenPacks: () => void;
  onOpenItems: () => void;
};

function isIdle(char: string | undefined) {
  if (!char) return false;
  return /\s/u.test(char) || /[\p{P}\p{S}]/u.test(char);
}

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

function firstLemma(text: string) {
  const match = text.match(/[A-Za-z']+/);
  return match?.[0] ?? text.trim();
}

export default function PanelPractice({ snap, t, onExit, onOpenPacks, onOpenItems }: Props) {
  const item = snap.items[snap.index];
  const text = item?.text ?? "";
  const hint = item?.hint ?? "";
  const color = ink(snap.settings.fontColor || defaultComboTheme, 1);
  const pending = ink(snap.settings.fontColor || defaultComboTheme, 0.38);
  const family = fontStack(snap.settings.fontFamily || BUILTIN_FONT);
  const mode = snap.settings.practiceMode || "type";
  const blankMode = mode === "blank";
  const dictation = mode === "dictation";
  const blanks = blankMode ? blankMask(text, snap.index * 17 + text.length) : [];
  const effectOn = (snap.settings.effect || "combo") === "combo";
  const power = snap.settings.effectPower || 0.7;
  const settings = snap.settings;

  const [locked, setLocked] = useState(false);
  const [count, setCount] = useState(() => skipIdle(0, text));
  const [rejected, setRejected] = useState(false);
  const [miss, setMiss] = useState<string | null>(null);
  const [fresh, setFresh] = useState<number | null>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [streak, setStreak] = useState(0);
  const [maxStreak, setMaxStreak] = useState(
    () => Number(localStorage.getItem("bubtype.maxStreak") || "0"),
  );
  const [sparkAt, setSparkAt] = useState<{
    id: number;
    x: number;
    y: number;
    ok: boolean;
  } | null>(null);
  const [particleSkin, setParticleSkin] = useState<ParticleSkinId>(() =>
    readParticleSkin(snap.settings.particleSkin),
  );
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    warmKeySounds();
    warmComboSounds();
    const sync = () => setParticleSkin(readParticleSkin(snap.settings.particleSkin));
    sync();
    const onStorage = (event: StorageEvent) => {
      if (event.key === PARTICLE_SKIN_KEY || event.key === "bubtype.licenseKey") sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(PARTICLE_SKIN_EVENT, sync);
    window.addEventListener("focus", sync);
    const unsub = subscribeEntitlement(sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(PARTICLE_SKIN_EVENT, sync);
      window.removeEventListener("focus", sync);
      unsub();
    };
  }, [snap.settings.particleSkin]);

  const skinInk = showSkinsNav ? SKIN_INK[particleSkin] ?? null : null;
  const accentSolid = skinInk?.accent ? ink(skinInk.accent, 1) : color;
  const pendingColor = skinInk?.pending ?? pending;
  const comboColor = skinInk ? ink(skinInk.accent, 1) : color;
  const keyPack = readKeySoundId(snap.settings.keySound);
  const sparkSeq = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLParagraphElement>(null);
  const missTimer = useRef(0);
  const idleTimer = useRef(0);
  const streakIdle = useRef(0);
  const freshTimer = useRef(0);
  const shookAt = useRef(0);
  const indexRef = useRef(snap.index);
  const streakRef = useRef(0);
  const maxRef = useRef(Number(localStorage.getItem("bubtype.maxStreak") || "0"));
  const streakAt = useRef(0);
  const { bump, lines, barRef, pulse, reset: resetFx } = useComboFx();

  function bumpIdle() {
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setLocked(true), IDLE_MS);
  }

  function wake() {
    setLocked(false);
    bumpIdle();
    rootRef.current?.focus();
  }

  function caretClient(index: number) {
    const line = lineRef.current;
    if (!line) return { x: 16, y: 16 };
    const span = line.querySelectorAll("[data-i]")[index] as HTMLElement | undefined;
    const box = (span ?? line).getBoundingClientRect();
    return {
      x: span ? box.left + box.width / 2 : box.right - 4,
      y: box.top + box.height / 2,
    };
  }

  function popSpark(client: { x: number; y: number }, ok: boolean) {
    const scene = sceneRef.current?.getBoundingClientRect();
    if (!scene) return;
    sparkSeq.current += 1;
    setSparkAt({
      id: sparkSeq.current,
      x: client.x - scene.left,
      y: client.y - scene.top,
      ok,
    });
  }

  function shake(level: number) {
    const line = lineRef.current;
    if (!line) return;
    const now = performance.now();
    if (now - shookAt.current < 100) return;
    shookAt.current = now;
    const unit = Math.max(0.55, 1);
    const min = power * unit;
    const max = (3 + level) * power * unit;
    const span = Math.max(min, max);
    line.style.transform = `translate(${(Math.random() > 0.5 ? 1 : -1) * span}px, ${(Math.random() > 0.5 ? 1 : -1) * (min + Math.random() * (span - min))}px)`;
    window.setTimeout(() => {
      if (lineRef.current === line) line.style.transform = "";
    }, 75);
  }

  function endStreak() {
    streakRef.current = 0;
    setStreak(0);
    resetFx();
  }

  useEffect(() => {
    return () => {
      window.clearTimeout(idleTimer.current);
      window.clearTimeout(missTimer.current);
      window.clearTimeout(streakIdle.current);
      window.clearTimeout(freshTimer.current);
    };
  }, []);

  useEffect(() => {
    if (indexRef.current !== snap.index) {
      indexRef.current = snap.index;
      setCount(skipIdle(0, text));
      setRejected(false);
      setMiss(null);
      setFresh(null);
    }
  }, [snap.index, text]);

  useEffect(() => {
    let cancel = false;
    if (!isWordLikeText(text)) {
      setEntry(null);
      return;
    }
    const lemma = firstLemma(text) || text.trim();
    if (!lemma) {
      setEntry(null);
      return;
    }
    void (async () => {
      await ensureGlossary();
      if (!cancel) setEntry(entryOf(lemma) ?? entryOf(text.trim()));
    })();
    return () => {
      cancel = true;
    };
  }, [text]);

  useEffect(() => {
    rootRef.current?.focus();
    bumpIdle();
  }, []);

  useEffect(() => {
    if (!locked) rootRef.current?.focus();
  }, [locked, snap.index]);

  function track(ok: boolean, done: boolean, nextStreak: number) {
    void invoke("track_practice", {
      ok,
      done,
      text,
      hint: hint || null,
      streak: nextStreak,
      day: todayKey(),
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onExit();
      return;
    }

    if (locked) {
      event.preventDefault();
      wake();
      return;
    }

    bumpIdle();
    if (!text) return;

    if (event.key === "Backspace") {
      event.preventDefault();
      setRejected(false);
      setMiss(null);
      window.clearTimeout(missTimer.current);
      const next = retreat(count, text);
      const spot = caretClient(Math.max(0, count - 1));
      setCount(next);
      playKeySound({ ok: true, key: "Backspace", pack: keyPack });
      if (effectOn) {
        const dropped = streakRef.current > 0;
        if (dropped) streakRef.current -= 1;
        setStreak(streakRef.current);
        pulse({
          streak: streakRef.current,
          burst: dropped ? "-1" : "",
          burstKind: dropped ? "down" : "",
        });
        if (dropped) playComboSound("down");
        if (dropped) popSpark(spot, false);
        if (streakRef.current === 0) window.clearTimeout(streakIdle.current);
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
    const spot = caretClient(cursor);

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
        setStreak(0);
        window.clearTimeout(streakIdle.current);
        pulse({
          streak: 0,
          burst: lost > 0 ? `-${lost}` : "",
          burstKind: lost > 0 ? "down" : "",
        });
        if (lost > 0) playComboSound("down");
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
      setStreak(next.streak);
      if (next.max !== maxRef.current) {
        maxRef.current = next.max;
        setMaxStreak(next.max);
        localStorage.setItem("bubtype.maxStreak", String(next.max));
      }
      streakAt.current = Date.now();
      window.clearTimeout(streakIdle.current);
      streakIdle.current = window.setTimeout(() => endStreak(), STREAK_MS);
      setFresh(cursor);
      window.clearTimeout(freshTimer.current);
      freshTimer.current = window.setTimeout(() => setFresh(null), 180);
      shake(next.level);
      pulse({
        streak: next.streak,
        burst: next.burst.text,
        burstKind: next.burst.kind,
      });
      playComboSound(next.burst.kind as BurstKind);
      popSpark(spot, true);
      track(true, done, next.streak);
    } else {
      track(true, done, streakRef.current);
    }
    setCount(nextCount);
    setRejected(false);
    if (done && snap.settings.autoNext !== false) {
      void invoke("step_queue", { delta: 1 });
    }
  }

  const progressLabel =
    snap.items.length === 0 ? "0 / 0" : `${snap.index + 1} / ${snap.items.length}`;
  const itemFrac = text.length === 0 ? 0 : Math.min(1, count / text.length);
  const barPct =
    snap.items.length === 0
      ? 0
      : ((snap.index + itemFrac) / snap.items.length) * 100;

  const wordLike = isWordLikeText(text);
  const gloss = clipOneLine(
    resolvePracticeGloss({
      wantGloss: snap.settings.glossLang || "zh",
      packId: snap.wordbookId,
      packGlossLang: snap.practiceGlossLang,
      hint,
      fromGlossary: wordLike ? oneLineGloss(entry, 36) : "",
    }),
    36,
  );
  const ipa = wordLike ? entry?.ipa?.trim() || "" : "";
  const showHint = snap.settings.showHint === true;
  const wordLookup = snap.settings.wordLookup === true;
  const bookmarked = (snap.bookmarks ?? []).some((entry) => entry.text === text);

  const ctxItems: ContextMenuItem[] = [
    { type: "item", id: "replay", label: t("ctx.replay") },
    { type: "sep" },
    { type: "item", id: "hint", label: t("practice.hint"), checked: showHint },
    {
      type: "item",
      id: "lookup",
      label: wordLookup ? t("tool.lookupOn") : t("tool.lookupOff"),
      checked: wordLookup,
    },
    {
      type: "item",
      id: "combo",
      label: effectOn ? t("tool.comboOn") : t("tool.comboOff"),
      checked: effectOn,
    },
    { type: "sep" },
    {
      type: "item",
      id: "rate",
      label: t("tool.rate", { rate: formatRate(settings.rate || 1) }),
    },
    {
      type: "item",
      id: "bookmark",
      label: bookmarked ? t("tool.bookmarkOn") : t("tool.bookmarkOff"),
      checked: bookmarked,
    },
  ];

  return (
    <div
      ref={rootRef}
      className={`panel-practice${locked ? " locked" : ""}${rejected ? " rejected" : ""}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setCtxMenu({ x: event.clientX, y: event.clientY });
      }}
      onMouseDown={() => {
        if (ctxMenu) setCtxMenu(null);
        if (locked) {
          wake();
          return;
        }
        bumpIdle();
        rootRef.current?.focus();
      }}
      onPointerMove={() => {
        if (!locked) bumpIdle();
      }}
    >
      <header className="panel-practice-nav">
        <div className="panel-practice-nav-left">
          <button
            type="button"
            className="panel-practice-back"
            aria-label={t("practice.liveBack")}
            title={t("practice.liveBack")}
            onClick={(event) => {
              event.stopPropagation();
              onExit();
            }}
          >
            <FontAwesomeIcon icon={faChevronLeft} />
          </button>
          <button
            type="button"
            className="panel-practice-pack"
            aria-haspopup="dialog"
            aria-label={t("practice.catalog")}
            title={t("practice.catalog")}
            onClick={(event) => {
              event.stopPropagation();
              bumpIdle();
              onOpenPacks();
            }}
          >
            <span className="panel-practice-pack-title">
              {(() => {
                const title = snap.title?.trim() || "";
                if (!title || title === "还没打开素材包") return t("practice.pickPack");
                return title;
              })()}
            </span>
            <FontAwesomeIcon icon={faChevronDown} className="panel-practice-pack-chevron" />
          </button>
        </div>
        <div className="panel-practice-nav-center">
          <div className="panel-practice-xy">
            <button
              type="button"
              className="panel-practice-xy-nav"
              title={t("tool.prev")}
              aria-label={t("tool.prev")}
              onClick={(event) => {
                event.stopPropagation();
                bumpIdle();
                void invoke("step_queue", { delta: -1 });
              }}
            >
              <FontAwesomeIcon icon={faChevronLeft} />
            </button>
            <button
              type="button"
              className="panel-practice-meta"
              aria-haspopup="dialog"
              aria-label={t("practice.items")}
              title={t("practice.items")}
              onClick={(event) => {
                event.stopPropagation();
                bumpIdle();
                onOpenItems();
              }}
            >
              {progressLabel}
            </button>
            <button
              type="button"
              className="panel-practice-xy-nav"
              title={t("tool.next")}
              aria-label={t("tool.next")}
              onClick={(event) => {
                event.stopPropagation();
                bumpIdle();
                void invoke("step_queue", { delta: 1 });
              }}
            >
              <FontAwesomeIcon icon={faChevronRight} />
            </button>
          </div>
        </div>
        <div className="panel-practice-nav-right">
          <div className="panel-practice-tools" role="toolbar" aria-label={t("practice.liveTitle")}>
            <button
              type="button"
              className="panel-practice-tool"
              title={t("tool.replay")}
              aria-label={t("tool.replay")}
              onClick={(event) => {
                event.stopPropagation();
                bumpIdle();
                void invoke("repeat_speak");
              }}
            >
              <FontAwesomeIcon icon={faRotateRight} />
            </button>
            <button
              type="button"
              className="panel-practice-tool panel-practice-rate"
              title={t("tool.rate", { rate: formatRate(settings.rate || 1) })}
              aria-label={t("tool.rate", { rate: formatRate(settings.rate || 1) })}
              onClick={(event) => {
                event.stopPropagation();
                bumpIdle();
                void invoke("set_rate", { rate: nextRate(settings.rate || 1) });
              }}
            >
              {formatRate(settings.rate || 1)}
            </button>
            <button
              type="button"
              className={`panel-practice-tool${showHint ? " on" : ""}`}
              title={t("practice.hint")}
              aria-label={t("practice.hint")}
              aria-pressed={showHint}
              onClick={(event) => {
                event.stopPropagation();
                bumpIdle();
                void invoke("set_show_hint", { show: !showHint });
              }}
            >
              <FontAwesomeIcon icon={faLanguage} />
            </button>
            <button
              type="button"
              className={`panel-practice-tool${bookmarked ? " on" : ""}`}
              title={bookmarked ? t("tool.bookmarkOn") : t("tool.bookmarkOff")}
              aria-label={bookmarked ? t("tool.bookmarkOn") : t("tool.bookmarkOff")}
              aria-pressed={bookmarked}
              onClick={(event) => {
                event.stopPropagation();
                bumpIdle();
                void invoke("bookmark_current");
              }}
            >
              <FontAwesomeIcon icon={faBookmark} />
            </button>
            <button
              type="button"
              className={`panel-practice-tool${effectOn ? " on" : ""}`}
              title={effectOn ? t("tool.comboOn") : t("tool.comboOff")}
              aria-label={effectOn ? t("tool.comboOn") : t("tool.comboOff")}
              aria-pressed={effectOn}
              onClick={(event) => {
                event.stopPropagation();
                bumpIdle();
                if (effectOn) {
                  endStreak();
                }
                void invoke("set_effect", {
                  effect: effectOn ? "none" : "combo",
                  power: settings.effectPower || 0.7,
                });
              }}
            >
              <FontAwesomeIcon icon={faBolt} />
            </button>
          </div>
        </div>
      </header>

      <div className="panel-practice-scene" ref={sceneRef}>
        {effectOn ? (
          <>
            <HitParticles
              skin={particleSkin}
              burst={sparkAt}
              accent={snap.settings.fontColor || defaultComboTheme}
            />
            <div className="panel-practice-combo-slot">
              <ComboMeter
                streak={streak}
                maxStreak={maxStreak}
                color={comboColor}
                bump={bump}
                lines={lines}
                barRef={barRef}
                scale={0.85}
              />
            </div>
          </>
        ) : null}

        <div className="panel-practice-card">
          <div className="panel-practice-word-row">
            <p
              ref={lineRef}
              className="panel-practice-line"
              style={
                {
                  fontFamily: family,
                  ["--theme" as string]:
                    skinInk?.accent ?? (snap.settings.fontColor || defaultComboTheme),
                } as CSSProperties
              }
            >
              {!text ? (
                <span className="panel-practice-empty">{t("practice.empty")}</span>
              ) : dictation ? (
                <>
                  {[...text.slice(0, count)].map((char, index) => {
                    const paint = !!skinInk && canTakeInk(char);
                    return (
                      <span
                        key={`${snap.index}-d-${index}`}
                        data-i={index}
                        style={paint ? undefined : { color: accentSolid }}
                        className={[
                          "panel-practice-ch",
                          paint ? skinInk?.typedClass : "",
                          effectOn && fresh === index ? "fresh" : "",
                        ]
                          .filter(Boolean)
                          .join(" ") || undefined}
                      >
                        {char === " " ? "\u00a0" : char}
                      </span>
                    );
                  })}
                  {miss ? <span className="bad miss-flash">{miss}</span> : null}
                  <span className="panel-practice-end-caret" aria-hidden>
                    <span className="panel-practice-caret" />
                  </span>
                </>
              ) : (
                <>
                  {[...text].map((char, index) => {
                    const hiddenBlank = blankMode && blanks[index] && index >= count;
                    const typed = index < count;
                    const atCaret = index === count && !miss;
                    const paint = typed && !!skinInk && canTakeInk(char);
                    return (
                      <span
                        key={`${snap.index}-${index}`}
                        data-i={index}
                        className={[
                          "panel-practice-ch",
                          atCaret ? "caret-here" : "",
                          paint ? skinInk?.typedClass : "",
                          rejected && index === count ? "bad" : "",
                          effectOn && fresh === index ? "fresh" : "",
                        ]
                          .filter(Boolean)
                          .join(" ") || undefined}
                        style={{
                          color: paint ? undefined : typed ? accentSolid : pendingColor,
                          opacity: hiddenBlank ? 0 : 1,
                        }}
                      >
                        {atCaret ? <span className="panel-practice-caret" aria-hidden /> : null}
                        {hiddenBlank ? "·" : char === " " ? "\u00a0" : char}
                      </span>
                    );
                  })}
                  {count >= text.length ? (
                    <span className="panel-practice-end-caret" aria-hidden>
                      <span className="panel-practice-caret" />
                    </span>
                  ) : null}
                </>
              )}
            </p>
            {text ? (
              <button
                type="button"
                className="panel-practice-speak"
                aria-label={t("quick.repeat")}
                title={t("quick.repeat")}
                onClick={(event) => {
                  event.stopPropagation();
                  bumpIdle();
                  void invoke("repeat_speak");
                }}
              >
                <FontAwesomeIcon icon={faVolumeHigh} />
              </button>
            ) : null}
          </div>

          {ipa && snap.settings.showIpa !== false ? (
            <p className="panel-practice-ipa">/{ipa.replace(/^\/|\/$/g, "")}/</p>
          ) : null}
          {gloss ? (
            <p
              className="panel-practice-gloss"
              style={{ visibility: showHint ? "visible" : "hidden" }}
              aria-hidden={!showHint}
            >
              {gloss}
            </p>
          ) : null}
        </div>

        <div className="panel-practice-bar" aria-hidden>
          <span className="panel-practice-bar-fill" style={{ width: `${Math.max(4, barPct)}%` }} />
        </div>
      </div>

      {locked ? (
        <div className="panel-practice-idle" role="dialog" aria-live="polite">
          <div className="panel-practice-frost" aria-hidden />
          <p className="panel-practice-continue">{t("practice.pressAny")}</p>
        </div>
      ) : null}

      {ctxMenu ? (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxItems}
          onClose={() => setCtxMenu(null)}
          onPick={(id) => {
            if (id === "replay") void invoke("repeat_speak");
            else if (id === "hint") void invoke("set_show_hint", { show: !showHint });
            else if (id === "lookup")
              void invoke("set_word_lookup", { enabled: !wordLookup });
            else if (id === "combo")
              void invoke("set_effect", {
                effect: effectOn ? "none" : "combo",
                power: settings.effectPower || 0.7,
              });
            else if (id === "rate")
              void invoke("set_rate", { rate: nextRate(settings.rate || 1) });
            else if (id === "bookmark") void invoke("bookmark_current");
          }}
        />
      ) : null}
    </div>
  );
}
