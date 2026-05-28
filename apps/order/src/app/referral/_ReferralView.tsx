"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Users, Share2 } from "lucide-react";

/**
 * Referral — share-and-earn screen. Port of apps/pickup-native/app
 * /referral.tsx: espresso hero with a 56×56 gold tile + 40px Peachi
 * code + Share button, a 3-up Total/Pending/Rewarded stat row, a
 * "How it works" 4-step card, and a recent-referrals list.
 *
 * Wired to /api/loyalty/me/referral (same endpoint as native's
 * fetchMyReferral).
 */
type RecentReferral = { created_at: string; status: string };

type Referral = {
  code?: string | null;
  total_referred?: number;
  pending?: number;
  rewarded?: number;
  recent?: RecentReferral[];
};

type Persisted = { state?: { sessionToken?: string | null } };

export function ReferralView() {
  const [data, setData] = useState<Referral | null>(null);

  useEffect(() => {
    let token: string | null = null;
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) token = (JSON.parse(raw) as Persisted).state?.sessionToken ?? null;
    } catch {
      /* ignore */
    }
    if (!token) return;
    fetch("/api/loyalty/me/referral", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData((d ?? null) as Referral | null))
      .catch(() => setData(null));
  }, []);

  const share = async () => {
    if (!data?.code) return;
    const message = `Try Celsius Coffee with me ☕\nUse my code ${data.code} when you sign up — we both get a free drink.\n\nhttps://order.celsiuscoffee.com`;
    try {
      if (navigator.share) {
        await navigator.share({ text: message });
      } else {
        await navigator.clipboard.writeText(data.code);
      }
    } catch {
      /* user dismissed */
    }
  };

  const recent = data?.recent ?? [];

  return (
    <>
      <header
        className="bg-[#160800] text-white px-4 pb-3 flex items-center gap-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Link href="/rewards" className="-ml-1 p-1 active:opacity-60" aria-label="Back">
          <ArrowLeft size={20} color="#FFFFFF" />
        </Link>
        <h1 className="font-peachi font-bold text-[22px]">Share &amp; Earn</h1>
      </header>

      <div className="p-4">
        {/* Hero — code + share */}
        <div
          className="flex flex-col items-center text-center"
          style={{
            backgroundColor: "#1A0200",
            borderRadius: 16,
            paddingLeft: 24,
            paddingRight: 24,
            paddingTop: 32,
            paddingBottom: 32,
            boxShadow: "0 8px 18px rgba(26,2,0,0.18)",
          }}
        >
          <span
            className="flex items-center justify-center"
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              backgroundColor: "rgba(251,191,36,0.18)",
              marginBottom: 14,
            }}
          >
            <Users size={28} color="#FBBF24" strokeWidth={1.8} />
          </span>
          <p
            className="uppercase"
            style={{
              color: "rgba(251,191,36,0.85)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 2,
              marginBottom: 8,
            }}
          >
            Your code
          </p>
          <button type="button" onClick={share} className="active:opacity-70">
            <span
              className="font-peachi font-bold"
              style={{ color: "#FBBF24", fontSize: 40, letterSpacing: 4 }}
            >
              {data?.code ?? "—"}
            </span>
          </button>
          <button
            type="button"
            onClick={share}
            disabled={!data?.code}
            className="flex items-center gap-1.5 rounded-full active:opacity-80"
            style={{
              backgroundColor: "#A2492C",
              marginTop: 20,
              paddingLeft: 20,
              paddingRight: 20,
              paddingTop: 10,
              paddingBottom: 10,
              opacity: data?.code ? 1 : 0.5,
            }}
          >
            <Share2 size={15} color="#FFFFFF" strokeWidth={2} />
            <span className="font-peachi font-bold" style={{ color: "#FFFFFF", fontSize: 14 }}>
              Share code
            </span>
          </button>
        </div>

        {/* Stats */}
        <div className="flex mt-4" style={{ gap: 8 }}>
          <StatCard label="Total" value={data?.total_referred ?? 0} />
          <StatCard label="Pending" value={data?.pending ?? 0} tone="warn" />
          <StatCard label="Rewarded" value={data?.rewarded ?? 0} tone="good" />
        </div>

        {/* How it works */}
        <div
          className="mt-4 bg-white"
          style={{
            border: "1px solid rgba(26,2,0,0.10)",
            borderRadius: 16,
            padding: 16,
            boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
          }}
        >
          <p
            className="uppercase"
            style={{ color: "#1A0200", fontSize: 12, fontWeight: 700, letterSpacing: 1.5, marginBottom: 12 }}
          >
            How it works
          </p>
          <Step n={1} text="Share your code with a friend" />
          <Step n={2} text="They sign up and enter your code" />
          <Step n={3} text="They complete their first order" />
          <Step n={4} text="Both of you get a free drink reward 🎉" last />
        </div>

        {/* Recent referrals */}
        {recent.length > 0 ? (
          <div
            className="mt-4 bg-white"
            style={{
              border: "1px solid rgba(26,2,0,0.10)",
              borderRadius: 16,
              padding: 16,
              boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
            }}
          >
            <p
              className="uppercase"
              style={{ color: "#1A0200", fontSize: 12, fontWeight: 700, letterSpacing: 1.5, marginBottom: 12 }}
            >
              Your referrals
            </p>
            {recent.slice(0, 10).map((r, i) => (
              <div
                key={i}
                className="flex items-center justify-between"
                style={{
                  paddingTop: 10,
                  paddingBottom: 10,
                  borderBottom:
                    i === Math.min(recent.length, 10) - 1
                      ? "none"
                      : "1px solid rgba(26,2,0,0.06)",
                }}
              >
                <span style={{ color: "#6B6B6B", fontSize: 13, fontWeight: 500 }}>
                  {new Date(r.created_at).toLocaleDateString("en-MY", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
                <span
                  className="rounded-full uppercase"
                  style={{
                    paddingLeft: 8,
                    paddingRight: 8,
                    paddingTop: 3,
                    paddingBottom: 3,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 0.5,
                    backgroundColor: r.status === "rewarded" ? "#E6F1DD" : "#FDF3E0",
                    color: r.status === "rewarded" ? "#2F6A18" : "#8A6614",
                  }}
                >
                  {r.status === "rewarded" ? "Rewarded" : "Pending order"}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "good" | "warn";
}) {
  const color = tone === "good" ? "#2F6A18" : tone === "warn" ? "#8A6614" : "#1A0200";
  return (
    <div
      className="flex-1 bg-white"
      style={{
        border: "1px solid rgba(26,2,0,0.10)",
        borderRadius: 16,
        padding: 12,
        boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
      }}
    >
      <p className="font-peachi font-bold" style={{ color, fontSize: 22 }}>
        {value}
      </p>
      <p
        className="uppercase"
        style={{ color: "#6B6B6B", fontSize: 10, fontWeight: 700, letterSpacing: 1.2, marginTop: 2 }}
      >
        {label}
      </p>
    </div>
  );
}

function Step({ n, text, last }: { n: number; text: string; last?: boolean }) {
  return (
    <div
      className="flex items-center"
      style={{
        paddingTop: 8,
        paddingBottom: 8,
        gap: 12,
        borderBottom: last ? "none" : "1px solid rgba(26,2,0,0.06)",
      }}
    >
      <span
        className="flex items-center justify-center flex-shrink-0"
        style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: "#FBEBE8" }}
      >
        <span className="font-peachi font-bold" style={{ color: "#A2492C", fontSize: 12 }}>
          {n}
        </span>
      </span>
      <span style={{ color: "#1A0200", fontSize: 13, fontWeight: 500 }}>{text}</span>
    </div>
  );
}
