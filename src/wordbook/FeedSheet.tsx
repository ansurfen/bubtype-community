import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import type { TFn } from "../i18n";
import type { WordbookFeed } from "./types";
import "./feed-sheet.css";

type Props = {
  t: TFn;
  feeds: WordbookFeed[];
  busy?: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void> | void;
  onAdd: (url: string) => Promise<void> | void;
  onRemove: (id: string) => Promise<void> | void;
};

function feedDisplayLabel(feed: WordbookFeed, t: TFn): string {
  if (feed.url.startsWith("mock://") || feed.id === "local-mock") {
    return t("discover.feedLocal");
  }
  if (
    feed.id === "bubtype-official" ||
    /ansurfen\/bubtype-(packs|wordbooks)/i.test(feed.url)
  ) {
    return t("discover.feedOfficial");
  }
  return feed.label?.trim() || feed.id;
}

function feedDisplayUrl(feed: WordbookFeed): string {
  if (feed.url.startsWith("mock://")) return "";
  return feed.url;
}

export default function FeedSheet({
  t,
  feeds,
  busy,
  onClose,
  onRefresh,
  onAdd,
  onRemove,
}: Props) {
  const [draft, setDraft] = useState("");
  const [working, setWorking] = useState(false);
  const locked = busy || working;

  async function handleAdd() {
    const url = draft.trim();
    if (!url) return;
    setWorking(true);
    try {
      await onAdd(url);
      setDraft("");
    } finally {
      setWorking(false);
    }
  }

  async function handleRefresh() {
    setWorking(true);
    try {
      await onRefresh();
    } finally {
      setWorking(false);
    }
  }

  return (
    <div
      className="feed-sheet-backdrop"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div
        className="feed-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t("discover.feeds")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="feed-sheet-head">
          <div>
            <h3>{t("discover.feeds")}</h3>
            <p className="feed-sheet-sub">{t("discover.feedsHint")}</p>
          </div>
          <div className="feed-sheet-head-actions">
            <button
              type="button"
              className="feed-sheet-refresh"
              disabled={locked}
              onClick={() => void handleRefresh()}
            >
              {t("discover.feedRefresh")}
            </button>
            <button
              type="button"
              className="feed-sheet-close"
              aria-label={t("chrome.close")}
              onClick={onClose}
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
        </div>

        <div className="feed-sheet-body">
          {feeds.length === 0 ? (
            <p className="feed-sheet-empty">{t("discover.feedsEmpty")}</p>
          ) : (
            <ul className="feed-sheet-list">
              {feeds.map((feed) => {
                const url = feedDisplayUrl(feed);
                return (
                  <li key={feed.id}>
                    <div className="feed-sheet-meta">
                      <strong>{feedDisplayLabel(feed, t)}</strong>
                      {url ? <span className="muted">{url}</span> : null}
                      {feed.lastError ? (
                        <span className="feed-sheet-err">{feed.lastError}</span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="feed-sheet-remove"
                      disabled={locked}
                      onClick={() => void onRemove(feed.id)}
                    >
                      {t("discover.feedRemove")}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="feed-sheet-add">
            <input
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("discover.feedUrlPlaceholder")}
              aria-label={t("discover.feedUrlPlaceholder")}
              disabled={working}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleAdd();
                }
              }}
            />
            <button
              type="button"
              className="btn-theme"
              disabled={working || !draft.trim()}
              onClick={() => void handleAdd()}
            >
              {t("discover.feedAdd")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
