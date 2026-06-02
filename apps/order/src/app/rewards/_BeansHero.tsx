"use client";

import { useEffect, useState } from "react";

/**
 * Points hero card for /rewards — port of the BeansHero in
 * apps/pickup-native/app/rewards.tsx. Tier-themed gradient card (same
 * gradient + brand "°c" watermark as the Account tier cards) with the
 * bean balance as the protagonist and a "Spend RMx in N days to unlock
 * {next}" progress line + thin bar.
 */
type Tier = {
  tier_slug?: string | null;
  tier_name?: string | null;
  tier_color?: string | null;
  tier_multiplier?: number | null;
  next_tier_name?: string | null;
  next_tier_min_spend?: number | null;
  spend_to_next_tier?: number | null;
  spend_this_period?: number | null;
  quarter_end?: string | null;
};

type Persisted = {
  state?: {
    loyaltyId?: string | null;
    member?: { pointsBalance?: number };
  };
};

type Theme = {
  gradTop: string;
  gradBottom: string;
  accent: string;
  subtle: string;
  watermark: string;
  dark: boolean;
};

// Same TIER_THEMES table as apps/order/src/app/account/_TierCarousel.tsx
const TIER_THEMES: Record<string, Theme> = {
  bronze:       { gradTop: "#FFF6E2", gradBottom: "#E4CFA5", accent: "#7A4B16", subtle: "rgba(73,42,7,0.62)",    watermark: "rgba(122,75,22,0.10)",  dark: false },
  silver:       { gradTop: "#F1F4F6", gradBottom: "#B6C3CC", accent: "#3F4A55", subtle: "rgba(31,38,46,0.58)",   watermark: "rgba(63,74,85,0.10)",   dark: false },
  gold:         { gradTop: "#FFF1C2", gradBottom: "#D6A55A", accent: "#6B4A0F", subtle: "rgba(63,42,4,0.62)",    watermark: "rgba(107,74,15,0.10)",  dark: false },
  elite:        { gradTop: "#241408", gradBottom: "#040201", accent: "#E8C766", subtle: "rgba(232,199,102,0.72)", watermark: "rgba(232,199,102,0.08)", dark: true },
  "arba-staff": { gradTop: "#5A1F16", gradBottom: "#1A0200", accent: "#FBBF24", subtle: "rgba(251,191,36,0.72)", watermark: "rgba(251,191,36,0.08)",  dark: true },
  "black-card": { gradTop: "#1F1916", gradBottom: "#000000", accent: "#D4B978", subtle: "rgba(212,185,120,0.70)", watermark: "rgba(212,185,120,0.08)", dark: true },
};

function themeForSlug(slug: string | null | undefined): Theme {
  return TIER_THEMES[slug ?? "bronze"] ?? TIER_THEMES.bronze;
}

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function BeansHero() {
  const [balance, setBalance] = useState(0);
  const [tier, setTier] = useState<Tier | null>(null);

  useEffect(() => {
    let memberId: string | null = null;
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) {
        const parsed = JSON.parse(raw) as Persisted;
        memberId = parsed.state?.loyaltyId ?? null;
        setBalance(parsed.state?.member?.pointsBalance ?? 0);
      }
    } catch {
      /* ignore */
    }
    if (!memberId) return;
    fetch(`/api/loyalty/member-tier?member_id=${encodeURIComponent(memberId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setTier((data ?? null) as Tier | null))
      .catch(() => {
        /* ignore */
      });
  }, []);

  const theme = themeForSlug(tier?.tier_slug);
  const numberColor = theme.dark ? theme.accent : "#1A0200";

  const nextName = tier?.next_tier_name ?? null;
  const spendToNext = Math.max(0, tier?.spend_to_next_tier ?? 0);
  const nextMin = Math.max(0, tier?.next_tier_min_spend ?? 0);
  const spent = Math.max(0, tier?.spend_this_period ?? 0);
  const daysLeft = daysUntil(tier?.quarter_end);

  let progressText: string | null = null;
  let progressRatio: number | null = null;
  if (nextName && spendToNext > 0 && nextMin > 0) {
    progressRatio = Math.max(0, Math.min(1, spent / nextMin));
    const window =
      daysLeft != null && daysLeft > 0 ? ` in ${daysLeft} day${daysLeft === 1 ? "" : "s"}` : "";
    progressText = `Spend RM${Math.round(spendToNext)}${window} to unlock ${nextName}`;
  }

  const markSize = 110 * 1.15;

  return (
    <section className="px-4 pt-4">
      <div
        className="flex items-center relative overflow-hidden"
        style={{
          height: 110,
          borderRadius: 18,
          background: `linear-gradient(160deg, ${theme.gradTop}, ${theme.gradBottom})`,
          paddingLeft: 14,
          paddingRight: 14,
          paddingTop: 14,
          paddingBottom: 14,
          gap: 14,
          boxShadow: "0 4px 10px rgba(0,0,0,0.10)",
        }}
      >
        {/* "°c" brand watermark */}
        <span
          aria-hidden
          style={{ position: "absolute", left: -markSize * 0.04, top: -markSize * 0.04, width: markSize, height: markSize, pointerEvents: "none", zIndex: 0 }}
        >
          <span
            style={{
              position: "absolute",
              left: markSize * 0.18,
              top: markSize * 0.18,
              width: markSize * 0.1,
              height: markSize * 0.1,
              borderRadius: markSize * 0.05,
              border: `${Math.max(2, markSize * 0.015)}px solid ${theme.watermark}`,
            }}
          />
          <span
            className="font-peachi font-bold"
            style={{
              position: "absolute",
              left: markSize * 0.2,
              top: markSize * 0.05,
              fontSize: markSize * 0.95,
              lineHeight: `${markSize * 0.95}px`,
              color: theme.watermark,
            }}
          >
            c
          </span>
        </span>

        <div className="flex-shrink-0" style={{ position: "relative", zIndex: 1 }}>
          <p
            className="uppercase"
            style={{ color: theme.subtle, fontSize: 9.5, fontWeight: 700, letterSpacing: 1.4 }}
          >
            Points
          </p>
          <p
            className="font-peachi font-bold"
            style={{ color: numberColor, fontSize: 28, letterSpacing: -0.6, lineHeight: "32px", marginTop: 2 }}
          >
            {balance.toLocaleString()}
          </p>
        </div>

        {progressText ? (
          <div className="flex-1 min-w-0" style={{ position: "relative", zIndex: 1 }}>
            <p
              className="line-clamp-2"
              style={{ color: theme.subtle, fontSize: 12, lineHeight: "16px", fontWeight: 500 }}
            >
              {progressText}
            </p>
            {progressRatio != null ? (
              <div
                style={{
                  marginTop: 6,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: theme.dark ? "rgba(232,199,102,0.22)" : "rgba(0,0,0,0.10)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.round(progressRatio * 100)}%`,
                    height: "100%",
                    backgroundColor: theme.accent,
                    borderRadius: 2,
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
