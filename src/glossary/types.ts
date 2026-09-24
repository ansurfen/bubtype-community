export type Sense = {
  pos: string;
  gloss: string;
};

export type Entry = {
  lemma: string;
  display?: string;
  ipa?: string;
  senses: Sense[];
  lang?: string;
  glossLang?: string;
  examples?: Example[];
  synonyms?: string[];
  etymology?: string;
};

/** Source sentence + optional translation. */
export type Example = {
  src: string;
  tr?: string;
};

export type Phrase = {
  text: string;
  senses: Sense[];
  lemmas?: string[];
};

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

export type GlossaryPack = {
  manifest: PackManifest;
  entries: Entry[];
  phrases?: Phrase[];
};

export type Wordbook = {
  id: string;
  title: string;
  lang: string;
  lemmas: string[];
};

export type GlossCandidate = {
  text: string;
  kind: "surface" | "lemma" | "phrase";
};

export type GlossCardPayload = {
  open: boolean;
  lemma: string;
  display: string;
  ipa: string;
  senses: Sense[];
  candidates: GlossCandidate[];
  selected: string;
  seen: number;
  saved: boolean;
  color: string;
  sentence: string;
  anchorX: number;
  anchorY: number;
  anchorW: number;
  anchorH: number;
};
