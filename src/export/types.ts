export type ExportSource =
  | "wrong"
  | "bookmarks"
  | "wordbook";

export type ExportRow = {
  word: string;
  gloss: string;
  phonetic: string;
  /** Populated from glossary when available; only Pro UI exports this column. */
  example: string;
  meta: string;
};

/** Community / free Excel: word / phonetic / gloss only. */
export type ExcelOptions = {
  showPhonetic: boolean;
  showGloss: boolean;
};

export const DEFAULT_EXCEL_OPTIONS: ExcelOptions = {
  showPhonetic: true,
  showGloss: true,
};
