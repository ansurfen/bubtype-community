import { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { buildExcelMatrix } from "../export/excel";
import { saveExcelFile } from "../export/save";
import {
  DEFAULT_EXCEL_OPTIONS,
  type ExcelOptions,
  type ExportRow,
} from "../export/types";
import type { TFn } from "../i18n";
import "./export-sheet.css";

type Props = {
  title: string;
  rows: ExportRow[];
  t: TFn;
  onClose: () => void;
  /** Unused in community — kept for Panel API parity. */
  onNeedPro?: () => void;
};

type FieldChip = {
  key: string;
  label: string;
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
};

/** OSS ExportSheet: Excel word/phonetic/gloss only. No PDF, no examples. */
export default function ExportSheet({ title, rows, t, onClose }: Props) {
  const [excelOpts, setExcelOpts] = useState<ExcelOptions>(DEFAULT_EXCEL_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const excelPreview = useMemo(
    () => buildExcelMatrix(rows.slice(0, 8), excelOpts, t),
    [rows, excelOpts, t],
  );

  async function runExport() {
    if (rows.length === 0) {
      setMessage(t("export.empty"));
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const ok = await saveExcelFile(title, rows, excelOpts, t);
      if (ok) setMessage(t("export.doneExcel"));
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusy(false);
    }
  }

  const chips: FieldChip[] = [
    {
      key: "word",
      label: t("export.pdf.word"),
      on: true,
      disabled: true,
      onToggle: () => undefined,
    },
    {
      key: "phonetic",
      label: t("export.pdf.phonetic"),
      on: excelOpts.showPhonetic,
      onToggle: () => setExcelOpts((o) => ({ ...o, showPhonetic: !o.showPhonetic })),
    },
    {
      key: "gloss",
      label: t("export.pdf.gloss"),
      on: excelOpts.showGloss,
      onToggle: () => setExcelOpts((o) => ({ ...o, showGloss: !o.showGloss })),
    },
  ];

  return (
    <div
      className="export-sheet-backdrop"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div
        className="export-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t("export.title")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="export-sheet-head">
          <div>
            <h3>{t("export.title")}</h3>
            <p className="export-sheet-sub">
              {title} · {t("export.count", { n: rows.length })}
            </p>
          </div>
          <button
            type="button"
            className="export-sheet-close"
            aria-label={t("chrome.close")}
            onClick={onClose}
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="export-sheet-body">
          <p className="export-hint">{t("export.excel.communityHint")}</p>
          <div className="export-chips" role="group" aria-label={t("export.excel.cols")}>
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className={`export-chip${chip.on ? " on" : ""}`}
                aria-pressed={chip.on}
                disabled={chip.disabled}
                onClick={chip.onToggle}
              >
                {chip.label}
              </button>
            ))}
          </div>
          <div className="export-excel-preview">
            <table>
              <thead>
                <tr>
                  {excelPreview.header.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {excelPreview.data.map((line, i) => (
                  <tr key={i}>
                    {line.map((cell, j) => (
                      <td key={j}>{String(cell || "—")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > excelPreview.data.length ? (
              <p className="export-excel-more">
                {t("export.excel.previewMore", {
                  n: rows.length - excelPreview.data.length,
                })}
              </p>
            ) : null}
          </div>
          {message ? <p className="export-message">{message}</p> : null}
        </div>

        <div className="export-sheet-foot">
          <span />
          <div className="export-sheet-actions">
            <button type="button" className="library-btn" onClick={onClose}>
              {t("chrome.close")}
            </button>
            <button
              type="button"
              className="library-btn primary"
              disabled={busy || rows.length === 0}
              onClick={() => void runExport()}
            >
              {busy ? t("export.working") : t("export.saveExcel")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
