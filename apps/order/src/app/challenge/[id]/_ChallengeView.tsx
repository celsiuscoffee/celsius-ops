"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";

/**
 * Single challenge detail — reads the full mission record from
 * /api/loyalty/me/missions/active (filtered to the assignmentId), shows
 * progress, reward, and tips. Matches the SPA's challenge detail
 * screen layout.
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
};

type Persisted = { state?: { sessionToken?: string | null } };

export function ChallengeView({ assignmentId }: { assignmentId: string }) {
  const [mission, setMission] = useState<Mission | null>(null);

  useEffect(() => {
    let token: string | null = null;
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) token = (JSON.parse(raw) as Persisted).state?.sessionToken ?? null;
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
        setMission(list.find((m) => m.assignment_id === assignmentId) ?? null);
      })
      .catch(() => {
        /* ignore */
      });
  }, [assignmentId]);

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

      {!mission ? (
        <div className="p-8 text-center text-[#8E8E93] text-sm">Loading…</div>
      ) : (
        <>
          <section className="px-4 pt-5">
            <div
              className="rounded-2xl p-5"
              style={{ backgroundColor: "#1A0200", color: "#FFFFFF" }}
            >
              <span
                className="flex items-center justify-center"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  backgroundColor: "rgba(251,191,36,0.18)",
                }}
              >
                <Sparkles size={20} color="#FBBF24" strokeWidth={1.8} />
              </span>
              <p
                className="mt-3 font-peachi font-bold text-2xl"
                style={{ letterSpacing: -0.3 }}
              >
                {mission.title}
              </p>
              {mission.description ? (
                <p className="mt-1 text-[13px] text-white/70 leading-snug">
                  {mission.description}
                </p>
              ) : null}
              {mission.reward_summary ? (
                <p
                  className="mt-3 text-[11px] uppercase tracking-widest font-bold"
                  style={{ color: "#FBBF24" }}
                >
                  Reward · {mission.reward_summary}
                </p>
              ) : null}
            </div>
          </section>

          <section className="px-4 pt-5">
            <h2 className="font-peachi font-bold text-[16px] mb-2">Progress</h2>
            <Progress mission={mission} />
          </section>

          {mission.expires_at ? (
            <p className="px-4 pt-4 text-[11px] text-[#8E8E93]">
              Ends {new Date(mission.expires_at).toLocaleDateString("en-MY", { day: "numeric", month: "short" })}
            </p>
          ) : null}
        </>
      )}
    </>
  );
}

function Progress({ mission }: { mission: Mission }) {
  const current = mission.progress_current ?? 0;
  const target = mission.goal_threshold ?? 1;
  const pct = Math.min(1, current / target);

  const display =
    mission.goal_type === "single_order_total_at_least"
      ? `RM${Math.floor(current / 100)} / RM${Math.floor(target / 100)}`
      : `${current} / ${target}`;

  return (
    <div>
      <div className="h-2.5 rounded-full bg-[#EBE5DE] overflow-hidden">
        <div
          className="h-full"
          style={{ width: `${Math.round(pct * 100)}%`, backgroundColor: "#A2492C" }}
        />
      </div>
      <p className="mt-2 text-sm font-bold">{display}</p>
    </div>
  );
}
