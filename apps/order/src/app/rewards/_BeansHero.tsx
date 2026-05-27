"use client";

import { useEffect, useState } from "react";

/**
 * Beans hero card for /rewards — port of the BeansHero function in
 * apps/pickup-native/app/rewards.tsx:447-680. Compact 110px-tall
 * horizontal card with the customer's bean balance as the protagonist
 * (Peachi-Bold 28px) and a progress line "Spend RMx in N days to
 * unlock NextTier" + thin progress bar on the right.
 *
 * Themed by tier_color at 8% / 18% alpha so each tier gets its own
 * colourway. Replaces the prior account-style TierCard on the rewards
 * screen — native uses BeansHero there, TierCard only on the Account
 * tab.
 */
type Tier = {
  tier_id?: string | null;
  tier_name?: string | null;
  tier_color?: string | null;
  tier_multiplier?: number | null;
  next_tier_id?: string | null;
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

function hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return `rgba(146, 64, 14, ${alpha})`;
  const num = parseInt(m[1], 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

  const color = tier?.tier_color || "#92400e";
  const bgFill = hexWithAlpha(color, 0.08);
  const borderFill = hexWithAlpha(color, 0.18);
  const subtle = hexWithAlpha(color, 0.7);

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
      daysLeft != null && daysLeft > 0
        ? ` in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`
        : "";
    progressText = `Spend RM${Math.round(spendToNext)}${window} to unlock ${nextName}`;
  }

  return (
    <section className="px-4 pt-4">
      <div
        className="flex items-center"
        style={{
          height: 110,
          borderRadius: 18,
          backgroundColor: bgFill,
          border: `1px solid ${borderFill}`,
          paddingLeft: 14,
          paddingRight: 14,
          paddingTop: 14,
          paddingBottom: 14,
          gap: 14,
          boxShadow: "0 4px 10px rgba(0,0,0,0.06)",
        }}
      >
        <div className="flex-shrink-0">
          <p
            className="uppercase"
            style={{ color: subtle, fontSize: 9.5, fontWeight: 700, letterSpacing: 1.4 }}
          >
            Beans
          </p>
          <p
            className="font-peachi font-bold"
            style={{
              color: "#1A0200",
              fontSize: 28,
              letterSpacing: -0.6,
              lineHeight: "32px",
              marginTop: 2,
            }}
          >
            {balance.toLocaleString()}
          </p>
        </div>

        {progressText ? (
          <div className="flex-1 min-w-0">
            <p
              className="line-clamp-2"
              style={{ color: subtle, fontSize: 12, lineHeight: "16px", fontWeight: 500 }}
            >
              {progressText}
            </p>
            {progressRatio != null ? (
              <div
                style={{
                  marginTop: 6,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: "rgba(0,0,0,0.10)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.round(progressRatio * 100)}%`,
                    height: "100%",
                    backgroundColor: color,
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
