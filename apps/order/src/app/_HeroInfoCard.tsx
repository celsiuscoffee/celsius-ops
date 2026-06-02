"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

/**
 * The dark espresso info card that overlays the bottom of the hero
 * poster. Mirrors the SPA's home info-card design — "Hi, [name]." up
 * top, KPI strip (Points | Rewards) below with the gold accent when
 * vouchers > 0. Tap anywhere on the card → /rewards.
 */
type Persisted = {
  state?: {
    phone?: string | null;
    member?: { name?: string | null; pointsBalance?: number };
  };
};

function firstNameOf(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim().split(/\s+/)[0];
  return trimmed || null;
}

function greetingFor(hour: number): string {
  if (hour < 5) return "Hello";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function HeroInfoCard({ voucherCount = 0 }: { voucherCount?: number }) {
  const [name, setName] = useState<string | null>(null);
  const [beans, setBeans] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) {
        const parsed = JSON.parse(raw) as Persisted;
        setName(firstNameOf(parsed.state?.member?.name));
        setBeans(parsed.state?.member?.pointsBalance ?? null);
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  const greeting = greetingFor(new Date().getHours());
  const heading = name ? `Hi, ${name}.` : `${greeting}.`;

  return (
    <Link
      href="/rewards"
      className="absolute left-4 right-4 bottom-0 bg-[#160800] text-white block active:opacity-95"
      style={{
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        padding: "11px 16px",
        boxShadow: "0 8px 16px rgba(0,0,0,0.28)",
      }}
    >
      <p className="text-[17px] font-peachi font-bold truncate">{heading}</p>
      <div
        className="mt-2 pt-2 flex items-center"
        style={{ borderTop: "1px solid rgba(255,255,255,0.10)" }}
      >
        <div className="flex-1">
          <p className="font-peachi font-bold text-[18px]">
            {hydrated && beans !== null ? beans.toLocaleString() : "—"}
          </p>
          <p
            className="text-[10px] uppercase mt-0.5 text-white/55"
            style={{ letterSpacing: 1.2, fontWeight: 500 }}
          >
            Points
          </p>
        </div>
        <div
          className="flex-1 pl-4"
          style={{ borderLeft: "1px solid rgba(255,255,255,0.10)" }}
        >
          <p
            className="font-peachi font-bold text-[18px]"
            style={{ color: voucherCount > 0 ? "#FBBF24" : "#FFFFFF" }}
          >
            {voucherCount}
          </p>
          <p
            className="text-[10px] uppercase mt-0.5 text-white/55"
            style={{ letterSpacing: 1.2, fontWeight: 500 }}
          >
            Rewards
          </p>
        </div>
        <ChevronRight size={16} className="text-white/55" />
      </div>
    </Link>
  );
}
