const KEY = "bubtype.dictHistory";
const MAX = 10;

export type DictHistoryItem = {
  lemma: string;
  display?: string;
  gloss?: string;
  at: number;
};

export function readDictHistory(): DictHistoryItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DictHistoryItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.lemma === "string" && item.lemma.trim())
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export function pushDictHistory(input: {
  lemma: string;
  display?: string;
  gloss?: string;
}): DictHistoryItem[] {
  const lemma = input.lemma.trim();
  if (!lemma) return readDictHistory();
  const key = lemma.toLowerCase();
  const next: DictHistoryItem[] = [
    {
      lemma,
      display: input.display?.trim() || undefined,
      gloss: input.gloss?.trim() || undefined,
      at: Date.now(),
    },
    ...readDictHistory().filter((item) => item.lemma.trim().toLowerCase() !== key),
  ].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function clearDictHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
