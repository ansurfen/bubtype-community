import { entryOf, oneLineGloss, type Entry } from "../glossary";
import type { Bookmark, WrongEntry } from "../types";
import type { ExportRow } from "./types";

function firstExample(entry: Entry | null | undefined): string {
  const ex = entry?.examples?.[0];
  if (!ex) return "";
  const src = ex.src?.trim() || "";
  const tr = ex.tr?.trim() || "";
  if (src && tr) return `${src}\n${tr}`;
  return src || tr;
}

export function rowsFromWrong(items: WrongEntry[]): ExportRow[] {
  return items.map((e) => {
    const entry = entryOf(e.text);
    return {
      word: e.text,
      gloss: (e.hint || oneLineGloss(entry, 80) || "").trim(),
      phonetic: entry?.ipa?.trim() || "",
      example: firstExample(entry),
      meta: e.lastAt || "",
    };
  });
}

export function rowsFromBookmarks(items: Bookmark[]): ExportRow[] {
  return items.map((e) => {
    const entry = entryOf(e.text);
    return {
      word: e.text,
      gloss: (e.hint || oneLineGloss(entry, 80) || "").trim(),
      phonetic: entry?.ipa?.trim() || "",
      example: firstExample(entry),
      meta: e.savedAt || "",
    };
  });
}

export function rowsFromLemmas(lemmas: string[]): ExportRow[] {
  return lemmas.map((lemma) => {
    const key = lemma.trim();
    const entry = entryOf(key);
    return {
      word: key,
      gloss: oneLineGloss(entry, 80) || "",
      phonetic: entry?.ipa?.trim() || "",
      example: firstExample(entry),
      meta: "",
    };
  });
}
