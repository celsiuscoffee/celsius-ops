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

type Persisted = { state?: { sessionToken?: string | null } };

function progressLabel(m: Mission): string {
  if (m.goal_type === "single_order_total_at_least") {
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
  const isLocked = mission.status === "locked";
  const accent = isDone ? "#22C55E" : isLocked ? "#8E8E93" : "#FBBF24";

  return (
    <li>
      <Link
        href="/rewards"
        className="flex items-center gap-3 rounded-2xl active:opacity-90"
        style={{
          backgroundColor: "#1A0200",
          padding: 14,
          opacity: isLocked ? 0.7 : 1,
          boxShadow: "0 4px 10px rgba(22,8,0,0.18)",
        }}
      >
        <span
          className="flex items-center justify-center flex-shrink-0"
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: `${accent}2D`,
          }}
        >
          {isDone ? (
            <Check size={20} color={accent} strokeWidth={2} />
          ) : isLocked ? (
            <Lock size={20} color={accent} strokeWidth={1.8} />
          ) : (
            <Sparkles size={20} color={accent} strokeWidth={1.8} />
          )}
        </span>
        <span className="flex-1 min-w-0">
          <span
            className="block uppercase truncate"
            style={{ color: accent, fontWeight: 700, fontSize: 9.5, letterSpacing: 1.4 }}
          >
            {isDone ? "Ready to claim" : isLocked ? "Locked" : `Active · ${progressLabel(mission)}`}
          </span>
          <span
            className="block text-white truncate mt-0.5"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 15,
              letterSpacing: -0.3,
            }}
          >
            {mission.title}
          </span>
          {mission.reward_summary ? (
            <span
              className="block truncate"
              style={{ color: "rgba(255,255,255,0.65)", fontSize: 11, marginTop: 1, fontWeight: 500 }}
            >
              {mission.reward_summary}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}
