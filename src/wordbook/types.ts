/**
 * Wordbook distribution (subscription feeds / mock / DIY).
 *
 * Feeds point at a catalog.json manifest (Clash-style). Sync pulls manifests;
 * download/update pulls each book's asset URL.
 */

export type WordbookSource = string;

export type WordbookManifest = {
  id: string;
  title: string;
  version: string;
  lang: string;
  glossLang?: string;
  source?: WordbookSource;
  lemmaCount?: number;
  description?: string;
  contentHash?: string;
};

export type WordbookPack = {
  manifest: WordbookManifest;
  lemmas: string[];
  items?: Array<{ text: string; hint?: string | null; kind?: string | null }>;
  /** Merged into local glossary — words + phrases from any installed Pack. */
  entries?: import("../glossary/types").Entry[];
  phrases?: import("../glossary/types").Phrase[];
};

export type WordbookCatalogEntry = {
  id: string;
  title: string;
  version: string;
  lang: string;
  glossLang?: string;
  lemmaCount?: number;
  description?: string;
  /** Relative asset name or absolute https URL */
  asset: string;
  sha256?: string;
};

export type WordbookCatalog = {
  version: number;
  source: string;
  updatedAt?: string;
  books: WordbookCatalogEntry[];
};

export type WordbookFeed = {
  id: string;
  url: string;
  label: string;
  enabled: boolean;
  lastSyncAt?: string | null;
  lastError?: string | null;
};

export type InstalledWordbook = {
  id: string;
  title: string;
  version: string;
  lang: string;
  glossLang?: string;
  lemmaCount: number;
  source: WordbookSource;
  installedAt: string;
};

/** Compare dotted versions; true if remote is newer than local. */
export function isNewerVersion(remote: string, local: string): boolean {
  const parse = (v: string) =>
    v
      .split(/[.+-]/)
      .map((p) => Number.parseInt(p, 10))
      .map((n) => (Number.isFinite(n) ? n : 0));
  const a = parse(remote);
  const b = parse(local);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}
