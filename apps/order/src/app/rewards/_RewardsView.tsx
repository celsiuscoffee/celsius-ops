"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Gift, Sparkles } from "lucide-react";
import { BeansHero } from "./_BeansHero";
import { ActiveChallenges } from "./_ActiveChallenges";
import { Claimables } from "./_Claimables";

type Persisted = {
  state?: {
    phone?: string | null;
    member?: { name?: string | null; pointsBalance?: number };
  };
};

type Reward = {
  id: string;
  name: string;
  description?: string;
  beans_cost?: number;
};

export function RewardsView() {
  const [phone, setPhone] = useState<string | null>(null);
  const [beans, setBeans] = useState(0);
  const [rewards, setRewards] = useState<Reward[] | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) {
        const parsed = JSON.parse(raw) as Persisted;
        setPhone(parsed.state?.phone ?? null);
        setBeans(parsed.state?.member?.pointsBalance ?? 0);
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!phone) return;
    fetch(`/api/loyalty/rewards?phone=${encodeURIComponent(phone)}`)
      .then((r) => r.json())
      .then((data) => setRewards((data?.rewards ?? []) as Reward[]))
      .catch(() => setRewards([]));
  }, [phone]);

  return (
    <>
      <header
        className="bg-[#160800] text-white px-4 pb-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <h1
          className="text-[22px]"
          style={{ fontFamily: "Peachi-Bold, serif", letterSpacing: -0.3, fontWeight: 700 }}
        >
          Rewards
        </h1>
      </header>

      {/* Beans hero — compact themed card with the customer's bean
          balance + progress-to-next-tier line. Mirrors the BeansHero
          on apps/pickup-native/app/rewards.tsx (rewards page uses the
          compact hero; the larger TierCard lives on /account). */}
      <BeansHero />

      {/* Claimable offers (one-tap welcome / promo / mystery). */}
      <Claimables />

      {/* This week's challenges (3 weekly missions). */}
      <ActiveChallenges />

      {!hydrated ? null : !phone ? (
        <div className="flex flex-col items-center px-6 py-12">
          <Gift size={48} color="#8E8E93" strokeWidth={1.25} />
          <p
            className="mt-4 text-base"
            style={{ fontFamily: "Peachi-Bold, serif", fontWeight: 700 }}
          >
            Sign in to claim rewards
          </p>
          <p className="text-sm text-[#6E6E73] mt-1 text-center">
            Earn beans on every order. Trade beans for free drinks.
          </p>
          <Link
            href="/account"
            className="mt-6 rounded-full bg-[#A2492C] text-white px-5 py-3 font-bold active:opacity-80"
          >
            Sign in
          </Link>
        </div>
      ) : rewards === null ? (
        <div className="p-8 text-center text-[#8E8E93] text-sm">Loading…</div>
      ) : rewards.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-12">
          <Sparkles size={48} color="#8E8E93" strokeWidth={1.25} />
          <p
            className="mt-4 text-base"
            style={{ fontFamily: "Peachi-Bold, serif", fontWeight: 700 }}
          >
            No rewards available yet
          </p>
          <p className="text-sm text-[#6E6E73] mt-1 text-center">
            Keep ordering — rewards unlock as you earn beans.
          </p>
        </div>
      ) : (
        <ul className="px-4 py-4 flex flex-col gap-3">
          {rewards.map((r) => (
            <li
              key={r.id}
              className="bg-white rounded-2xl border border-[#EBE5DE] p-4"
              style={{ boxShadow: "0 2px 6px rgba(0,0,0,0.04)" }}
            >
              <p
                className="text-base"
                style={{ fontFamily: "Peachi-Bold, serif", fontWeight: 700 }}
              >
                {r.name}
              </p>
              {r.description ? (
                <p className="text-[12px] text-[#6E6E73] mt-1">{r.description}</p>
              ) : null}
              {r.beans_cost ? (
                <p className="mt-2 text-sm text-[#A2492C] font-bold">
                  {r.beans_cost.toLocaleString()} beans
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
