"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, Check, Lock } from "lucide-react";

/**
 * Active weekly challenges section on /rewards. Mirrors the SPA's
 * ChallengeCard row (apps/pickup-native/app/rewards.tsx ~L400-450 +
 * components/ChallengeCard.tsx) — espresso card with gold Sparkles
 * icon, progress eyebrow, Peachi-bold title, reward summary, status
 * badge (in-progress / completed / locked).
 *
 * Wired to /api/loyalty/me/missions/active using the session token
 * from localStorage — same path as the SPA's fetchActiveMissions.
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
};

// THEME_CHALLENGE — mirrors apps/pickup-native/components/VoucherWallet.tsx
const THEME = {
  bg:        "#1A0200",
  accent:    "#FBBF24",
  fg:        "#FFFFFF",
  fgDim:     "rgba(255,255,255,0.65)",
  iconBg:    "rgba(251,191,36,0.20)",
  iconColor: "#FBBF24",
};

type Persisted = { state?: { sessionToken?: string | null } };

function progressLabel(m: Mission): string {
  // Both these goals store sen → show as RM (e.g. RM0/RM80), not raw 0/8000.
  if (m.goal_type === "single_order_total_at_least" || m.goal_type === "spend_amount") {
    return `RM${Math.floor((m.progress_current ?? 0) / 100)}/RM${Math.floor((m.goal_threshold ?? 0) / 100)}`;
  }
  return `${m.progress_current ?? 0}/${m.goal_threshold ?? 0}`;
}

export function ActiveChallenges() {
  const [missions, setMissions] = useState<Mission[] | null>(null);

  useEffect(() => {
    let token: string | null = null;
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) {
        const parsed = JSON.parse(raw) as Persisted;
        token = parsed.state?.sessionToken ?? null;
      }
    } catch {
      /* ignore */
    }
    if (!token) return;
    fetch("/api/loyalty/me/missions/active", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        const list = (Array.isArray(data) ? data : (data?.missions ?? [])) as Mission[];
        // Same sort as the SPA: ACTIVE (in-progress) first, then
        // COMPLETED (ready to claim), then LOCKED last.
        const rank = (s: string) =>
          s === "active" ? 0 : s === "completed" ? 1 : 2;
        list.sort((a, b) => rank(a.status) - rank(b.status));
        setMissions(list);
      })
      .catch(() => setMissions([]));
  }, []);

  if (!missions || missions.length === 0) return null;

  return (
    <section className="px-4 pt-4">
      <h2 className="font-peachi font-bold text-[16px] mb-3">This week&apos;s challenges</h2>
      <ul className="flex flex-col gap-2">
        {missions.map((m) => (
          <ChallengeRow key={m.assignment_id ?? m.id} mission={m} />
        ))}
      </ul>
    </section>
  );
}

function ChallengeRow({ mission }: { mission: Mission }) {
  const isDone = mission.status === "completed";
  const isExpired = mission.status === "expired";

  return (
    <li>
      <Link
        href={`/challenge/${mission.assignment_id ?? mission.id}`}
        className="flex items-start active:opacity-90"
        style={{
          backgroundColor: THEME.bg,
          border: `1px solid ${isDone ? THEME.accent : THEME.bg}`,
          borderRadius: 18,
          paddingLeft: 14,
          paddingRight: 14,
          paddingTop: 14,
          paddingBottom: 14,
          gap: 14,
          opacity: isExpired ? 0.45 : 1,
          boxShadow: "0 4px 10px rgba(0,0,0,0.12)",
        }}
      >
        <span
          className="flex items-center justify-center flex-shrink-0"
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            backgroundColor: THEME.iconBg,
          }}
        >
          {isDone ? (
            <Check size={24} color={THEME.iconColor} strokeWidth={2} />
          ) : isExpired ? (
            <Lock size={24} color={THEME.iconColor} strokeWidth={2} />
          ) : (
            <Sparkles size={24} color={THEME.iconColor} strokeWidth={2} />
          )}
        </span>
        <span className="flex-1 min-w-0">
          <span
            className="block uppercase truncate"
            style={{
              color: THEME.accent,
              fontWeight: 700,
              fontSize: 9.5,
              letterSpacing: 1.4,
              marginBottom: 3,
            }}
          >
            Challenge
            {isDone ? " · Done" : isExpired ? " · Missed" : ` · ${progressLabel(mission)}`}
          </span>
          <span
            className="block truncate"
            style={{
              color: THEME.fg,
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 17,
              lineHeight: "21px",
            }}
          >
            {mission.title}
          </span>
          {(mission.description ?? mission.reward_summary) ? (
            <span
              className="block line-clamp-2"
              style={{
                color: THEME.fgDim,
                fontSize: 12,
                lineHeight: "16px",
                marginTop: 2,
                fontWeight: 500,
              }}
            >
              {mission.description ?? mission.reward_summary}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}
