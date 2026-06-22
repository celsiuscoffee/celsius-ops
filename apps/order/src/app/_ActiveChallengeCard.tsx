"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Sparkles } from "lucide-react";

/**
 * Active Challenge teaser on the home — surfaces one of the
 * customer's 3 weekly missions, preferring the still-in-progress one.
 * Mirrors apps/pickup-native/app/index.tsx:764-845 styling: dark
 * espresso card, gold-tinted icon square, uppercase gold eyebrow with
 * progress, Peachi-bold title, reward summary, chevron.
 *
 * Renders only when:
 *   - Customer is signed in (has a sessionToken in localStorage)
 *   - /api/loyalty/me/missions/active returns at least one active mission
 *
 * Otherwise the card is hidden — no placeholder noise on the home.
 */
type Mission = {
  id: string;
  title: string;
  reward_summary?: string | null;
  status: string;
  goal_type?: string;
  goal_threshold?: number;
  progress_current?: number;
};

type Persisted = { state?: { sessionToken?: string | null } };

export function ActiveChallengeCard() {
  const [mission, setMission] = useState<Mission | null>(null);

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
        const active = list.find((m) => m.status === "active");
        setMission(active ?? null);
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  if (!mission) return null;

  const progressLabel =
    mission.goal_type === "single_order_total_at_least" || mission.goal_type === "spend_amount"
      ? `RM${Math.floor((mission.progress_current ?? 0) / 100)}/RM${Math.floor((mission.goal_threshold ?? 0) / 100)}`
      : `${mission.progress_current ?? 0}/${mission.goal_threshold ?? 0}`;

  return (
    <Link
      href={`/challenge/${mission.id}`}
      className="block mt-5 mx-4 flex items-start active:opacity-90"
      style={{
        backgroundColor: "#1A0200",
        border: "1px solid #1A0200",
        borderRadius: 18,
        paddingLeft: 14,
        paddingRight: 14,
        paddingTop: 14,
        paddingBottom: 14,
        gap: 14,
        boxShadow: "0 4px 10px rgba(0,0,0,0.12)",
      }}
    >
      <span
        className="flex items-center justify-center flex-shrink-0"
        style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          backgroundColor: "rgba(251,191,36,0.20)",
        }}
      >
        <Sparkles size={24} color="#FBBF24" strokeWidth={2} />
      </span>
      <span className="flex-1 min-w-0">
        <span
          className="block uppercase truncate"
          style={{
            color: "#FBBF24",
            fontWeight: 700,
            fontSize: 9.5,
            letterSpacing: 1.4,
            marginBottom: 3,
          }}
        >
          Challenge · {progressLabel}
        </span>
        <span
          className="block truncate"
          style={{
            color: "#FFFFFF",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 17,
            lineHeight: "21px",
          }}
        >
          {mission.title}
        </span>
        {mission.reward_summary ? (
          <span
            className="block line-clamp-2"
            style={{
              color: "rgba(255,255,255,0.65)",
              fontSize: 12,
              lineHeight: "16px",
              marginTop: 2,
              fontWeight: 500,
            }}
          >
            {mission.reward_summary}
          </span>
        ) : null}
      </span>
      <ChevronRight size={16} color="rgba(251,191,36,0.7)" strokeWidth={2} />
    </Link>
  );
}
