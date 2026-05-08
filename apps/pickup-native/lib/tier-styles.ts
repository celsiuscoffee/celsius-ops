import type { MemberTier } from "./rewards";

/**
 * Visual treatment for the per-tier hero header. Keys mirror the
 * loyalty DB slugs (`bronze` / `silver` / `gold` / `elite`) — the
 * display names ("Member" / "Silver" / "Gold" / "Platinum") flow
 * through tier_name from the API.
 */
export type TierStyle = {
  /** Display name shown as the tier wordmark in the eyebrow.
   *  Falls back to API tier_name when undefined. */
  displayName: string;
  /** 2-stop gradient for the header background — top to bottom. */
  gradient: [string, string, string?];
  /** Eyebrow color (the "PLATINUM · 2× PTS" line). */
  eyebrowColor: string;
  /** Greeting / name color (the "Hi, Ammar" + outlet text). */
  textColor: string;
  /** Muted text on the tier — used for sub-line / outlet status. */
  mutedColor: string;
  /** Gold/copper/cream accent — the points-pill ornament + tier accent. */
  accentColor: string;
  /** Background for the points pill on the right of the home header. */
  pointsPillBg: string;
  /** Color of the points number inside the pill. */
  pointsTextColor: string;
};

const FALLBACK: TierStyle = {
  displayName: "MEMBER",
  gradient: ["#160800", "#160800"],
  // Bumped eyebrow 0.45 → 0.62 and muted 0.65 → 0.78 — both were
  // borderline at 11–12pt on the brand-black panel.
  eyebrowColor: "rgba(255,255,255,0.62)",
  textColor: "#FFFFFF",
  mutedColor: "rgba(255,255,255,0.78)",
  accentColor: "#FBBF24",
  pointsPillBg: "rgba(255,255,255,0.10)",
  pointsTextColor: "#FFFFFF",
};

const STYLES: Record<string, TierStyle> = {
  // Bronze in the DB — display name is "Member" — terracotta gradient
  bronze: {
    displayName: "MEMBER",
    gradient: ["#F2A88E", "#E2725B", "#A04A35"],
    eyebrowColor: "#FFFFFF",
    textColor: "#FFFFFF",
    mutedColor: "rgba(255,255,255,0.85)",
    accentColor: "#FFFFFF",
    pointsPillBg: "rgba(255,255,255,0.20)",
    pointsTextColor: "#FFFFFF",
  },
  silver: {
    displayName: "SILVER",
    gradient: ["#F8F9FA", "#C0C0C0", "#3F4751"],
    eyebrowColor: "#1f242c",
    textColor: "#0f1419",
    mutedColor: "rgba(15,20,25,0.70)",
    accentColor: "#1f242c",
    pointsPillBg: "rgba(31,36,44,0.12)",
    pointsTextColor: "#0f1419",
  },
  gold: {
    displayName: "GOLD",
    gradient: ["#FFF8DC", "#FFD700", "#5C3A0A"],
    eyebrowColor: "#3a2208",
    textColor: "#1a0c02",
    mutedColor: "rgba(26,12,2,0.70)",
    accentColor: "#3a2208",
    pointsPillBg: "rgba(58,34,8,0.15)",
    pointsTextColor: "#1a0c02",
  },
  // Elite in the DB — display name is "Platinum" — black metallic
  elite: {
    displayName: "PLATINUM",
    gradient: ["#3A3D45", "#0A0C12", "#000000"],
    eyebrowColor: "#FBBF24",
    textColor: "#FFFFFF",
    // Bumped from 0.55 → 0.72 for WCAG AA on the obsidian gradient.
    // 0.55 was visually nice but failed contrast on the lighter top
    // stop (#3A3D45) — small text rendering as a low-contrast smudge.
    mutedColor: "rgba(255,255,255,0.72)",
    accentColor: "#FBBF24",
    pointsPillBg: "rgba(251,191,36,0.18)",
    pointsTextColor: "#FBBF24",
  },
};

/**
 * Resolve the visual treatment for the home/rewards/account hero.
 * Drops back to the espresso solid baseline when no tier is loaded
 * (signed out, fetch failed, or first launch before the API responds).
 */
export function tierStyle(tier: MemberTier | null | undefined): TierStyle {
  const slug = tier?.tier_slug ?? "";
  return STYLES[slug] ?? FALLBACK;
}

export function tierFallback(): TierStyle {
  return FALLBACK;
}
