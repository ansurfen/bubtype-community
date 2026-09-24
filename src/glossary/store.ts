import type {
  Entry,
  GlossCandidate,
  GlossaryPack,
  Phrase,
  Sense,
} from "./types";

type Store = {
  entries: Map<string, Entry>;
  phrases: Phrase[];
  packs: string[];
  ready: boolean;
};

const store: Store = {
  entries: new Map(),
  phrases: [],
  packs: [],
  ready: false,
};

let loadPromise: Promise<void> | null = null;
let loadedGlossLang: string | null = null;

function norm(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");
}

export function mergePack(pack: GlossaryPack) {
  const id = `${pack.manifest.id}@${pack.manifest.version}`;
  if (!store.packs.includes(id)) store.packs.push(id);

  for (const entry of pack.entries) {
    const key = norm(entry.lemma);
    if (!key) continue;
    const prev = store.entries.get(key);
    if (!prev) {
      store.entries.set(key, { ...entry, lemma: key });
      continue;
    }
    // Later packs overwrite same lemma (caller should load core then ext by version).
    store.entries.set(key, {
      ...prev,
      ...entry,
      lemma: key,
      senses: entry.senses?.length ? entry.senses : prev.senses,
    });
  }

  if (pack.phrases?.length) {
    const seen = new Set(store.phrases.map((p) => norm(p.text)));
    for (const phrase of pack.phrases) {
      const key = norm(phrase.text);
      if (!key || seen.has(key)) {
        if (key && seen.has(key)) {
          const idx = store.phrases.findIndex((p) => norm(p.text) === key);
          if (idx >= 0) store.phrases[idx] = phrase;
        }
        continue;
      }
      seen.add(key);
      store.phrases.push(phrase);
    }
  }
}

export function resetGlossary() {
  store.entries.clear();
  store.phrases = [];
  store.packs = [];
  store.ready = false;
  loadPromise = null;
  loadedGlossLang = null;
}

/** Load glossary by merging entries from installed Packs (no bundled core). */
export async function ensureGlossary(glossLang?: string): Promise<void> {
  const lang = (glossLang || "zh").toLowerCase();
  // Retry when a previous load marked ready but got zero entries (startup race / failed IPC).
  if (store.ready && loadedGlossLang === lang && store.entries.size > 0) return;
  if (store.ready) {
    resetGlossary();
  }
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const packs = await invoke<
        Array<{
          manifest: GlossaryPack["manifest"];
          entries?: Entry[];
          phrases?: Phrase[];
        }>
      >("list_glossary_packs", { glossLang: lang });
      for (const pack of packs) {
        const m = pack.manifest as {
          id: string;
          version: string;
          lang: string;
          glossLang?: string;
        };
        mergePack({
          manifest: {
            id: m.id,
            version: m.version,
            lang: m.lang,
            glossLang: m.glossLang || "zh",
            kind: "ext",
          },
          entries: pack.entries ?? [],
          phrases: pack.phrases ?? [],
        });
      }
      loadedGlossLang = lang;
    } catch {
      /* empty until user installs a Pack */
    } finally {
      store.ready = true;
      loadPromise = null;
    }
  })();
  return loadPromise;
}

/** Force re-merge after install or gloss-language change. */
export async function reloadGlossary(glossLang?: string): Promise<void> {
  resetGlossary();
  await ensureGlossary(glossLang);
}

export function lookup(lemma: string): Entry | null {
  const key = norm(lemma);
  if (!key) return null;
  return store.entries.get(key) ?? null;
}

export function lookupPhrase(text: string): Phrase | null {
  const key = norm(text);
  if (!key) return null;
  return store.phrases.find((p) => norm(p.text) === key) ?? null;
}

export function phrasesOfLemma(lemma: string): Phrase[] {
  const key = norm(lemma);
  if (!key) return [];
  // Only phrases explicitly bound to this lemma — never substring match
  // (otherwise lemma "a" matches every phrase containing the letter a).
  return store.phrases.filter((phrase) =>
    (phrase.lemmas ?? []).some((item) => norm(item) === key),
  );
}

export function sensesOf(target: string): Sense[] {
  const phrase = lookupPhrase(target);
  if (phrase?.senses?.length) return phrase.senses;
  const entry = lookup(target);
  return entry?.senses ?? [];
}

/** Clip to a single short line (first clause, then char cap). */
export function clipOneLine(text: string, maxChars = 28): string {
  const first =
    text
      .trim()
      .split(/[;；|/｜]/)[0]
      ?.trim()
      .replace(/\s+/g, " ") || "";
  if (!first) return "";
  const chars = [...first];
  if (chars.length <= maxChars) return first;
  return `${chars.slice(0, maxChars).join("")}…`;
}

/** First sense gloss only, clipped to one short line for caption / practice. */
export function oneLineGloss(
  targetOrEntry?: string | { senses?: Sense[] } | null,
  maxChars = 28,
): string {
  let gloss = "";
  if (typeof targetOrEntry === "string") {
    gloss = sensesOf(targetOrEntry).find((s) => s.gloss?.trim())?.gloss?.trim() || "";
  } else {
    gloss = targetOrEntry?.senses?.find((s) => s.gloss?.trim())?.gloss?.trim() || "";
  }
  return clipOneLine(gloss, maxChars);
}

export function entryOf(target: string): Entry | null {
  const phrase = lookupPhrase(target);
  if (phrase) {
    return {
      lemma: norm(phrase.text),
      display: phrase.text,
      senses: phrase.senses,
    };
  }
  return lookup(target);
}

/** Surface word + phrases in sentence that cover the tap index. */
export function candidatesFor(
  sentence: string,
  surface: string,
  charIndex: number,
): GlossCandidate[] {
  const surf = norm(surface);
  if (!surf) return [];
  const out: GlossCandidate[] = [{ text: surf, kind: "surface" }];
  const lower = sentence.toLowerCase();

  for (const phrase of store.phrases) {
    const text = phrase.text.trim();
    if (!text || !text.includes(" ")) continue;
    const key = norm(text);
    if (!key || key === surf) continue;
    const tokens = text.toLowerCase().split(/\s+/);
    if (!tokens.includes(surf) && !tokens.some((t) => norm(t) === surf)) continue;

    const re = new RegExp(`\\b${escapeRe(text)}\\b`, "ig");
    let match: RegExpExecArray | null;
    while ((match = re.exec(sentence))) {
      const start = match.index;
      const end = start + match[0].length;
      if (charIndex >= start && charIndex < end) {
        if (!out.some((c) => c.text === key)) {
          out.push({ text: phrase.text, kind: "phrase" });
        }
        break;
      }
      // also try lower
      void lower;
    }

    // fallback: contiguous token window around surface
    if (!out.some((c) => norm(c.text) === key)) {
      const words = wordsWithIndex(sentence);
      const hit = words.find((w) => charIndex >= w.start && charIndex < w.end);
      if (hit) {
        for (let i = 0; i < words.length; i += 1) {
          const slice = words.slice(i, i + tokens.length);
          if (slice.length < tokens.length) break;
          const joined = slice.map((w) => w.word.toLowerCase()).join(" ");
          if (joined === text.toLowerCase()) {
            const start = slice[0].start;
            const end = slice[slice.length - 1].end;
            if (charIndex >= start && charIndex < end) {
              out.push({ text: phrase.text, kind: "phrase" });
              break;
            }
          }
        }
      }
    }
  }

  return out.slice(0, 8);
}

function wordsWithIndex(text: string): Array<{ word: string; start: number; end: number }> {
  const out: Array<{ word: string; start: number; end: number }> = [];
  const re = /[A-Za-z']+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    out.push({ word: match[0], start: match.index, end: match.index + match[0].length });
  }
  return out;
}

export function wordAt(text: string, charIndex: number): { word: string; start: number; end: number } | null {
  const words = wordsWithIndex(text);
  return words.find((w) => charIndex >= w.start && charIndex < w.end) ?? null;
}

function escapeRe(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function installedPacks(): string[] {
  return store.packs.slice();
}

export function glossarySize(): number {
  return store.entries.size;
}

/** Prefix / contains search over local glossary (lemma + gloss). */
export function searchGlossary(query: string, limit = 80): Entry[] {
  if (!store.ready) return [];
  const raw = query.trim();
  if (!raw) return [];
  const q = norm(raw);
  const glossQ = raw.toLowerCase();
  const exact: Entry[] = [];
  const prefix: Entry[] = [];
  const soft: Entry[] = [];
  for (const [key, entry] of store.entries) {
    if (q && key === q) {
      exact.push(entry);
      continue;
    }
    if (q && key.startsWith(q)) {
      prefix.push(entry);
      continue;
    }
    if (q && key.includes(q)) {
      soft.push(entry);
      continue;
    }
    const hitGloss = entry.senses?.some((s) => s.gloss.toLowerCase().includes(glossQ));
    const hitDisplay = (entry.display || "").toLowerCase().includes(glossQ);
    if (hitGloss || hitDisplay) soft.push(entry);
  }
  return [...exact, ...prefix, ...soft].slice(0, limit);
}
