"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Sparkles, Gift, Target, Coffee, Cookie, Tag } from "lucide-react";

/**
 * Single challenge detail — port of apps/pickup-native/app/challenge
 * /[id]/index.tsx. Espresso hero card + gold reward callout + white
 * progress card (big Peachi label + bar) + "How it works" rule list +
 * time-remaining footer. Reads the mission from /api/loyalty/me
 * /missions/active filtered to the assignmentId.
 */
type Mission = {
  assignment_id: string;
  id: string;
  title: string;
  description?: string | null;
  reward_summary?: string | null;
  status: string;
  goal_type?: string;
  goal_threshold?: number;
  progress_current?: number;
  expires_at?: string | null;
  week_end_at?: string | null;
};

type Persisted = { state?: { sessionToken?: string | null } };

// THEME_CHALLENGE — apps/pickup-native/components/VoucherWallet.tsx
const THEME = {
  bg: "#1A0200",
  accent: "#FBBF24",
  fg: "#FFFFFF",
  fgDim: "rgba(255,255,255,0.65)",
  iconBg: "rgba(251,191,36,0.20)",
  iconColor: "#FBBF24",
};

function progressLabel(m: Mission): string {
  const cur = m.progress_current ?? 0;
  const goal = m.goal_threshold ?? 0;
  if (m.goal_type === "single_order_total_at_least") {
    return `RM${Math.floor(cur / 100)} of RM${Math.floor(goal / 100)}`;
  }
  return `${cur} of ${goal}`;
}

function remainingHint(m: Mission): string {
  const remaining = Math.max(0, (m.goal_threshold ?? 0) - (m.progress_current ?? 0));
  if (remaining === 0) return "You're done — claim your reward!";
  if (m.goal_type === "single_order_total_at_least") {
    return `RM${Math.ceil(remaining / 100)} more to unlock`;
  }
  return remaining === 1 ? "1 more to unlock" : `${remaining} more to unlock`;
}

function expiryCopy(iso: string | null | undefined): { label: string; urgent: boolean } | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return { label: "Challenge ended", urgent: true };
  const hours = Math.ceil(ms / (1000 * 60 * 60));
  if (hours <= 24) return { label: `Ends in ${hours}h`, urgent: true };
  const days = Math.ceil(hours / 24);
  return { label: `Ends in ${days}d`, urgent: days <= 1 };
}

function howToWin(m: Mission): string[] {
  const goal = m.goal_threshold ?? 0;
  switch (m.goal_type) {
    case "single_order_total_at_least":
      return [
        `Spend at least RM${Math.floor(goal / 100)} in a single order.`,
        "Add-ons, sides and pastries all count toward the total.",
        "Discounts and vouchers don't reduce the qualifying amount.",
      ];
    case "drinks_count":
    case "cups_count":
      return [
        `Order ${goal} drinks before the challenge ends.`,
        "Drinks can be on the same order or split across visits.",
        "Both hot and iced count.",
      ];
    case "distinct_products":
    case "distinct_drinks_count":
      return [
        `Try ${goal} different items you haven't ordered before.`,
        "We only count the first time you ever buy a given item.",
        "Both drinks and food count unless the description says otherwise.",
      ];
    case "single_order_items_count":
      return [
        `Order ${goal}+ items in a single transaction.`,
        "Each individual cup or plate counts as one item.",
        "Mix and match across drinks and food.",
      ];
    case "drink_and_food":
      return [
        "Order at least one drink and one food item in the same order.",
        "Roti bakar, pastries and cakes all count as food.",
      ];
    default:
      return m.description ? [m.description] : [];
  }
}

// Returns the rendered element (not the component) so render never
// derives a component type from a function call — keeps the selection
// among the static lucide imports visible to react-hooks lint.
function rewardIcon(label?: string | null) {
  const s = (label ?? "").toLowerCase();
  const Ico = /free|drink|coffee|latte|brew/.test(s) ? Coffee
    : /cookie|pastry|cake|food/.test(s) ? Cookie
    : /rm|%|off|discount/.test(s) ? Tag
    : Gift;
  return <Ico size={32} color={THEME.iconColor} strokeWidth={2} />;
}

export function ChallengeView({ assignmentId }: { assignmentId: string }) {
  const [mission, setMission] = useState<Mission | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let token: string | null = null;
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) token = (JSON.parse(raw) as Persisted).state?.sessionToken ?? null;
    } catch {
      /* ignore */
    }
    if (!token) {
      setLoaded(true);
      return;
    }
    fetch("/api/loyalty/me/missions/active", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        const list = (Array.isArray(data) ? data : (data?.missions ?? [])) as Mission[];
        setMission(list.find((m) => (m.assignment_id ?? m.id) === assignmentId) ?? null);
      })
      .catch(() => {
        /* ignore */
      })
      .finally(() => setLoaded(true));
  }, [assignmentId]);

  const isCompleted = mission?.status === "completed";
  const isExpired = mission?.status === "expired";
  const ratio = mission
    ? Math.min(1, (mission.progress_current ?? 0) / Math.max(1, mission.goal_threshold ?? 1))
    : 0;
  const rewardIconEl = rewardIcon(mission?.reward_summary);
  const expiry = expiryCopy(mission?.week_end_at ?? mission?.expires_at);
  const rules = mission ? howToWin(mission) : [];

  return (
    <>
      <header
        className="bg-[#160800] text-white px-4 pb-3 flex items-center gap-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Link href="/rewards" className="-ml-1 p-1 active:opacity-60" aria-label="Back">
          <ArrowLeft size={20} color="#FFFFFF" />
        </Link>
        <h1 className="font-peachi font-bold text-[22px] truncate">Challenge</h1>
      </header>

      {!loaded ? (
        <div className="p-8 text-center text-[#8E8E93] text-sm">Loading…</div>
      ) : !mission ? (
        <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
          <p className="font-peachi font-bold text-xl" style={{ color: "#1A0200" }}>
            Challenge not found
          </p>
          <p className="mt-2 text-sm" style={{ color: "rgba(26,2,0,0.65)" }}>
            It may have already expired or rolled over to a new week.
          </p>
          <Link
            href="/rewards"
            className="mt-6 rounded-full bg-[#A2492C] text-white px-5 py-3 font-bold active:opacity-80"
          >
            Back to rewards
          </Link>
        </div>
      ) : (
        <div className="px-4">
          {/* Hero card */}
          <div
            className="relative overflow-hidden"
            style={{
              marginTop: 16,
              borderRadius: 22,
              backgroundColor: THEME.bg,
              border: `1px solid ${isCompleted ? THEME.accent : THEME.bg}`,
              opacity: isExpired ? 0.55 : 1,
              padding: 20,
            }}
          >
            <div className="flex items-center" style={{ gap: 14 }}>
              <span
                className="flex items-center justify-center flex-shrink-0"
                style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: THEME.iconBg }}
              >
                {rewardIconEl}
              </span>
              <div className="flex-1 min-w-0">
                <p
                  className="uppercase"
                  style={{ color: THEME.accent, fontSize: 10, fontWeight: 700, letterSpacing: 1.6 }}
                >
                  Challenge{isCompleted ? " · Done" : isExpired ? " · Missed" : ""}
                </p>
                <p
                  className="font-peachi font-bold"
                  style={{ color: THEME.fg, fontSize: 22, lineHeight: "26px", marginTop: 3 }}
                >
                  {mission.title}
                </p>
              </div>
            </div>
            {mission.description ? (
              <p style={{ color: THEME.fgDim, fontSize: 14, lineHeight: "20px", marginTop: 16, fontWeight: 500 }}>
                {mission.description}
              </p>
            ) : null}
          </div>

          {/* Reward callout */}
          {mission.reward_summary ? (
            <div
              className="flex items-center"
              style={{
                marginTop: 14,
                borderRadius: 18,
                backgroundColor: "#FFFBEA",
                border: "1px solid rgba(217,148,4,0.30)",
                padding: 16,
                gap: 12,
              }}
            >
              <span
                className="flex items-center justify-center flex-shrink-0"
                style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: "rgba(217,148,4,0.18)" }}
              >
                <Gift size={22} color="#D99404" strokeWidth={2.2} />
              </span>
              <div className="flex-1 min-w-0">
                <p
                  className="uppercase"
                  style={{ color: "#A37200", fontSize: 10, fontWeight: 700, letterSpacing: 1.4 }}
                >
                  {isCompleted ? "You earned" : "You'll earn"}
                </p>
                <p
                  className="font-peachi font-bold"
                  style={{ color: "#1A0200", fontSize: 17, lineHeight: "22px", marginTop: 2 }}
                >
                  {mission.reward_summary}
                </p>
              </div>
            </div>
          ) : null}

          {/* Progress */}
          <div
            style={{
              marginTop: 14,
              borderRadius: 18,
              backgroundColor: "#FFFFFF",
              border: "1px solid rgba(0,0,0,0.06)",
              padding: 16,
            }}
          >
            <div className="flex items-center" style={{ gap: 8 }}>
              <Target size={16} color="#1A0200" strokeWidth={2.4} />
              <span
                className="uppercase"
                style={{ color: "#1A0200", fontSize: 10.5, fontWeight: 700, letterSpacing: 1.4 }}
              >
                Your progress
              </span>
            </div>
            <p
              className="font-peachi font-bold"
              style={{ color: "#1A0200", fontSize: 28, lineHeight: "32px", marginTop: 10 }}
            >
              {progressLabel(mission)}
            </p>
            <p
              style={{
                fontSize: 12,
                marginTop: 2,
                fontWeight: 500,
                color: isCompleted ? "#1F7A33" : "rgba(26,2,0,0.55)",
              }}
            >
              {isExpired ? "This challenge has ended." : remainingHint(mission)}
            </p>
            <div
              style={{
                marginTop: 12,
                height: 8,
                borderRadius: 4,
                backgroundColor: "rgba(0,0,0,0.08)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.round(ratio * 100)}%`,
                  height: "100%",
                  backgroundColor: isCompleted ? "#1F7A33" : "#D99404",
                  borderRadius: 4,
                }}
              />
            </div>
          </div>

          {/* How it works */}
          {rules.length > 0 ? (
            <div
              style={{
                marginTop: 14,
                borderRadius: 18,
                backgroundColor: "#FFFFFF",
                border: "1px solid rgba(0,0,0,0.06)",
                padding: 16,
              }}
            >
              <div className="flex items-center" style={{ gap: 8 }}>
                <Sparkles size={16} color="#1A0200" strokeWidth={2.4} />
                <span
                  className="uppercase"
                  style={{ color: "#1A0200", fontSize: 10.5, fontWeight: 700, letterSpacing: 1.4 }}
                >
                  How it works
                </span>
              </div>
              <div style={{ marginTop: 10 }} className="flex flex-col gap-2">
                {rules.map((line, idx) => (
                  <div key={idx} className="flex items-start" style={{ gap: 8 }}>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: "#D99404",
                        marginTop: 7,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ color: "rgba(26,2,0,0.80)", fontSize: 13.5, lineHeight: "20px", fontWeight: 500 }}>
                      {line}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Time remaining */}
          {expiry ? (
            <p
              className="text-center"
              style={{
                marginTop: 14,
                fontSize: 12,
                fontWeight: 600,
                color: expiry.urgent ? "#B91C1C" : "#8E8E93",
              }}
            >
              {expiry.label}
            </p>
          ) : null}
          <div className="h-8" />
        </div>
      )}
    </>
  );
}
