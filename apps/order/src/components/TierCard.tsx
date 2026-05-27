"use client";

import { useEffect, useState } from "react";

/**
 * Tier hero card — port of apps/pickup-native/components/TierCard.tsx.
 * Tier-colour rail across the top, 48×48 tile with emoji icon, tier
 * name in 20px bold tier-colour, multiplier pill on the right, and a
 * progress strip showing visits-or-spend toward the next tier.
 *
 * Pulls tier from /api/loyalty/member-tier with the member id stored
 * in the persisted Zustand state. Renders nothing if no tier info is
 * available (guest, new member, API miss).
 */
type Tier = {
  tier_id?: string | null;
  tier_name?: string | null;
  tier_color?: string | null;
  tier_icon?: string | null;
  tier_multiplier?: number | null;
  next_tier_id?: string | null;
  next_tier_name?: string | null;
  next_tier_min_visits?: number | null;
  next_tier_min_spend?: number | null;
  visits_this_period?: number | null;
  spend_this_period?: number | null;
  visits_to_next_tier?: number | null;
  spend_to_next_tier?: number | null;
};

type Persisted = {
  state?: {
    loyaltyId?: string | null;
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

export function TierCard() {
  const [tier, setTier] = useState<Tier | null>(null);

  useEffect(() => {
    let memberId: string | null = null;
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) {
        memberId = (JSON.parse(raw) as Persisted).state?.loyaltyId ?? null;
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

  if (!tier || !tier.tier_name) return null;

  const color = tier.tier_color || "#92400e";
  const icon = tier.tier_icon || "☕";
  const name = tier.tier_name;
  const mul = tier.tier_multiplier ?? 1;

  const visitsTotal = tier.next_tier_min_visits ?? 0;
  const visitsCurrent = tier.visits_this_period ?? 0;
  const visitsPct = visitsTotal > 0 ? Math.min(visitsCurrent / visitsTotal, 1) : 0;

  const spendTotal = tier.next_tier_min_spend ?? 0;
  const spendCurrent = tier.spend_this_period ?? 0;
  const spendPct = spendTotal > 0 ? Math.min(spendCurrent / spendTotal, 1) : 0;

  const useSpendBar = spendPct > visitsPct && spendTotal > 0;
  const progressPct = tier.next_tier_id ? (useSpendBar ? spendPct : visitsPct) : 1;

  const bgFill = hexWithAlpha(color, 0.08);
  const borderFill = hexWithAlpha(color, 0.18);
  const tileFill = hexWithAlpha(color, 0.18);
  const trackFill = hexWithAlpha(color, 0.15);

  return (
    <section className="px-4 pt-4">
      <div
        style={{
          borderRadius: 16,
          overflow: "hidden",
          backgroundColor: bgFill,
          border: `1px solid ${borderFill}`,
        }}
      >
        {/* Top tier-colour rail */}
        <div style={{ height: 4, backgroundColor: color }} />

        <div style={{ paddingLeft: 20, paddingRight: 20, paddingTop: 16, paddingBottom: 18 }}>
          {/* Header row — tile + tier name + multiplier pill */}
          <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
            <div className="flex items-center">
              <span
                className="flex items-center justify-center"
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  backgroundColor: tileFill,
                  marginRight: 12,
                }}
              >
                <span style={{ fontSize: 26, lineHeight: 1 }}>{icon}</span>
              </span>
              <div>
                <p
                  style={{
                    fontSize: 10,
                    letterSpacing: 1.5,
                    textTransform: "uppercase",
                    color: hexWithAlpha(color, 0.7),
                    fontWeight: 600,
                  }}
                >
                  Your tier
                </p>
                <p
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color,
                    marginTop: 2,
                  }}
                >
                  {name}
                </p>
              </div>
            </div>
            <span
              style={{
                backgroundColor: color,
                paddingLeft: 10,
                paddingRight: 10,
                paddingTop: 4,
                paddingBottom: 4,
                borderRadius: 999,
                color: "white",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {mul}× pts
            </span>
          </div>

          {/* Progress strip */}
          {tier.next_tier_id ? (
            <div>
              <div className="flex justify-between" style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: "rgba(0,0,0,0.65)" }}>
                  {useSpendBar
                    ? `RM${Math.round(spendCurrent)} / RM${spendTotal}`
                    : `${visitsCurrent} / ${visitsTotal} visits`}
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color }}>
                  → {tier.next_tier_name}
                </span>
              </div>
              <div
                style={{
                  height: 6,
                  borderRadius: 999,
                  backgroundColor: trackFill,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: 6,
                    width: `${Math.round(progressPct * 100)}%`,
                    backgroundColor: color,
                    borderRadius: 999,
                  }}
                />
              </div>
              <p style={{ fontSize: 11, color: "rgba(0,0,0,0.55)", marginTop: 8 }}>
                {useSpendBar
                  ? `RM${(tier.spend_to_next_tier ?? 0).toFixed(0)} more to unlock`
                  : `${tier.visits_to_next_tier ?? 0} more visit${
                      (tier.visits_to_next_tier ?? 0) === 1 ? "" : "s"
                    } to unlock`}
              </p>
            </div>
          ) : (
            <p style={{ fontSize: 13, fontWeight: 700, color }}>
              👑 You&apos;ve reached the top tier
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
