/** Port of Voya ProfileVipBadge / vipBadgeStyles — CSS strip shimmer, no avatar. */

export type PremiumBadgeStyle = "aurora" | "sunset" | "ocean" | "candy" | "neon";

export const DEFAULT_PREMIUM_BADGE_STYLE: PremiumBadgeStyle = "aurora";

export const PREMIUM_BADGE_STYLES: Array<{
  id: PremiumBadgeStyle;
  label: string;
  /** CSS linear-gradient color stops (doubled in the strip for seamless loop). */
  colors: readonly string[];
}> = [
  {
    id: "aurora",
    label: "Aurora",
    colors: ["#f9a8d4", "#c4b5fd", "#93c5fd", "#6ee7b7", "#fde68a", "#f9a8d4", "#c4b5fd", "#93c5fd"],
  },
  {
    id: "sunset",
    label: "Sunset",
    colors: ["#fb7185", "#f97316", "#e879f9", "#a855f7", "#fb7185", "#f97316", "#e879f9"],
  },
  {
    id: "ocean",
    label: "Ocean",
    colors: ["#22d3ee", "#38bdf8", "#818cf8", "#6366f1", "#22d3ee", "#38bdf8", "#818cf8"],
  },
  {
    id: "candy",
    label: "Candy",
    colors: ["#fda4af", "#e9d5ff", "#a7f3d0", "#fbcfe8", "#fda4af", "#e9d5ff", "#a7f3d0"],
  },
  {
    id: "neon",
    label: "Neon",
    colors: ["#ff4d6d", "#ff8c42", "#ffd166", "#06d6a0", "#4cc9f0", "#7b2cbf", "#f72585", "#ff4d6d"],
  },
];

const STYLE_KEY = "bubtype.premiumBadgeStyle";

export function parsePremiumBadgeStyle(raw: unknown): PremiumBadgeStyle {
  if (
    raw === "aurora" ||
    raw === "sunset" ||
    raw === "ocean" ||
    raw === "candy" ||
    raw === "neon"
  ) {
    return raw;
  }
  return DEFAULT_PREMIUM_BADGE_STYLE;
}

export function readPremiumBadgeStyle(): PremiumBadgeStyle {
  try {
    return parsePremiumBadgeStyle(localStorage.getItem(STYLE_KEY));
  } catch {
    return DEFAULT_PREMIUM_BADGE_STYLE;
  }
}

export function writePremiumBadgeStyle(id: PremiumBadgeStyle) {
  try {
    localStorage.setItem(STYLE_KEY, id);
  } catch {
    /* ignore */
  }
  // Same-tab sync (StorageEvent only fires across windows).
  window.dispatchEvent(new Event("bubtype-premium-badge-style"));
}

export function premiumBadgeGradient(style: PremiumBadgeStyle) {
  const colors =
    PREMIUM_BADGE_STYLES.find((s) => s.id === style)?.colors ??
    PREMIUM_BADGE_STYLES[0]!.colors;
  // Double the strip so translate loops cleanly (same trick as Voya STRIP).
  return [...colors, ...colors].join(", ");
}
