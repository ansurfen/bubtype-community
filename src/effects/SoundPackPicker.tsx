import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faLock } from "@fortawesome/free-solid-svg-icons";
import { subscribeEntitlement } from "../edition";
import {
  KEY_SOUND_PACKS,
  isKeySoundAllowed,
  playKeySound,
  readKeySoundId,
  warmKeySounds,
  writeKeySoundId,
  type KeySoundId,
} from "./keySound";
import { warmComboSounds } from "./comboSound";
import "./sound-packs.css";

type TFn = (key: string, vars?: Record<string, string>) => string;

const LABEL_KEYS: Record<KeySoundId, string> = {
  basic: "effects.soundBasic",
  office: "effects.soundOffice",
  click: "effects.soundClick",
  clickPbt: "effects.soundClickPbt",
  black: "effects.soundBlack",
  blackPbt: "effects.soundBlackPbt",
  brown: "effects.soundBrown",
  brownPbt: "effects.soundBrownPbt",
  red: "effects.soundRed",
  redPbt: "effects.soundRedPbt",
  soft: "effects.soundSoft",
};

const SAMPLE = "Hi World";

/** Scripted pack demo: hits, one miss, then finish + Enter. */
const DEMO: Array<{ key: string; ok: boolean }> = [
  { key: "H", ok: true },
  { key: "i", ok: true },
  { key: " ", ok: true },
  { key: "W", ok: true },
  { key: "o", ok: true },
  { key: "x", ok: false },
  { key: "r", ok: true },
  { key: "l", ok: true },
  { key: "d", ok: true },
  { key: "Enter", ok: true },
];

function SoundPreview({
  pack,
  packLabel,
  playing,
  t,
}: {
  pack: KeySoundId;
  packLabel: string;
  playing: boolean;
  t: TFn;
}) {
  const [typed, setTyped] = useState(0);
  const [fresh, setFresh] = useState<number | null>(null);
  const [missAt, setMissAt] = useState<number | null>(null);
  const gen = useRef(0);

  useEffect(() => {
    gen.current += 1;
    const runId = gen.current;
    setTyped(0);
    setFresh(null);
    setMissAt(null);

    if (!playing) return;

    const timers: number[] = [];
    let step = 0;
    let caret = 0;

    const clearFresh = (index: number) => {
      timers.push(
        window.setTimeout(() => {
          if (runId !== gen.current) return;
          setFresh((cur) => (cur === index ? null : cur));
        }, 180),
      );
    };

    const clearMiss = () => {
      timers.push(
        window.setTimeout(() => {
          if (runId !== gen.current) return;
          setMissAt(null);
        }, 280),
      );
    };

    const tick = () => {
      if (runId !== gen.current) return;
      if (step >= DEMO.length) {
        timers.push(
          window.setTimeout(() => {
            if (runId !== gen.current) return;
            setTyped(0);
            setFresh(null);
            setMissAt(null);
            step = 0;
            caret = 0;
            timers.push(window.setTimeout(tick, 420));
          }, 1100),
        );
        return;
      }

      const item = DEMO[step]!;
      step += 1;
      playKeySound({ ok: item.ok, key: item.key, pack, preview: true });

      if (!item.ok) {
        setMissAt(caret);
        clearMiss();
        timers.push(window.setTimeout(tick, 320));
        return;
      }

      if (item.key === "Enter") {
        timers.push(window.setTimeout(tick, 380));
        return;
      }

      const index = caret;
      caret += 1;
      setTyped(caret);
      setFresh(index);
      clearFresh(index);
      timers.push(window.setTimeout(tick, item.key === " " ? 220 : 140));
    };

    timers.push(window.setTimeout(tick, 280));
    return () => {
      gen.current += 1;
      for (const id of timers) window.clearTimeout(id);
    };
  }, [pack, playing]);

  return (
    <section className="sound-preview" aria-label={t("skins.preview")}>
      <div className="sound-preview-head">
        <h3>{t("skins.preview")}</h3>
        <span className="sound-preview-pack">{packLabel}</span>
      </div>
      <div className={`sound-preview-stage${playing ? " live" : ""}`}>
        <p className="sound-preview-line">
          {Array.from(SAMPLE).map((char, i) => {
            const done = i < typed;
            const just = fresh === i;
            const wrong = missAt === i;
            return (
              <span
                key={`${char}-${i}`}
                className={[
                  "sound-preview-ch",
                  done ? "typed" : "",
                  just ? "fresh" : "",
                  wrong ? "miss" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {char === " " ? "\u00a0" : char}
              </span>
            );
          })}
        </p>
      </div>
    </section>
  );
}

export function SoundPackPicker({ t }: { t: TFn }) {
  const [active, setActive] = useState<KeySoundId>(readKeySoundId);
  const [preview, setPreview] = useState<KeySoundId | null>(null);
  const [, bump] = useState(0);

  useEffect(() => {
    warmKeySounds();
    warmComboSounds();
    const sync = () => {
      setActive(readKeySoundId());
      bump((n) => n + 1);
    };
    window.addEventListener("bubtype-key-sound", sync);
    window.addEventListener("storage", sync);
    const unsub = subscribeEntitlement(sync);
    return () => {
      window.removeEventListener("bubtype-key-sound", sync);
      window.removeEventListener("storage", sync);
      unsub();
    };
  }, []);

  const listening = preview ?? active;
  const listeningLabel = t(LABEL_KEYS[listening]);

  function select(id: KeySoundId) {
    setPreview(id);
    if (!isKeySoundAllowed(id)) return;
    writeKeySoundId(id);
    setActive(id);
  }

  return (
    <section className="sound-packs" aria-label={t("effects.soundTitle")}>
      <div className="sound-packs-head">
        <h3>{t("effects.soundTitle")}</h3>
      </div>
      <SoundPreview
        pack={listening}
        packLabel={listeningLabel}
        playing={preview !== null}
        t={t}
      />
      <div
        className="sound-packs-grid"
        onMouseLeave={() => setPreview(null)}
      >
        {KEY_SOUND_PACKS.map((pack) => {
          const allowed = isKeySoundAllowed(pack.id);
          const on = active === pack.id;
          const watching = preview === pack.id;
          return (
            <button
              key={pack.id}
              type="button"
              className={`sound-packs-card${on ? " active" : ""}${watching ? " previewing" : ""}${!allowed ? " locked" : ""}`}
              onMouseEnter={() => setPreview(pack.id)}
              onFocus={() => setPreview(pack.id)}
              onClick={() => select(pack.id)}
            >
              <span className="sound-packs-name">{t(LABEL_KEYS[pack.id])}</span>
              {pack.premium ? (
                <span className="sound-packs-tag">{t("skins.premium")}</span>
              ) : (
                <span className="sound-packs-tag muted">{t("skins.free")}</span>
              )}
              {!allowed ? (
                <span className="sound-packs-check" aria-hidden>
                  <FontAwesomeIcon icon={faLock} />
                </span>
              ) : on ? (
                <span className="sound-packs-check" aria-hidden>
                  <FontAwesomeIcon icon={faCheck} />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
