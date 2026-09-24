/**
 * Glossary pack format for BubType (GitHub Release distribution).
 *
 * File: bubtype-glossary-{kind}-{lang}-{glossLang}-v{version}.json
 * (zip later; v1 ships a single JSON under public/glossary/)
 *
 * Merge: load core first, then ext packs by ascending version.
 * Same lemma → later pack overwrites senses/ipa/examples.
 */
export type PackKind = "core" | "ext" | "examples" | "relations";

export type PackManifest = {
  id: string;
  version: string;
  lang: string;
  glossLang: string;
  kind: PackKind;
  baseVersion?: string;
  contentHash?: string;
  lemmaCount?: number;
};
