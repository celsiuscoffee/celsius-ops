"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lock } from "lucide-react";

/**
 * Membership tier carousel for the Account screen — port of
 * apps/pickup-native/components/TierCardCarousel.tsx. Horizontal
 * snap-scroll of every active tier as a themed hero card; the
 * customer's current tier is auto-scrolled into view and carries the
 * embedded Points / Visits / Earned stats row + progress-to-next-tier
 * line. Page-indicator dots underneath signal swipability.
 *
 * Themes (gradient + accent + subtle ink) mirror the native
 * TIER_THEMES table exactly so the cards read identically across
 * surfaces.
 */
type Tier = {
  id: string;
  slug: string;
  name: string;
  min_spend?: number | null;
  multiplier?: number | null;
  discount_percent?: number | null;
  invitation_only?: boolean | null;
  sort_order?: number | null;
};

type MemberTier = {
  tier_slug?: string | null;
  tier_id?: string | null;
  spend_this_period?: number | null;
  visits_this_period?: number | null;
  quarter_end?: string | null;
};

type Persisted = {
  state?: {
    loyaltyId?: string | null;
    member?: { pointsBalance?: number; totalVisits?: number; totalPointsEarned?: number };
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

const TIER_THEMES: Record<string, Theme> = {
  bronze:        { gradTop: "#FFF6E2", gradBottom: "#E4CFA5", accent: "#7A4B16", subtle: "rgba(73,42,7,0.62)",   watermark: "rgba(122,75,22,0.10)",  dark: false },
  silver:        { gradTop: "#F1F4F6", gradBottom: "#B6C3CC", accent: "#3F4A55", subtle: "rgba(31,38,46,0.58)",  watermark: "rgba(63,74,85,0.10)",   dark: false },
  gold:          { gradTop: "#FFF1C2", gradBottom: "#D6A55A", accent: "#6B4A0F", subtle: "rgba(63,42,4,0.62)",   watermark: "rgba(107,74,15,0.10)",  dark: false },
  elite:         { gradTop: "#241408", gradBottom: "#040201", accent: "#E8C766", subtle: "rgba(232,199,102,0.72)", watermark: "rgba(232,199,102,0.08)", dark: true },
  "arba-staff":  { gradTop: "#5A1F16", gradBottom: "#1A0200", accent: "#FBBF24", subtle: "rgba(251,191,36,0.72)", watermark: "rgba(251,191,36,0.08)",  dark: true },
  "black-card":  { gradTop: "#1F1916", gradBottom: "#000000", accent: "#D4B978", subtle: "rgba(212,185,120,0.70)", watermark: "rgba(212,185,120,0.08)", dark: true },
};

function themeForTier(slug: string): Theme {
  return TIER_THEMES[slug] ?? TIER_THEMES.bronze;
}

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

const GAP = 12;

export function TierCarousel() {
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [member, setMember] = useState<MemberTier | null>(null);
  const [stats, setStats] = useState({ points: 0, visits: 0, earned: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  // Card spans the full content width (viewport minus the 16px gutters)
  // so one tier fills the view and the next sits fully off-screen —
  // same one-card-per-page snap as native (CARD_W = SCREEN_W - 32).
  const [cardW, setCardW] = useState(330);

  // Measure the card width from the scroll container the moment it mounts.
  // The container only renders after tiers load (this component returns null
  // before that), so an on-mount effect measured a null ref and the cards
  // stayed at the 330px placeholder until a resize — the "small then big"
  // pop. A callback ref + ResizeObserver sets the real width during commit
  // (before paint) and tracks later resizes.
  const roRef = useRef<ResizeObserver | null>(null);
  const attachScroll = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    roRef.current?.disconnect();
    roRef.current = null;
    if (el) {
      const measure = () => setCardW(el.clientWidth - 32);
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      roRef.current = ro;
    }
  }, []);

  useEffect(() => {
    let memberId: string | null = null;
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) {
        const parsed = JSON.parse(raw) as Persisted;
        memberId = parsed.state?.loyaltyId ?? null;
        setStats({
          points: parsed.state?.member?.pointsBalance ?? 0,
          visits: parsed.state?.member?.totalVisits ?? 0,
          earned: parsed.state?.member?.totalPointsEarned ?? 0,
        });
      }
    } catch {
      /* ignore */
    }
    fetch("/api/loyalty/tiers")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = (d?.tiers ?? []) as Tier[];
        setTiers(list);
      })
      .catch(() => {
        /* ignore */
      });
    if (memberId) {
      fetch(`/api/loyalty/member-tier?member_id=${encodeURIComponent(memberId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          setMember((d ?? null) as MemberTier | null);
          // Live points + lifetime earned from member_brands — overrides the
          // stale localStorage snapshot the stats strip was seeded with
          // (POS/native already show this value).
          const live = d as { points_balance?: number | null; total_points_earned?: number | null } | null;
          if (live && typeof live.points_balance === "number") {
            const livePoints = live.points_balance;
            const liveEarned =
              typeof live.total_points_earned === "number" ? live.total_points_earned : null;
            setStats((s) => ({
              ...s,
              points: livePoints,
              earned: liveEarned ?? s.earned,
            }));
            // Refresh the cache so the home hero + a re-open of account stay in sync.
            try {
              const raw = window.localStorage.getItem("celsius-pickup");
              const parsed = raw ? JSON.parse(raw) : { state: {} };
              const state = parsed.state ?? {};
              state.member = {
                ...(state.member ?? {}),
                pointsBalance: livePoints,
                ...(liveEarned !== null ? { totalPointsEarned: liveEarned } : {}),
              };
              window.localStorage.setItem("celsius-pickup", JSON.stringify({ ...parsed, state }));
            } catch {
              /* ignore */
            }
          }
        })
        .catch(() => {
          /* ignore */
        });
    }
  }, []);

  const currentSlug = member?.tier_slug ?? null;
  const currentIdx = useMemo(
    () => Math.max(0, tiers.findIndex((t) => t.slug === currentSlug)),
    [tiers, currentSlug],
  );

  // Snap to the current tier once both tiers + member resolve.
  useEffect(() => {
    if (tiers.length === 0) return;
    setActiveIdx(currentIdx);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ left: currentIdx * (cardW + GAP), behavior: "auto" });
    });
  }, [tiers.length, currentIdx, cardW]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / (cardW + GAP));
    if (idx !== activeIdx && idx >= 0 && idx < tiers.length) setActiveIdx(idx);
  };

  if (tiers.length === 0) return null;

  const memberSpend = member?.spend_this_period ?? 0;
  const quarterEnd = member?.quarter_end ?? null;

  return (
    <div>
      <p
        className="uppercase px-4"
        style={{ color: "rgba(26,2,0,0.55)", fontSize: 11, fontWeight: 700, letterSpacing: 2, marginBottom: 8 }}
      >
        Membership tiers
      </p>

      <div
        ref={attachScroll}
        onScroll={onScroll}
        className="flex overflow-x-auto pb-1"
        style={{
          gap: GAP,
          paddingLeft: 16,
          paddingRight: 16,
          // scroll-padding makes each snapped card respect the 16px
          // gutter so it sits centred (16px each side) instead of
          // flush-left — otherwise scroll-snap-align:start ignores the
          // container padding for cards past the first.
          scrollPaddingLeft: 16,
          scrollSnapType: "x mandatory",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {tiers.map((t, idx) => {
          const nextEarned =
            idx === currentIdx
              ? tiers.slice(idx + 1).find((n) => !n.invitation_only) ?? null
              : null;
          return (
            <TierHeroCard
              key={t.id}
              tier={t}
              width={cardW}
              isCurrent={idx === currentIdx}
              isLocked={idx > currentIdx}
              isAchieved={idx < currentIdx}
              memberSpend={memberSpend}
              quarterEnd={quarterEnd}
              nextTier={nextEarned}
              stats={idx === currentIdx ? stats : undefined}
            />
          );
        })}
      </div>

      {/* Page indicator dots */}
      <div className="flex items-center justify-center" style={{ gap: 6, marginTop: 12 }}>
        {tiers.map((_, idx) => (
          <span
            key={idx}
            style={{
              width: idx === activeIdx ? 14 : 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: idx === activeIdx ? "#160800" : "rgba(26,2,0,0.18)",
              transition: "width 0.2s",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function TierHeroCard({
  tier,
  width,
  isCurrent,
  isLocked,
  isAchieved,
  memberSpend,
  quarterEnd,
  nextTier,
  stats,
}: {
  tier: Tier;
  width: number;
  isCurrent: boolean;
  isLocked: boolean;
  isAchieved: boolean;
  memberSpend: number;
  quarterEnd: string | null;
  nextTier: Tier | null;
  stats?: { points: number; visits: number; earned: number };
}) {
  const theme = themeForTier(tier.slug);
  const targetSpend = isCurrent ? Number(nextTier?.min_spend ?? 0) : Number(tier.min_spend ?? 0);
  const ringgitAway = Math.max(0, targetSpend - memberSpend);
  const progressPct = targetSpend > 0 ? Math.min(1, memberSpend / targetSpend) : 0;
  const daysLeft = daysUntil(quarterEnd);
  const windowClause =
    daysLeft != null && daysLeft > 0 ? `in ${daysLeft} day${daysLeft === 1 ? "" : "s"}` : "this quarter";

  const trackBg = theme.dark ? "rgba(232,199,102,0.22)" : "rgba(0,0,0,0.10)";
  const dividerBg = theme.dark ? "rgba(232,199,102,0.22)" : "rgba(0,0,0,0.08)";

  const cardHeight = isCurrent && stats ? 232 : 192;
  const markSize = cardHeight * 1.15;

  return (
    <div
      className="flex-shrink-0 flex flex-col justify-between relative overflow-hidden"
      style={{
        width,
        minHeight: cardHeight,
        borderRadius: 18,
        padding: 18,
        background: `linear-gradient(160deg, ${theme.gradTop}, ${theme.gradBottom})`,
        opacity: isLocked ? 0.92 : 1,
        boxShadow: "0 4px 10px rgba(0,0,0,0.10)",
        scrollSnapAlign: "start",
      }}
    >
      {/* Giant "°c" brand watermark behind the content — same mark as
          native's CelsiusWordmark, theme-tinted at low opacity. */}
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

      <div style={{ position: "relative", zIndex: 1 }}>
        {/* Status badge */}
        {isCurrent ? (
          <span
            className="inline-block uppercase"
            style={{
              backgroundColor: theme.accent,
              color: theme.dark ? "#1A0A00" : "#FFFFFF",
              paddingLeft: 8,
              paddingRight: 8,
              paddingTop: 3,
              paddingBottom: 3,
              borderRadius: 6,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1.5,
            }}
          >
            My tier
          </span>
        ) : isAchieved ? (
          <span
            className="uppercase"
            style={{ color: theme.subtle, fontSize: 10, fontWeight: 700, letterSpacing: 1.5 }}
          >
            Unlocked
          </span>
        ) : (
          <span className="inline-flex items-center" style={{ gap: 4 }}>
            <Lock size={11} color={theme.subtle} />
            <span
              className="uppercase"
              style={{ color: theme.subtle, fontSize: 10, fontWeight: 700, letterSpacing: 1.5 }}
            >
              Locked
            </span>
          </span>
        )}

        <p
          className="font-peachi font-bold truncate"
          style={{ color: theme.accent, fontSize: 26, lineHeight: "30px", marginTop: 8 }}
        >
          {tier.name}
        </p>
        <p
          className="font-peachi font-bold truncate"
          style={{ color: theme.accent, fontSize: 20, lineHeight: "24px", marginTop: 6 }}
        >
          {Number(tier.discount_percent ?? 0) > 0
            ? `${tier.discount_percent}% off every order`
            : "Earn beans on every visit"}
        </p>
      </div>

      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ width: "62%" }}>
          {isCurrent ? (
            <>
              <div style={{ height: 6, borderRadius: 3, backgroundColor: trackBg, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.round(progressPct * 100)}%`,
                    backgroundColor: theme.accent,
                    borderRadius: 3,
                  }}
                />
              </div>
              {nextTier && ringgitAway > 0 ? (
                <p
                  style={{ color: theme.subtle, fontSize: 12, lineHeight: "16px", marginTop: 6, fontWeight: 500 }}
                >
                  Spend RM{ringgitAway.toFixed(0)} {windowClause} to unlock {nextTier.name}
                </p>
              ) : null}
            </>
          ) : isLocked ? (
            tier.invitation_only ? (
              <p style={{ color: theme.subtle, fontSize: 12, lineHeight: "16px", fontWeight: 500 }}>
                By invitation only —{" "}
                <span style={{ color: theme.accent, fontWeight: 700 }}>
                  {tier.slug === "black-card" ? "Investors" : "Staff"}
                </span>
              </p>
            ) : (
              <p style={{ color: theme.subtle, fontSize: 12, lineHeight: "16px", fontWeight: 500 }}>
                Spend <span style={{ color: theme.accent, fontWeight: 700 }}>RM{ringgitAway.toFixed(0)}</span>{" "}
                <span style={{ color: theme.accent, fontWeight: 700 }}>{windowClause}</span> to unlock
              </p>
            )
          ) : (
            <p style={{ color: theme.subtle, fontSize: 12, fontWeight: 500 }}>Achieved · perks unlocked</p>
          )}
        </div>

        {/* Embedded stats — current card only */}
        {isCurrent && stats ? (
          <div
            className="flex items-center"
            style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${dividerBg}` }}
          >
            <StatCell label="Points" value={stats.points.toLocaleString()} theme={theme} />
            <StatDivider color={dividerBg} />
            <StatCell label="Visits" value={String(stats.visits)} theme={theme} />
            <StatDivider color={dividerBg} />
            <StatCell label="Earned" value={stats.earned.toLocaleString()} theme={theme} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatCell({ label, value, theme }: { label: string; value: string; theme: Theme }) {
  return (
    <div className="flex-1">
      <p className="font-peachi font-bold" style={{ color: theme.accent, fontSize: 18, lineHeight: "20px" }}>
        {value}
      </p>
      <p
        className="uppercase"
        style={{ color: theme.subtle, fontSize: 9, fontWeight: 700, letterSpacing: 1, marginTop: 2 }}
      >
        {label}
      </p>
    </div>
  );
}

function StatDivider({ color }: { color: string }) {
  return <span style={{ width: 1, height: 28, backgroundColor: color, marginLeft: 8, marginRight: 8 }} />;
}
