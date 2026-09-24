/** Shared Pro/Community contract — safe to keep in the public repo. */

export type EditionId = "community" | "pro";

/** free = commercial build without license; pro = licensed; community = OSS build */
export type EntitlementTier = "community" | "free" | "pro";

export type ParticleSkinId =
  | "classic"
  | "slime"
  | "flame"
  | "soul"
  | "snow"
  | "sakura"
  | "maple"
  | "leaf"
  | "heart"
  | "star"
  /** VIP-badge-inspired packs: matching subtitle ink + draw particles */
  | "aurora"
  | "sunset"
  | "ocean"
  | "candy"
  | "neon";

export type SkinProfile = {
  mode: "draw" | "sprite";
  colors?: string[];
  sprites?: string[];
  count: [number, number];
  speed: [number, number];
  gravity: number;
  drag: number;
  kinds?: Array<"dot" | "cross" | "blob" | "ember" | "wisp" | "sprite">;
  size: [number, number];
  upwardBias: number;
  sway?: number;
  /** Requires paid license inside the commercial build */
  premium?: boolean;
};

export type SkinInk = {
  typedClass: string;
  pending: string;
  accent: string;
};

export type SkinListItem = {
  id: ParticleSkinId;
  label: string;
  premium: boolean;
};

export type Entitlement = {
  edition: EditionId;
  tier: EntitlementTier;
  licensed: boolean;
  licenseKey: string | null;
};

export type ActivateResult = {
  ok: boolean;
  message: string;
};
