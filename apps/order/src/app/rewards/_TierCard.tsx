"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

/**
 * Tier card for the rewards screen. Mirrors the SPA's TierCardCarousel
 * styling (apps/pickup-native/components/TierCard.tsx) for the
 * customer's current tier — espresso card with tier name in Peachi
 * bold, beans count + multiplier eyebrow, soft Sparkles glyph.
 *
 * Fetches /api/loyalty/member-tier with the member id from
 * localStorage. Falls back to a plain beans card when no tier info is
 * available (guest, new member, API miss).
 */
type Tier = {
  tier_name?: string | null;
  tier_multiplier?: number | null;
  current_beans?: number | null;
  next_tier_beans?: number | null;
  next_tier_name?: string | null;
};

type Persisted = {
  state?: {
    loyaltyId?: string | null;
    member?: { pointsBalance?: number };
  };
};

export function TierCard() {
  const [beans, setBeans] = useState<number | null>(null);
  const [tier, setTier] = useState<Tier | null>(null);

  useEffect(() => {
    let memberId: string | null = null;
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) {
        const parsed = JSON.parse(raw) as Persisted;
        memberId = parsed.state?.loyaltyId ?? null;
        setBeans(parsed.state?.member?.pointsBalance ?? 0);
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

  const displayBeans = tier?.current_beans ?? beans ?? 0;
  const progress =
    tier?.current_beans != null && tier.next_tier_beans
      ? Math.min(1, tier.current_beans / tier.next_tier_beans)
      : null;

  return (
    <section className="px-4 pt-4">
      <div
        className="bg-[#160800] text-white rounded-2xl p-5"
        style={{ minHeight: 140, position: "relative", overflow: "hidden" }}
      >
        <div className="flex items-start gap-3">
          <span
            className="flex items-center justify-center"
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: "rgba(251,191,36,0.18)",
            }}
          >
            <Sparkles size={18} color="#FBBF24" strokeWidth={1.8} />
          </span>
          {tier?.tier_name ? (
            <span
              className="ml-auto rounded-full px-2.5 py-1 text-[10px] uppercase font-bold tracking-widest"
              style={{ backgroundColor: "rgba(251,191,36,0.18)", color: "#FBBF24" }}
            >
              {tier.tier_name}
              {tier.tier_multiplier && tier.tier_multiplier > 1
                ? ` · ${tier.tier_multiplier}×`
                : ""}
            </span>
          ) : null}
        </div>
        <p className="mt-3 text-[10px] uppercase tracking-widest text-white/60">Beans</p>
        <p className="mt-1 font-peachi font-bold text-3xl leading-none">
          {displayBeans.toLocaleString()}
        </p>

        {progress != null ? (
          <div className="mt-4">
            <div className="h-1.5 rounded-full bg-white/12 overflow-hidden">
              <div
                className="h-full bg-[#FBBF24]"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] text-white/65">
              {tier?.next_tier_beans! - tier?.current_beans!}
              {" beans to "}
              {tier?.next_tier_name ?? "next tier"}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
