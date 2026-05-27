"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

/**
 * Hi-[name] / BEANS / REWARDS card. Reads the SPA's persisted Zustand
 * state from localStorage (key "celsius-pickup", set by
 * apps/pickup-native/lib/store.ts). No network round-trip on the
 * critical-path render — the card just hydrates with whatever the SPA
 * last persisted on the customer's device.
 *
 * For first-time visitors (no persisted state) it falls back to a
 * guest-style prompt that links to /account to sign in.
 */
type Persisted = {
  state?: {
    member?: { name?: string | null; pointsBalance?: number };
    phone?: string | null;
  };
};

export function MemberBeansCard() {
  const [name, setName] = useState<string | null>(null);
  const [beans, setBeans] = useState<number | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (!raw) {
        setSignedIn(false);
        return;
      }
      const parsed = JSON.parse(raw) as Persisted;
      const s = parsed.state ?? {};
      setSignedIn(!!s.phone);
      setName(s.member?.name ?? null);
      setBeans(s.member?.pointsBalance ?? null);
    } catch {
      setSignedIn(false);
    }
  }, []);

  if (signedIn === null) {
    // Server-rendered + client-hydrating: render a stable placeholder
    // shape so there's no layout shift between SSR and hydration.
    return (
      <div className="bg-[#160800] rounded-2xl p-4 h-[88px]" aria-hidden />
    );
  }

  if (!signedIn) {
    return (
      <Link
        href="/account"
        className="block bg-[#160800] rounded-2xl p-4 text-white active:opacity-80"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">🎁</span>
          <div className="flex-1">
            <p className="font-bold text-sm">Sign in for a free drink</p>
            <p className="text-[11px] text-white/60 mt-0.5">
              Earn beans, unlock rewards.
            </p>
          </div>
          <ChevronRight size={16} className="text-white/60" />
        </div>
      </Link>
    );
  }

  return (
    <Link
      href="/rewards"
      className="block bg-[#160800] rounded-2xl p-4 text-white active:opacity-80"
    >
      <p className="text-white text-base font-bold" style={{ fontFamily: "Peachi-Bold, serif", letterSpacing: -0.3 }}>
        Hi{name ? `, ${name}.` : "."}
      </p>
      <div className="mt-2 flex items-center gap-4">
        <div className="flex-1">
          <p className="text-white text-xl font-bold">
            {beans?.toLocaleString() ?? "—"}
          </p>
          <p className="text-[10px] text-white/60 uppercase tracking-widest">
            Beans
          </p>
        </div>
        <ChevronRight size={16} className="text-white/40" />
      </div>
    </Link>
  );
}
