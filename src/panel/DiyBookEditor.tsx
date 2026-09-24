import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRotateLeft,
  faCheck,
  faChevronLeft,
  faPen,
  faPlus,
  faTrash,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { invoke } from "@tauri-apps/api/core";
import type { TFn } from "../i18n";
import type { InstalledWordbook } from "../wordbook/types";
import LibrarySearch from "./LibrarySearch";

export type DiyLemmaRow = {
  word: string;
  phonetic: string;
  gloss: string;
  example: string;
  exampleTr: string;
};

type BookKind = "words" | "sentences";
type ColId = "word" | "phonetic" | "gloss" | "example" | "exampleTr";

type LemmaPage = {
  id: string;
  title: string;
  source: string;
  kind: BookKind;
  total: number;
  offset: number;
  limit: number;
  items: DiyLemmaRow[];
};

type ListRow = DiyLemmaRow & {
  key: string;
  savedWord: string | null;
  removed?: boolean;
};

type Props = {
  t: TFn;
  packId: string;
  editable?: boolean;
  onBack: () => void;
  onMetaChange: (book: InstalledWordbook) => void;
  onDeleted: () => void;
  onPractice: (id: string, title: string) => void;
  onPracticeSelected: (id: string, title: string, lemmas: string[]) => void;
  onExportSelected: (title: string, rows: DiyLemmaRow[]) => void;
  onError?: (message: string) => void;
};

const PAGE_SIZE = 80;

const ALL_COLS: ColId[] = ["word", "phonetic", "gloss", "example", "exampleTr"];

function blank(): DiyLemmaRow {
  return { word: "", phonetic: "", gloss: "", example: "", exampleTr: "" };
}

function toListRows(items: DiyLemmaRow[]): ListRow[] {
  return items.map((item) => ({ ...item, key: item.word, savedWord: item.word }));
}

function defaultCols(kind: BookKind): ColId[] {
  return kind === "sentences" ? ["word", "gloss"] : ["word", "phonetic", "gloss"];
}

function optionalCols(kind: BookKind): ColId[] {
  return kind === "sentences"
    ? ["phonetic", "example", "exampleTr"]
    : ["example", "exampleTr"];
}

function readCols(kind: BookKind): ColId[] {
  try {
    const raw = localStorage.getItem(`bubtype.bookCols.${kind}`);
    if (!raw) return defaultCols(kind);
    const parsed = JSON.parse(raw) as ColId[];
    if (!Array.isArray(parsed) || !parsed.includes("word")) return defaultCols(kind);
    return parsed.filter((c) => ALL_COLS.includes(c));
  } catch {
    return defaultCols(kind);
  }
}

function writeCols(kind: BookKind, cols: ColId[]) {
  localStorage.setItem(`bubtype.bookCols.${kind}`, JSON.stringify(cols));
}

function colLabel(t: TFn, kind: BookKind, col: ColId): string {
  if (col === "word") return kind === "sentences" ? t("mine.diy.col.sentence") : t("mine.diy.col.word");
  if (col === "phonetic") return t("mine.diy.col.phonetic");
  if (col === "gloss") return kind === "sentences" ? t("mine.diy.col.tr") : t("mine.diy.col.gloss");
  if (col === "example") return t("mine.diy.col.example");
  return t("mine.diy.col.exampleTr");
}

function cellValue(row: DiyLemmaRow, col: ColId): string {
  if (col === "word") return row.word;
  if (col === "phonetic") return row.phonetic;
  if (col === "gloss") return row.gloss;
  if (col === "example") return row.example;
  return row.exampleTr;
}

function setCell(row: DiyLemmaRow, col: ColId, value: string): DiyLemmaRow {
  if (col === "word") return { ...row, word: value };
  if (col === "phonetic") return { ...row, phonetic: value };
  if (col === "gloss") return { ...row, gloss: value };
  if (col === "example") return { ...row, example: value };
  return { ...row, exampleTr: value };
}

export default function DiyBookEditor({
  t,
  packId,
  editable = true,
  onBack,
  onMetaChange,
  onDeleted,
  onPractice,
  onPracticeSelected,
  onExportSelected,
  onError,
}: Props) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<BookKind>("words");
  const [cols, setCols] = useState<ColId[]>(() => readCols("words"));
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rows, setRows] = useState<ListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<DiyLemmaRow>(blank());
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const reqSeq = useRef(0);
  const draftId = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const rowsLenRef = useRef(0);
  const totalRef = useRef(0);
  const wordInputRef = useRef<HTMLInputElement | null>(null);
  const selectedRef = useRef(selected);
  const brushRef = useRef<{ paint: boolean; moved: boolean } | null>(null);

  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);
  useEffect(() => {
    rowsLenRef.current = rows.filter((r) => !r.removed).length;
  }, [rows]);
  useEffect(() => {
    totalRef.current = total;
  }, [total]);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (editingKey) wordInputRef.current?.focus();
  }, [editingKey]);

  const fetchPage = useCallback(
    async (offset: number, append: boolean) => {
      const seq = ++reqSeq.current;
      if (append) {
        if (loadingMoreRef.current) return;
        loadingMoreRef.current = true;
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      try {
        const page = await invoke<LemmaPage>("list_wordbook_lemmas", {
          id: packId,
          query: debouncedQuery || null,
          offset,
          limit: PAGE_SIZE,
        });
        if (seq !== reqSeq.current) return;
        setTitle(page.title);
        setTitleDraft(page.title);
        setTotal(page.total);
        const nextKind = page.kind === "sentences" ? "sentences" : "words";
        setKind(nextKind);
        if (!append) setCols(readCols(nextKind));
        setRows((prev) => {
          const next = toListRows(page.items);
          if (!append) {
            const removed = prev.filter((r) => r.removed);
            const drafts = prev.filter((r) => r.savedWord == null && !r.removed);
            return [...removed, ...next, ...drafts];
          }
          const seen = new Set(
            prev.map((r) => r.savedWord || r.key).filter(Boolean) as string[],
          );
          return [...prev, ...next.filter((r) => !seen.has(r.savedWord || r.key))];
        });
      } catch (err) {
        if (seq === reqSeq.current) onError?.(String(err));
      } finally {
        if (seq === reqSeq.current) {
          setLoading(false);
          setLoadingMore(false);
          loadingMoreRef.current = false;
        }
      }
    },
    [packId, debouncedQuery, onError],
  );

  useEffect(() => {
    setEditingKey(null);
    setDraft(blank());
    setSelected({});
    setRows([]);
    void fetchPage(0, false);
  }, [fetchPage]);

  useEffect(() => {
    if (loading || loadingMore) return;
    const live = rows.filter((r) => !r.removed && r.savedWord != null).length;
    if (live === 0 || live >= total) return;
    const el = listRef.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight + 8) void fetchPage(live, true);
  }, [loading, loadingMore, rows, total, fetchPage]);

  function onListScroll() {
    const el = listRef.current;
    if (!el || loadingMoreRef.current) return;
    if (rowsLenRef.current >= totalRef.current) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) {
      void fetchPage(rowsLenRef.current, true);
    }
  }

  function toggleCol(col: ColId) {
    if (col === "word") return;
    setCols((prev) => {
      const next = prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col];
      const ordered = ALL_COLS.filter((c) => next.includes(c));
      writeCols(kind, ordered);
      return ordered;
    });
  }

  function beginEdit(row: ListRow) {
    if (!editable || row.removed || busy) return;
    setEditingKey(row.key);
    setDraft({
      word: row.word,
      phonetic: row.phonetic,
      gloss: row.gloss,
      example: row.example,
      exampleTr: row.exampleTr,
    });
  }

  function cancelEdit() {
    const key = editingKey;
    setEditingKey(null);
    setDraft(blank());
    if (!key) return;
    setRows((prev) =>
      prev.filter((r) => !(r.key === key && r.savedWord == null && !r.word.trim())),
    );
  }

  async function commitEdit() {
    if (!editable || !editingKey || busy) return;
    const word = draft.word.trim();
    const row = rows.find((r) => r.key === editingKey);
    if (!row) return;
    if (!word) {
      if (row.savedWord == null) {
        setRows((prev) => prev.filter((r) => r.key !== editingKey));
        setEditingKey(null);
        setDraft(blank());
      } else {
        onError?.(t("mine.diy.wordRequired"));
      }
      return;
    }
    setBusy(true);
    try {
      const installed = await invoke<InstalledWordbook>("diy_upsert_lemma", {
        id: packId,
        lemma: {
          lemma: word,
          ipa: draft.phonetic.trim() || null,
          gloss: draft.gloss.trim() || null,
          example: draft.example.trim() || null,
          exampleTr: draft.exampleTr.trim() || null,
          oldLemma: row.savedWord,
        },
      });
      onMetaChange(installed);
      const next: ListRow = {
        key: word,
        savedWord: word,
        word,
        phonetic: draft.phonetic.trim(),
        gloss: draft.gloss.trim(),
        example: draft.example.trim(),
        exampleTr: draft.exampleTr.trim(),
      };
      setRows((prev) => {
        const without = prev.filter((r) => r.key !== editingKey && r.savedWord !== word);
        const idx = prev.findIndex((r) => r.key === editingKey);
        const copy = [...without];
        if (idx >= 0) copy.splice(Math.min(idx, copy.length), 0, next);
        else copy.push(next);
        return copy;
      });
      if (row.savedWord == null) setTotal((n) => n + 1);
      setEditingKey(null);
      setDraft(blank());
    } catch (err) {
      onError?.(String(err));
    } finally {
      setBusy(false);
    }
  }

  function addRow() {
    if (!editable || busy) return;
    if (editingKey) {
      wordInputRef.current?.focus();
      return;
    }
    const key = `new-${++draftId.current}`;
    setRows((prev) => [...prev, { ...blank(), key, savedWord: null }]);
    setEditingKey(key);
    setDraft(blank());
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    });
  }

  async function softDelete(row: ListRow) {
    if (!editable || busy || row.removed) return;
    if (row.savedWord == null) {
      setRows((prev) => prev.filter((r) => r.key !== row.key));
      if (editingKey === row.key) {
        setEditingKey(null);
        setDraft(blank());
      }
      return;
    }
    if (editingKey === row.key) {
      setEditingKey(null);
      setDraft(blank());
    }
    setRows((prev) => prev.map((r) => (r.key === row.key ? { ...row, removed: true } : r)));
    setBusy(true);
    try {
      const installed = await invoke<InstalledWordbook>("diy_remove_lemma", {
        id: packId,
        lemma: row.savedWord,
      });
      onMetaChange(installed);
      setTotal((n) => Math.max(0, n - 1));
    } catch (err) {
      setRows((prev) => prev.map((r) => (r.key === row.key ? { ...row, removed: false } : r)));
      onError?.(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function undoDelete(row: ListRow) {
    if (!editable || busy || !row.removed || !row.savedWord) return;
    setBusy(true);
    try {
      const installed = await invoke<InstalledWordbook>("diy_upsert_lemma", {
        id: packId,
        lemma: {
          lemma: row.word,
          ipa: row.phonetic || null,
          gloss: row.gloss || null,
          example: row.example || null,
          exampleTr: row.exampleTr || null,
          oldLemma: null,
        },
      });
      onMetaChange(installed);
      setRows((prev) =>
        prev.map((r) => (r.key === row.key ? { ...r, removed: false, savedWord: r.word } : r)),
      );
      setTotal((n) => n + 1);
    } catch (err) {
      onError?.(String(err));
    } finally {
      setBusy(false);
    }
  }

  function paintSelect(key: string, value: boolean) {
    setSelected((prev) => {
      if (!!prev[key] === value) return prev;
      return { ...prev, [key]: value };
    });
  }

  const liveRows = useMemo(() => rows.filter((r) => !r.removed), [rows]);
  const selectedKeys = useMemo(
    () => liveRows.filter((r) => selected[r.key]).map((r) => r.key),
    [liveRows, selected],
  );
  const allSelected = liveRows.length > 0 && selectedKeys.length === liveRows.length;
  const partialSelected = selectedKeys.length > 0 && !allSelected;

  function toggleSelectAll() {
    if (allSelected) {
      setSelected({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const r of liveRows) next[r.key] = true;
    setSelected(next);
  }

  function renderCheck(on: boolean, partial = false) {
    if (on) return <FontAwesomeIcon icon={faCheck} />;
    if (partial) return <span className="diy-check-partial" aria-hidden />;
    return null;
  }

  function brushStart(key: string, event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    cancelEdit();
    const paint = !selectedRef.current[key];
    brushRef.current = { paint, moved: false };
    paintSelect(key, paint);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function brushMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const brush = brushRef.current;
    if (!brush) return;
    brush.moved = true;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const row = hit?.closest("[data-diy-key]") as HTMLElement | null;
    const key = row?.dataset.diyKey;
    if (key) paintSelect(key, brush.paint);
  }

  function brushEnd(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    brushRef.current = null;
  }

  async function saveTitle() {
    if (!editable) return;
    const next = titleDraft.trim();
    if (!next || next === title) {
      setRenaming(false);
      setTitleDraft(title);
      return;
    }
    setBusy(true);
    try {
      const installed = await invoke<InstalledWordbook>("diy_rename_wordbook", {
        id: packId,
        title: next,
      });
      onMetaChange(installed);
      setTitle(installed.title);
      setTitleDraft(installed.title);
      setRenaming(false);
    } catch (err) {
      onError?.(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteBook() {
    setConfirmDelete(true);
  }

  async function confirmDeleteBook() {
    setConfirmDelete(false);
    setBusy(true);
    try {
      await invoke("remove_wordbook", { id: packId });
      onDeleted();
    } catch (err) {
      onError?.(String(err));
      setBusy(false);
    }
  }

  const optCols = optionalCols(kind);
  const gridTemplate = [
    "28px",
    ...cols.map((c) => (c === "word" ? "minmax(8rem, 1.4fr)" : "minmax(6rem, 1fr)")),
    "72px",
  ].join(" ");

  const hasSelection = selectedKeys.length > 0;

  function runPractice() {
    if (hasSelection) {
      const lemmas = liveRows.filter((r) => selected[r.key]).map((r) => r.word);
      onPracticeSelected(packId, title, lemmas);
      return;
    }
    onPractice(packId, title);
  }

  function runExportSelected() {
    const picked = liveRows.filter((r) => selected[r.key]);
    onExportSelected(
      title,
      picked.map((r) => ({
        word: r.word,
        phonetic: r.phonetic,
        gloss: r.gloss,
        example: r.example,
        exampleTr: r.exampleTr,
      })),
    );
  }

  return (
    <div className="diy-editor">
      <button type="button" className="diy-back" onClick={onBack} disabled={busy}>
        <FontAwesomeIcon icon={faChevronLeft} />
        <span>{t("mine.diy.back")}</span>
      </button>

      <div className="diy-editor-head">
        <div className="diy-editor-title-wrap">
          {editable && renaming ? (
            <input
              className="diy-editor-title-input"
              value={titleDraft}
              disabled={busy}
              autoFocus
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => void saveTitle()}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveTitle();
                if (e.key === "Escape") {
                  setRenaming(false);
                  setTitleDraft(title);
                }
              }}
              aria-label={t("mine.diy.rename")}
            />
          ) : editable ? (
            <button
              type="button"
              className="diy-editor-title"
              onClick={() => setRenaming(true)}
              title={t("mine.diy.rename")}
            >
              {title || "…"}
            </button>
          ) : (
            <h3 className="diy-editor-title static">{title || "…"}</h3>
          )}
          <span className="diy-editor-count">
            {editable ? null : `${t("mine.booksReadOnly")} · `}
            {t("books.lemmas", { n: String(total) })}
            {" · "}
            {kind === "sentences" ? t("mine.diy.kind.sentences") : t("mine.diy.kind.words")}
            {hasSelection ? ` · ${t("mine.diy.selectedCount", { n: String(selectedKeys.length) })}` : ""}
          </span>
        </div>
        <button
          type="button"
          className="diy-text-danger"
          disabled={busy}
          onClick={() => void deleteBook()}
        >
          {editable ? t("mine.diy.deleteBook") : t("mine.booksRemove")}
        </button>
      </div>

      <div className="diy-toolbar">
        <LibrarySearch
          value={query}
          onChange={setQuery}
          placeholder={
            kind === "sentences" ? t("mine.diy.searchSentences") : t("mine.diy.searchWords")
          }
          clearLabel={t("words.clear")}
        />
        <div className="diy-toolbar-actions">
          {editable ? (
            <button type="button" className="library-btn" disabled={busy} onClick={addRow}>
              <FontAwesomeIcon icon={faPlus} />
              <span>{t("mine.diy.addRow")}</span>
            </button>
          ) : null}
          <button
            type="button"
            className="library-btn"
            disabled={!hasSelection}
            onClick={runExportSelected}
          >
            {t("mine.diy.exportSelected")}
          </button>
          <button
            type="button"
            className="library-btn primary"
            disabled={busy || (hasSelection ? false : total === 0)}
            onClick={runPractice}
          >
            {hasSelection ? t("mine.diy.practiceSelected") : t("mine.practice")}
          </button>
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <p className="library-empty">{t("boot.loading")}</p>
      ) : (
        <div className="diy-table-scroll" ref={listRef} onScroll={onListScroll}>
          <div className="diy-table" style={{ ["--diy-cols" as string]: gridTemplate }}>
            <div className="diy-table-head">
              <button
                type="button"
                className={`diy-check${allSelected ? " on" : partialSelected ? " partial" : ""}`}
                aria-label={t("mine.diy.selectAll")}
                onClick={toggleSelectAll}
              >
                {renderCheck(allSelected, partialSelected)}
              </button>
              {cols.map((col) => (
                <div key={col} className="diy-th">
                  {colLabel(t, kind, col)}
                </div>
              ))}
              <div className="diy-th diy-th-actions">
                <div className="diy-col-menu-wrap">
                  <button
                    type="button"
                    className="diy-col-btn"
                    onClick={() => setColMenuOpen((v) => !v)}
                  >
                    {t("mine.diy.columns")}
                  </button>
                  {colMenuOpen ? (
                    <div className="diy-col-menu" role="menu">
                      {optCols.map((col) => (
                        <label key={col} className="diy-col-item">
                          <input
                            type="checkbox"
                            checked={cols.includes(col)}
                            onChange={() => toggleCol(col)}
                          />
                          <span>{colLabel(t, kind, col)}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {liveRows.length === 0 && !rows.some((r) => r.removed) ? (
              <p className="library-empty diy-table-empty">
                {debouncedQuery
                  ? t("mine.diy.noMatch")
                  : editable
                    ? t("mine.diy.emptyWords")
                    : t("mine.booksEmptyWords")}
              </p>
            ) : (
              rows.map((row) => {
                const editing = editable && editingKey === row.key && !row.removed;
                const isOn = !!selected[row.key];
                return (
                  <div
                    key={row.key}
                    data-diy-key={row.key}
                    className={`diy-table-row${row.removed ? " removed" : ""}${
                      isOn ? " selected" : ""
                    }${editing ? " editing" : ""}`}
                  >
                    <button
                      type="button"
                      className={`diy-check${isOn ? " on" : ""}`}
                      aria-label={t("mine.diy.selectRow")}
                      disabled={row.removed}
                      onPointerDown={(e) => {
                        if (row.removed || e.button !== 0) return;
                        brushStart(row.key, e);
                      }}
                      onPointerMove={brushMove}
                      onPointerUp={brushEnd}
                      onPointerCancel={brushEnd}
                      onClick={(e) => e.preventDefault()}
                    >
                      {renderCheck(isOn)}
                    </button>

                    {editing
                      ? cols.map((col, i) => (
                          <input
                            key={col}
                            ref={i === 0 ? wordInputRef : undefined}
                            className={`diy-td-input${col === "word" ? " word" : ""}`}
                            value={cellValue(draft, col)}
                            disabled={busy}
                            placeholder={colLabel(t, kind, col)}
                            onChange={(e) => setDraft((d) => setCell(d, col, e.target.value))}
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void commitEdit();
                              }
                              if (e.key === "Escape") {
                                e.preventDefault();
                                cancelEdit();
                              }
                            }}
                          />
                        ))
                      : cols.map((col) => (
                          <div key={col} className={`diy-td${col === "word" ? " word" : ""}`}>
                            {cellValue(row, col) || (col === "word" ? "—" : "")}
                          </div>
                        ))}

                    {editable ? (
                      <div className="diy-td-actions" onPointerDown={(e) => e.stopPropagation()}>
                        {row.removed ? (
                          <button
                            type="button"
                            className="diy-icon-btn undo"
                            disabled={busy}
                            title={t("mine.diy.undoDelete")}
                            aria-label={t("mine.diy.undoDelete")}
                            onClick={() => void undoDelete(row)}
                          >
                            <FontAwesomeIcon icon={faArrowRotateLeft} />
                          </button>
                        ) : editing ? (
                          <>
                            <button
                              type="button"
                              className="diy-icon-btn ok"
                              disabled={busy || !draft.word.trim()}
                              title={t("mine.diy.saveWord")}
                              aria-label={t("mine.diy.saveWord")}
                              onClick={() => void commitEdit()}
                            >
                              <FontAwesomeIcon icon={faCheck} />
                            </button>
                            <button
                              type="button"
                              className="diy-icon-btn"
                              disabled={busy}
                              title={t("mine.diy.cancelEdit")}
                              aria-label={t("mine.diy.cancelEdit")}
                              onClick={cancelEdit}
                            >
                              <FontAwesomeIcon icon={faXmark} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="diy-icon-btn"
                              disabled={busy}
                              title={t("mine.diy.editWord")}
                              aria-label={t("mine.diy.editWord")}
                              onClick={() => beginEdit(row)}
                            >
                              <FontAwesomeIcon icon={faPen} />
                            </button>
                            <button
                              type="button"
                              className="diy-icon-btn danger"
                              disabled={busy}
                              title={t("words.delete")}
                              aria-label={t("words.delete")}
                              onClick={() => void softDelete(row)}
                            >
                              <FontAwesomeIcon icon={faTrash} />
                            </button>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="diy-td-actions" />
                    )}
                  </div>
                );
              })
            )}
            {loadingMore ? (
              <div className="diy-table-loading">{t("boot.loading")}</div>
            ) : null}
          </div>
        </div>
      )}

      {confirmDelete ? (
        <div
          className="practice-sheet-backdrop"
          onClick={() => setConfirmDelete(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setConfirmDelete(false);
          }}
        >
          <div
            className="session-dialog"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="session-dialog-head">
              <h3>{t("chrome.confirm")}</h3>
              <button
                type="button"
                className="session-dialog-close"
                aria-label={t("chrome.close")}
                onClick={() => setConfirmDelete(false)}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <div className="session-dialog-body">
              <p className="session-mode-hint">
                {t(editable ? "mine.diy.deleteBookConfirm" : "mine.booksRemoveConfirm")}
              </p>
              <div className="session-dialog-actions">
                <button
                  type="button"
                  className="library-btn"
                  onClick={() => setConfirmDelete(false)}
                >
                  {t("chrome.cancel")}
                </button>
                <button
                  type="button"
                  className="btn-theme"
                  disabled={busy}
                  onClick={() => void confirmDeleteBook()}
                >
                  {t("chrome.confirm")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
