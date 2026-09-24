import { useEffect, useState, type ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBookmark, faVolumeHigh, faXmark } from "@fortawesome/free-solid-svg-icons";
import { invoke } from "@tauri-apps/api/core";
import { formatPos, entryOf, ensureGlossary, phrasesOfLemma, type Entry, type Phrase } from "../glossary";
import "./word-detail.css";

type Props = {
  lemma: string;
  glossLang?: string;
  color: string;
  onClose: () => void;
};

export default function WordDetail({ lemma, glossLang, color, onClose }: Props) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      await ensureGlossary(glossLang || "zh");
      if (cancel) return;
      // Prefer exact lemma; for wrong-book sentences try the first token.
      const direct = entryOf(lemma);
      if (direct) {
        setEntry(direct);
      } else {
        const token = lemma.trim().split(/\s+/)[0] ?? lemma;
        setEntry(entryOf(token));
      }
      setPhrases(phrasesOfLemma(lemma).slice(0, 24));
      try {
        const snap = await invoke<{
          bookmarks?: Array<{ text: string }>;
        }>("get_snapshot");
        const key = lemma.trim().toLowerCase();
        setSaved(
          (snap.bookmarks ?? []).some((w) => w.text.trim().toLowerCase() === key),
        );
      } catch {
        setSaved(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [lemma, glossLang]);

  async function toggleSaved() {
    if (busy) return;
    setBusy(true);
    try {
      if (saved) {
        await invoke("remove_saved_word", { lemma });
        setSaved(false);
      } else {
        await invoke("save_word", { lemma, fromSentence: null });
        setSaved(true);
      }
    } catch {
      /* keep */
    } finally {
      setBusy(false);
    }
  }

  const title = entry?.display || entry?.lemma || lemma;

  return (
    <div className="word-detail-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="word-detail-head">
        <div className="word-detail-hero">
          <h2 className="word-lemma" style={{ color }}>
            {title}
          </h2>
          <div className="word-ipa-row">
            {entry?.ipa ? (
              <span className="word-ipa">/{entry.ipa.replace(/^\/|\/$/g, "")}/</span>
            ) : null}
            <button
              type="button"
              className="word-detail-speak"
              aria-label="朗读"
              title="朗读"
              onClick={() => void invoke("speak_text", { text: title })}
            >
              <FontAwesomeIcon icon={faVolumeHigh} />
            </button>
          </div>
          {entry && entry.senses.length > 0 ? (
            <div className="word-senses word-senses-hero">
              {entry.senses.map((sense, index) => (
                <p key={`${sense.pos}-${index}`}>
                  {sense.pos ? <span className="word-pos">{formatPos(sense.pos)}</span> : null}
                  {sense.gloss}
                </p>
              ))}
            </div>
          ) : null}
        </div>
        <div className="word-detail-actions">
          <button
            type="button"
            className={`word-detail-save${saved ? " on" : ""}`}
            disabled={busy}
            onClick={() => void toggleSaved()}
            aria-label={saved ? "取消收藏" : "加入收藏"}
            title={saved ? "取消收藏" : "加入收藏"}
            aria-pressed={saved}
          >
            <FontAwesomeIcon icon={faBookmark} />
          </button>
          <button type="button" className="word-detail-close" onClick={onClose} aria-label="关闭">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
      </div>

      {!entry ? (
        <p className="word-detail-empty">
          本地还没有「{lemma}」。去「发现」下载牛津等 Pack 后，单词和短语会合并进词典。
        </p>
      ) : (
        <>
          {entry.examples && entry.examples.length > 0 ? (
            <div className="word-block">
              <h3>例句</h3>
              {entry.examples.map((ex, index) => (
                <div key={index} className="word-example">
                  <p>{highlight(ex.src, title, color)}</p>
                  {ex.tr ? <p className="tr">{ex.tr}</p> : null}
                </div>
              ))}
            </div>
          ) : null}
          {phrases.length > 0 ? (
            <div className="word-block">
              <h3>短语</h3>
              {phrases.map((phrase) => (
                <p key={phrase.text} className="word-phrase">
                  <strong>{phrase.text}</strong>
                  {phrase.senses?.[0]?.gloss ? (
                    <span> · {phrase.senses.map((s) => s.gloss).filter(Boolean).join("；")}</span>
                  ) : null}
                </p>
              ))}
            </div>
          ) : null}
          {entry.synonyms && entry.synonyms.length > 0 && title.trim().length >= 3 ? (
            <div className="word-block">
              <h3>同近义词</h3>
              <p>{entry.synonyms.join(" / ")}</p>
            </div>
          ) : null}
          {entry.etymology ? (
            <div className="word-block">
              <h3>词源</h3>
              <p>{entry.etymology}</p>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function highlight(sentence: string, word: string, color: string): ReactNode {
  const re = new RegExp(`(${escapeRe(word)})`, "ig");
  const parts = sentence.split(re);
  return parts.map((part, index) =>
    part.toLowerCase() === word.toLowerCase() ? (
      <span key={index} style={{ color }}>
        {part}
      </span>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

function escapeRe(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
