"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Coffee, Sparkles, Flame } from "lucide-react";

/**
 * Year recap ("wrapped") — high-level lifetime stats pulled from the
 * persisted member snapshot. Mirrors apps/pickup-native/app/wrapped.tsx
 * styling but minimal: cream-on-espresso stat cards rather than the
 * native's full animated reveal sequence.
 */
type Persisted = {
  state?: {
    member?: {
      name?: string | null;
      pointsBalance?: number;
      totalVisits?: number;
      totalPointsEarned?: number;
    };
  };
};

export function WrappedView() {
  const [m, setM] = useState<NonNullable<Persisted["state"]>["member"] | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) {
        const parsed = JSON.parse(raw) as Persisted;
        setM(parsed.state?.member ?? null);
      }
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <>
      <header className="px-4 pb-3 flex items-center gap-3" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
        <Link href="/rewards" className="-ml-1 p-1 active:opacity-60" aria-label="Back">
          <ArrowLeft size={20} color="#FFFFFF" />
        </Link>
        <h1 className="font-peachi font-bold text-[22px]">Your year</h1>
      </header>

      <section className="px-5 pt-6">
        <p className="text-[10px] uppercase tracking-widest text-white/55">
          Hi{m?.name ? `, ${m.name}` : ""}.
        </p>
        <h2 className="mt-1 font-peachi font-bold text-3xl leading-tight">
          Here&apos;s your Celsius year
        </h2>
        <p className="mt-2 text-[13px] text-white/65 leading-snug">
          Beans earned, drinks ordered, the streaks. Tap a card for the detail.
        </p>
      </section>

      <section className="px-4 pt-6 grid grid-cols-2 gap-3">
        <Stat
          Icon={Sparkles}
          accent="#FBBF24"
          value={(m?.totalPointsEarned ?? 0).toLocaleString()}
          label="Beans earned"
        />
        <Stat
          Icon={Coffee}
          accent="#A2492C"
          value={(m?.totalVisits ?? 0).toLocaleString()}
          label="Visits"
        />
        <Stat
          Icon={Flame}
          accent="#FBBF24"
          value={(m?.pointsBalance ?? 0).toLocaleString()}
          label="Beans now"
        />
        <Stat
          Icon={Coffee}
          accent="#A2492C"
          value="—"
          label="Favourite drink"
        />
      </section>
    </>
  );
}

function Stat({
  Icon,
  accent,
  value,
  label,
}: {
  Icon: typeof Coffee;
  accent: string;
  value: string;
  label: string;
}) {
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        backgroundColor: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <span
        className="flex items-center justify-center"
        style={{
          width: 32,
          height: 32,
          borderRadius: 9,
          backgroundColor: `${accent}28`,
        }}
      >
        <Icon size={16} color={accent} strokeWidth={1.8} />
      </span>
      <p className="mt-3 font-peachi font-bold text-2xl">{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-widest text-white/60">{label}</p>
    </div>
  );
}
