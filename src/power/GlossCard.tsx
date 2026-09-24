import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBookmark, faVolumeHigh, faXmark } from "@fortawesome/free-solid-svg-icons";
import { invoke } from "@tauri-apps/api/core";
import { formatPos, entryOf, sensesOf, type GlossCardPayload, type GlossCandidate } from "../glossary";
import "./gloss.css";

type Props = {
  card: GlossCardPayload;
  onSelect: (text: string) => void;
  onClose: () => void;
};

export default function GlossCard({ card, onSelect, onClose }: Props) {
  const [saved, setSaved] = useState(card.saved);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSaved(card.saved);
  }, [card.lemma, card.display, card.selected, card.saved]);

  if (!card.open) return null;

  const color = card.color || "#baf36d";

  const collectText = (card.display || card.selected || card.lemma).trim();

  async function toggleSaved() {
    if (busy || !collectText) return;
    setBusy(true);
    try {
      if (saved) {
        await invoke("remove_saved_word", { lemma: collectText });
        setSaved(false);
      } else {
        await invoke("save_word", {
          lemma: collectText,
          fromSentence: card.sentence || null,
        });
        setSaved(true);
      }
    } catch {
      /* keep prior */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="gloss-card"
      style={{
        ["--gloss" as string]: color,
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="gloss-head">
        <div className="gloss-title">{card.display || card.lemma}</div>
        <div className="gloss-head-actions">
          <button
            type="button"
            className={`gloss-star${saved ? " on" : ""}`}
            onClick={() => void toggleSaved()}
            disabled={busy}
            aria-label={saved ? "取消收藏" : "加入收藏"}
            title={saved ? "取消收藏" : "加入收藏"}
            aria-pressed={saved}
          >
            <FontAwesomeIcon icon={faBookmark} />
          </button>
          <button type="button" className="gloss-close" onClick={onClose} aria-label="关闭">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
      </div>

      {card.candidates.length > 1 ? (
        <div className="gloss-chips">
          {card.candidates.map((item: GlossCandidate) => {
            const active = item.text.toLowerCase() === card.selected.toLowerCase();
            return (
              <button
                key={`${item.kind}-${item.text}`}
                type="button"
                className={active ? "active" : undefined}
                onClick={() => onSelect(item.text)}
              >
                {item.text}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="gloss-ipa-row">
        {card.ipa ? (
          <span className="gloss-ipa">/{card.ipa.replace(/^\/|\/$/g, "")}/</span>
        ) : null}
        <button
          type="button"
          className="gloss-speak"
          aria-label="朗读"
          title="朗读"
          onClick={() =>
            void invoke("speak_text", { text: card.display || card.lemma })
          }
        >
          <FontAwesomeIcon icon={faVolumeHigh} />
        </button>
      </div>

      <div className="gloss-senses">
        {card.senses.length === 0 ? (
          <p className="gloss-empty">词库里还没有这个词</p>
        ) : (
          card.senses.map((sense, index) => (
            <div key={`${sense.pos}-${index}`} className="gloss-sense">
              {sense.pos ? <span className="gloss-pos">{formatPos(sense.pos)}</span> : null}
              <span className="gloss-text">{sense.gloss}</span>
            </div>
          ))
        )}
      </div>

      <button
        type="button"
        className="gloss-detail-link"
        onClick={() => {
          void invoke("open_word_detail", { lemma: card.lemma }).finally(() => {
            onClose();
          });
        }}
      >
        查看单词详情 &gt;
      </button>
    </div>
  );
}

export function buildCardFromSelection(
  base: GlossCardPayload,
  selected: string,
): GlossCardPayload {
  const entry = entryOf(selected);
  return {
    ...base,
    selected,
    lemma: entry?.lemma || selected.toLowerCase(),
    display: entry?.display || selected,
    ipa: entry?.ipa || "",
    senses: sensesOf(selected),
  };
}
