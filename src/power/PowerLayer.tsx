import { useEffect, useRef, useState, type CSSProperties } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import ComboMeter, { useComboFx } from "../effects/ComboMeter";
import HitParticles from "../effects/HitParticles";
import {
  PARTICLE_SKIN_EVENT,
  PARTICLE_SKIN_KEY,
  readParticleSkin,
} from "../effects/particleSkin";
import { defaultComboTheme, type BurstKind } from "../effects/streak";
import { isParticleSkinId, subscribeEntitlement } from "../edition";
import "../edition/boot";
import "./power.css";

type PowerHit = {
  x: number;
  y: number;
  ok: boolean;
  streak: number;
  maxStreak: number;
  level: number;
  burst: string;
  burstKind: BurstKind | "";
  color: string;
  power: number;
  active: boolean;
  anchorX: number;
  anchorY: number;
  anchorW: number;
  anchorH: number;
  sparks: boolean;
  place: string;
  scale: number;
  blur: boolean;
  theme: string;
  fontSize: number;
  skin?: string;
};

export default function PowerLayer() {
  const origin = useRef({ x: 0, y: 0 });
  const sparkSeq = useRef(0);
  const [streak, setStreak] = useState(0);
  const [maxStreak, setMaxStreak] = useState(0);
  const [anchor, setAnchor] = useState({ x: 0, y: 8, placed: false });
  const [theme, setTheme] = useState<string>(defaultComboTheme);
  const [place, setPlace] = useState("follow");
  const [scale, setScale] = useState(1);
  const [particleSkin, setParticleSkin] = useState(readParticleSkin);
  const [sparkAt, setSparkAt] = useState<{
    id: number;
    x: number;
    y: number;
    ok: boolean;
  } | null>(null);
  const { bump, lines, barRef, pulse, reset } = useComboFx();

  useEffect(() => {
    const syncSkin = () => setParticleSkin(readParticleSkin());
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === PARTICLE_SKIN_KEY ||
        event.key === "bubtype.licenseKey"
      ) {
        syncSkin();
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(PARTICLE_SKIN_EVENT, syncSkin);
    window.addEventListener("focus", syncSkin);
    const unsub = subscribeEntitlement(syncSkin);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(PARTICLE_SKIN_EVENT, syncSkin);
      window.removeEventListener("focus", syncSkin);
      unsub();
    };
  }, []);

  useEffect(() => {
    const win = getCurrentWindow();
    let alive = true;

    const fitOrigin = async () => {
      try {
        const factor = await win.scaleFactor();
        const pos = await win.outerPosition();
        if (!alive) return;
        origin.current = { x: pos.x / factor, y: pos.y / factor };
      } catch {
        /* keep */
      }
    };

    void fitOrigin();
    const timers: Array<() => void> = [];
    void win.onResized(() => void fitOrigin()).then((fn) => timers.push(fn));
    void win.onMoved(() => void fitOrigin()).then((fn) => timers.push(fn));

    const unlisten = listen<PowerHit>("power-hit", (event) => {
      const hit = event.payload;
      if (!hit.active) {
        setStreak(0);
        reset();
        return;
      }
      setStreak(hit.streak);
      setMaxStreak(hit.maxStreak);
      setTheme(hit.theme || defaultComboTheme);
      setPlace(hit.place || "follow");
      const fontUnit = Math.max(0.55, Math.min(2.6, (hit.fontSize || 28) / 28));
      setScale((hit.scale || 1) * fontUnit);
      pulse({
        streak: hit.streak,
        burst: hit.burst,
        burstKind: hit.burstKind,
      });
      if (hit.anchorW > 0 && (hit.place || "follow") === "follow") {
        void (async () => {
          await fitOrigin();
          const left = hit.anchorX - origin.current.x + hit.anchorW + 4;
          const top = hit.anchorY - origin.current.y - 18;
          setAnchor({
            x: Math.max(8, left),
            y: Math.max(8, top),
            placed: true,
          });
        })();
      } else if (hit.anchorW > 0) {
        setAnchor({ x: 0, y: 8, placed: false });
      }
      if (!hit.ok && !hit.sparks) return;
      if (hit.skin && isParticleSkinId(hit.skin)) {
        setParticleSkin(readParticleSkin(hit.skin));
      }
      sparkSeq.current += 1;
      setSparkAt({
        id: sparkSeq.current,
        x: hit.x - origin.current.x,
        y: hit.y - origin.current.y,
        ok: hit.ok,
      });
    });

    return () => {
      alive = false;
      timers.forEach((fn) => fn());
      void unlisten.then((fn) => fn());
    };
  }, [pulse, reset]);

  const color = theme;
  const alignLeft = place === "tl" || place === "bl" || place === "follow";
  const boxStyle = comboFrame(place, scale, anchor);

  return (
    <div className="power">
      <HitParticles skin={particleSkin} burst={sparkAt} accent={theme} />
      <div
        className={`power-combo-slot${alignLeft ? " align-left" : ""}`}
        style={boxStyle}
      >
        <ComboMeter
          streak={streak}
          maxStreak={maxStreak}
          color={color}
          bump={bump}
          lines={lines}
          barRef={barRef}
          className={alignLeft ? "align-left" : undefined}
        />
      </div>
    </div>
  );
}

function comboFrame(
  place: string,
  scale: number,
  anchor: { x: number; y: number; placed: boolean },
): CSSProperties {
  const transform = `scale(${scale})`;
  if (place === "tl") {
    return { top: 16, left: 16, right: "auto", bottom: "auto", transform, transformOrigin: "top left" };
  }
  if (place === "tr") {
    return { top: 16, right: 16, left: "auto", bottom: "auto", transform, transformOrigin: "top right" };
  }
  if (place === "bl") {
    return { bottom: 16, left: 16, top: "auto", right: "auto", transform, transformOrigin: "bottom left" };
  }
  if (place === "br") {
    return { bottom: 16, right: 16, top: "auto", left: "auto", transform, transformOrigin: "bottom right" };
  }
  return {
    left: anchor.placed ? anchor.x : 16,
    top: anchor.placed ? anchor.y : 8,
    right: "auto",
    bottom: "auto",
    transform,
    transformOrigin: "top left",
  };
}
