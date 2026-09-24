import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { ensureGlossary, type GlossCardPayload } from "../glossary";
import GlossCard, { buildCardFromSelection } from "./GlossCard";
import "./gloss.css";
import "./gloss-layer.css";

export default function GlossLayer() {
  const [card, setCard] = useState<GlossCardPayload | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void ensureGlossary();
    const unlisten = listen<GlossCardPayload>("gloss-card", (event) => {
      const payload = event.payload;
      if (!payload?.open) {
        setCard(null);
        return;
      }
      void ensureGlossary().then(() => {
        setCard({
          ...payload,
          anchorX: 0,
          anchorY: 0,
          anchorW: 0,
          anchorH: 0,
        });
      });
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useLayoutEffect(() => {
    if (!card?.open) return;
    const node = rootRef.current?.querySelector(".gloss-card") as HTMLElement | null;
    if (!node) return;
    const width = Math.ceil(Math.max(280, node.offsetWidth));
    const height = Math.ceil(node.offsetHeight);
    void getCurrentWindow().setSize(new LogicalSize(width, height));
  }, [card]);

  if (!card?.open) {
    return <div className="gloss-layer" />;
  }

  return (
    <div ref={rootRef} className="gloss-layer">
      <GlossCard
        card={card}
        onClose={() => {
          setCard(null);
          void invoke("push_gloss", { card: { open: false } });
        }}
        onSelect={(text) => setCard((cur) => (cur ? buildCardFromSelection(cur, text) : cur))}
      />
    </div>
  );
}
