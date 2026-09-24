/** DIY wordbook import — table / pack formats. */

export type ImportKind = "table" | "pack" | "queue";

export type ImportRow = {
  word: string;
  phonetic: string;
  gloss: string;
  example: string;
  /** Translation of the example (column: example_tr). */
  exampleTr: string;
};

export type ImportPreview = {
  kind: ImportKind;
  fileName: string;
  title: string;
  lang: string;
  glossLang: string;
  rows: ImportRow[];
  /** Pack JSON path for advanced packs that already have items/entries */
  packJson?: unknown;
  warnings: string[];
};

export const TEMPLATE_HEADERS = [
  "word",
  "phonetic",
  "gloss",
  "example",
  "example_tr",
] as const;

/** Accepted aliases (lowercase) → canonical header */
export const HEADER_ALIASES: Record<string, (typeof TEMPLATE_HEADERS)[number]> = {
  word: "word",
  lemma: "word",
  单词: "word",
  詞: "word",
  词: "word",
  text: "word",
  phonetic: "phonetic",
  ipa: "phonetic",
  音标: "phonetic",
  音標: "phonetic",
  gloss: "gloss",
  meaning: "gloss",
  hint: "gloss",
  释义: "gloss",
  釋義: "gloss",
  翻译: "gloss",
  翻譯: "gloss",
  example: "example",
  例句: "example",
  example_src: "example",
  example_tr: "example_tr",
  例句译文: "example_tr",
  例句譯文: "example_tr",
  tr: "example_tr",
};
