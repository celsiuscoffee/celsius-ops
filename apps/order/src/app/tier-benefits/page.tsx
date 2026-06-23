import Link from "next/link";
import { ArrowLeft, Check, Lock } from "lucide-react";

/**
 * Tier benefits — full tier table with per-tier perks. Mirrors
 * apps/pickup-native/app/tier-benefits.tsx. Static content (the
 * brand's tier structure rarely changes); per-customer current tier
 * is shown on /rewards's TierCard.
 */
type Tier = {
  name: string;
  beansFloor: number;
  multiplier: number;
  bg: string;
  fg: string;
  perks: string[];
};

const TIERS: Tier[] = [
  {
    name: "Bronze",
    beansFloor: 0,
    multiplier: 1,
    bg: "#A2492C",
    fg: "#FFFFFF",
    perks: ["1× points on every order", "Free welcome drink"],
  },
  {
    name: "Silver",
    beansFloor: 500,
    multiplier: 1.25,
    bg: "#C0C8D0",
    fg: "#160800",
    perks: ["1.25× points on every order", "Birthday treat", "Mystery drop weekly"],
  },
  {
    name: "Gold",
    beansFloor: 1500,
    multiplier: 1.5,
    bg: "#FBBF24",
    fg: "#160800",
    perks: ["1.5× points on every order", "Two mystery drops weekly", "Exclusive challenges"],
  },
  {
    name: "Black",
    beansFloor: 5000,
    multiplier: 2,
    bg: "#160800",
    fg: "#FBBF24",
    perks: ["2× points on every order", "Daily mystery drop", "Early access to new drinks", "Birthday week, not just day"],
  },
];

export default function TierBenefitsPage() {
  return (
    <main className="bg-white text-[#160800] min-h-screen pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
      <header
        className="bg-[#160800] text-white px-4 pb-3 flex items-center gap-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Link href="/rewards" className="-ml-1 p-1 active:opacity-60" aria-label="Back">
          <ArrowLeft size={20} color="#FFFFFF" />
        </Link>
        <h1 className="font-peachi font-bold text-[22px]">Tier benefits</h1>
      </header>

      <section className="px-4 pt-5 flex flex-col gap-3">
        {TIERS.map((t) => (
          <article
            key={t.name}
            className="rounded-2xl p-5"
            style={{ backgroundColor: t.bg, color: t.fg }}
          >
            <div className="flex items-baseline gap-3">
              <h2 className="font-peachi font-bold text-2xl">{t.name}</h2>
              <span
                className="text-[11px] uppercase tracking-widest"
                style={{ opacity: 0.7 }}
              >
                {t.beansFloor.toLocaleString()}+ points · {t.multiplier}× earn
              </span>
            </div>
            <ul className="mt-3 flex flex-col gap-2">
              {t.perks.map((p) => (
                <li key={p} className="flex items-start gap-2 text-[13px]">
                  <Check size={14} className="mt-0.5 flex-shrink-0" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <p className="px-5 pt-5 text-[11px] text-[#8E8E93]">
        <Lock size={11} className="inline mr-1" />
        Tier status reviewed every 90 days based on rolling-window points earned.
      </p>
    </main>
  );
}
