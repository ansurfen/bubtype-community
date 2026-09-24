/** Multi-track packs ship as `*-zh` / `*-en` / `*-ja` siblings. */
export function isMultiTrackPackId(id: string): boolean {
  return /-(zh|en|ja)$/i.test(id);
}

/** Resolve a pack's gloss track from explicit field or id suffix. */
export function packGlossTrack(
  id: string,
  glossLang?: string | null,
): string | null {
  const fromField = (glossLang || "").trim().toLowerCase();
  if (fromField) return fromField;
  const m = id.match(/-(zh|en|ja)$/i);
  return m?.[1]?.toLowerCase() ?? null;
}

/**
 * Discover / pack picker: multi-track siblings follow current gloss;
 * single-track packs always show (missing gloss ⇒ no translation UI).
 */
export function onGlossTrack(
  entry: { id: string; glossLang?: string | null },
  wantGloss: string,
): boolean {
  if (!isMultiTrackPackId(entry.id)) return true;
  const track = packGlossTrack(entry.id, entry.glossLang);
  if (!track) return true;
  return track === wantGloss.trim().toLowerCase();
}

/**
 * Practice / overlay caption gloss:
 * pack hint wins when present (sentences); glossary fills word cards.
 * Hide pack hint when its gloss track ≠ current gloss language.
 */
export function resolvePracticeGloss(opts: {
  wantGloss: string;
  packId?: string | null;
  packGlossLang?: string | null;
  hint?: string | null;
  fromGlossary?: string | null;
}): string {
  const hint = (opts.hint || "").trim();
  const fromGlossary = (opts.fromGlossary || "").trim();
  const want = opts.wantGloss.trim().toLowerCase();
  const track = opts.packId
    ? packGlossTrack(opts.packId, opts.packGlossLang)
    : (opts.packGlossLang || "").trim().toLowerCase() || null;
  const hintOk = !track || track === want;

  if (hint && hintOk) return hint;
  return fromGlossary;
}

/** Word / short phrase — OK for IPA + dictionary gloss. Full sentences are not. */
export function isWordLikeText(text: string): boolean {
  const raw = text.trim();
  if (!raw) return false;
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  if (words.length > 4) return false;
  if (words.length > 1 && /[.;!?]/.test(raw)) return false;
  return true;
}
