import type { CSSProperties } from "react";
import {
  DEFAULT_PREMIUM_BADGE_STYLE,
  premiumBadgeGradient,
  type PremiumBadgeStyle,
} from "./premiumBadgeStyles";
import "./premium-badge.css";

type Props = {
  label: string;
  /** false = not Pro — flat gray chip, no shimmer */
  active?: boolean;
  styleId?: PremiumBadgeStyle;
  size?: "sm" | "md";
  className?: string;
};

/** Voya-style VIP chip: sliding gradient strip under white label. */
export function PremiumBadge({
  label,
  active = true,
  styleId = DEFAULT_PREMIUM_BADGE_STYLE,
  size = "md",
  className,
}: Props) {
  const gradient = premiumBadgeGradient(styleId);
  return (
    <span
      className={[
        "premium-badge",
        size === "sm" ? "sm" : "",
        active ? "active" : "dim",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ ["--premium-strip" as string]: gradient } as CSSProperties}
    >
      {active ? <span className="premium-badge-strip" aria-hidden /> : null}
      <span className="premium-badge-label">{label}</span>
    </span>
  );
}
