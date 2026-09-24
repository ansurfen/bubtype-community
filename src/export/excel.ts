import * as XLSX from "xlsx";
import type { ExcelOptions, ExportRow } from "./types";
import type { TFn } from "../i18n";

export type ExcelColumn = "index" | "word" | "phonetic" | "gloss";

export function excelColumns(opts: ExcelOptions): ExcelColumn[] {
  const cols: ExcelColumn[] = ["index", "word"];
  if (opts.showPhonetic) cols.push("phonetic");
  if (opts.showGloss) cols.push("gloss");
  return cols;
}

function headerOf(col: ExcelColumn, t: TFn): string {
  switch (col) {
    case "index":
      return t("export.col.index");
    case "word":
      return t("export.col.word");
    case "phonetic":
      return t("export.col.phonetic");
    case "gloss":
      return t("export.col.gloss");
  }
}

function cellOf(col: ExcelColumn, row: ExportRow, index: number): string | number {
  switch (col) {
    case "index":
      return index + 1;
    case "word":
      return row.word;
    case "phonetic":
      return row.phonetic;
    case "gloss":
      return row.gloss;
  }
}

const COL_WIDTH: Record<ExcelColumn, number> = {
  index: 6,
  word: 28,
  phonetic: 16,
  gloss: 36,
};

export function buildExcelMatrix(
  rows: ExportRow[],
  opts: ExcelOptions,
  t: TFn,
): { header: string[]; data: Array<Array<string | number>>; cols: ExcelColumn[] } {
  const cols = excelColumns(opts);
  const header = cols.map((c) => headerOf(c, t));
  const data = rows.map((row, i) => cols.map((c) => cellOf(c, row, i)));
  return { header, data, cols };
}

export function buildExcelBytes(
  title: string,
  rows: ExportRow[],
  opts: ExcelOptions,
  t: TFn,
): Uint8Array {
  const { header, data, cols } = buildExcelMatrix(rows, opts, t);
  const sheet = XLSX.utils.aoa_to_sheet([header, ...data]);
  sheet["!cols"] = cols.map((c) => ({ wch: COL_WIDTH[c] }));
  const book = XLSX.utils.book_new();
  const name = (title || "export").slice(0, 28) || "export";
  XLSX.utils.book_append_sheet(book, sheet, name);
  const out = XLSX.write(book, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Uint8Array(out);
}
