import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { TFn } from "../i18n";
import type { InstalledWordbook } from "../wordbook/types";
import { detectAndParse, previewToPack } from "./parse";
import { downloadTemplate } from "./template";
import type { ImportPreview } from "./types";
import "./import-sheet.css";

type Props = {
  t: TFn;
  busy?: boolean;
  onClose: () => void;
  onInstalled: (book: InstalledWordbook) => void;
  onError?: (message: string) => void;
};

export default function ImportSheet({ t, busy, onClose, onInstalled, onError }: Props) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [title, setTitle] = useState("");
  const [working, setWorking] = useState(false);
  const [localMsg, setLocalMsg] = useState<string | null>(null);

  const locked = busy || working;

  async function pickFile() {
    setLocalMsg(null);
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Wordbook",
          extensions: ["xlsx", "xls", "csv", "json", "txt"],
        },
      ],
    });
    if (typeof selected !== "string") return;
    setWorking(true);
    try {
      const bytes = await invoke<number[]>("read_bytes", { path: selected });
      const fileName = selected.split(/[/\\]/).pop() ?? selected;
      const next = detectAndParse(fileName, Uint8Array.from(bytes));
      setPreview(next);
      setTitle(next.title);
      if (next.warnings.length && !next.rows.length) {
        setLocalMsg(next.warnings.join(" · "));
      }
    } catch (err) {
      setPreview(null);
      setLocalMsg(String(err));
      onError?.(String(err));
    } finally {
      setWorking(false);
    }
  }

  async function saveTemplate(kind: "xlsx" | "csv") {
    setLocalMsg(null);
    setWorking(true);
    try {
      const ok = await downloadTemplate(kind);
      if (ok) setLocalMsg(t("import.templateSaved"));
    } catch (err) {
      setLocalMsg(String(err));
      onError?.(String(err));
    } finally {
      setWorking(false);
    }
  }

  async function confirmImport() {
    if (!preview || preview.rows.length === 0) {
      setLocalMsg(t("import.empty"));
      return;
    }
    setWorking(true);
    setLocalMsg(null);
    try {
      const pack = previewToPack(preview, title);
      const installed = await invoke<InstalledWordbook>("install_diy_wordbook", { pack });
      onInstalled(installed);
    } catch (err) {
      setLocalMsg(String(err));
      onError?.(String(err));
    } finally {
      setWorking(false);
    }
  }

  const previewRows = preview?.rows.slice(0, 6) ?? [];

  return (
    <div
      className="import-sheet-backdrop"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div
        className="import-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t("import.title")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="import-sheet-head">
          <div>
            <h3>{t("import.title")}</h3>
            <p className="import-sheet-sub">{t("import.sub")}</p>
          </div>
          <button
            type="button"
            className="import-sheet-close"
            aria-label={t("chrome.close")}
            onClick={onClose}
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="import-sheet-body">
          <ol className="import-steps">
            <li className="import-block">
              <h4>
                <span className="import-step-n">1</span>
                {t("import.step1Title")}
              </h4>
              <p className="import-hint">{t("import.step1Hint")}</p>
              <ul className="import-cols">
                <li>{t("import.col.word")}</li>
                <li>{t("import.col.phonetic")}</li>
                <li>{t("import.col.gloss")}</li>
                <li>{t("import.col.example")}</li>
                <li>{t("import.col.exampleTr")}</li>
              </ul>
              <div className="import-actions">
                <button
                  type="button"
                  className="library-btn primary"
                  disabled={locked}
                  onClick={() => void saveTemplate("xlsx")}
                >
                  {t("import.downloadXlsx")}
                </button>
                <button
                  type="button"
                  className="library-btn"
                  disabled={locked}
                  onClick={() => void saveTemplate("csv")}
                >
                  {t("import.downloadCsv")}
                </button>
              </div>
            </li>

            <li className="import-block">
              <h4>
                <span className="import-step-n">2</span>
                {t("import.step2Title")}
              </h4>
              <p className="import-hint">{t("import.step2Hint")}</p>
              <div className="import-actions">
                <button
                  type="button"
                  className="library-btn primary"
                  disabled={locked}
                  onClick={() => void pickFile()}
                >
                  {working && !preview ? t("import.reading") : t("import.pickFile")}
                </button>
              </div>
              <details className="import-more-formats">
                <summary>{t("import.formatsTitle")}</summary>
                <ul>
                  <li>{t("import.format.xlsx")}</li>
                  <li>{t("import.format.csv")}</li>
                  <li>{t("import.format.txt")}</li>
                  <li>{t("import.format.json")}</li>
                </ul>
              </details>
            </li>

            {preview ? (
              <li className="import-block preview">
                <h4>
                  <span className="import-step-n">3</span>
                  {t("import.step3Title")}
                </h4>
                <label className="import-field">
                  <span>{t("import.bookTitle")}</span>
                  <input
                    type="text"
                    value={title}
                    disabled={locked}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <p className="import-meta">
                  {t("import.meta", {
                    file: preview.fileName,
                    n: String(preview.rows.length),
                    kind: t(`import.kind.${preview.kind}`),
                  })}
                </p>
                {preview.warnings.length ? (
                  <p className="import-warn">{preview.warnings.join(" · ")}</p>
                ) : null}
                {previewRows.length ? (
                  <div className="import-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{t("import.col.word")}</th>
                          <th>{t("import.col.phonetic")}</th>
                          <th>{t("import.col.gloss")}</th>
                          <th>{t("import.col.example")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, i) => (
                          <tr key={`${row.word}-${i}`}>
                            <td>{row.word}</td>
                            <td>{row.phonetic || "—"}</td>
                            <td>{row.gloss || "—"}</td>
                            <td className="import-ex">
                              {row.example
                                ? row.exampleTr
                                  ? `${row.example}\n${row.exampleTr}`
                                  : row.example
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {preview.rows.length > previewRows.length ? (
                      <p className="import-more">
                        {t("import.previewMore", {
                          n: String(preview.rows.length - previewRows.length),
                        })}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ) : null}
          </ol>

          {localMsg ? <p className="import-message">{localMsg}</p> : null}
        </div>

        <div className="import-sheet-foot">
          <button type="button" className="library-btn" onClick={onClose} disabled={working}>
            {t("chrome.close")}
          </button>
          <button
            type="button"
            className="library-btn primary"
            disabled={locked || !preview || preview.rows.length === 0}
            onClick={() => void confirmImport()}
          >
            {working && preview ? t("import.installing") : t("import.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
