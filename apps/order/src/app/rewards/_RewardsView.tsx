"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Gift, Sparkles, Coffee, Tag, Cookie, Ticket } from "lucide-react";
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
  points_required?: number;
  discount_type?:
    | "flat" | "percent" | "free_item" | "bogo" | "combo" | "override_price" | "fixed_amount" | "percentage" | "none" | null;
  discount_value?: number | null;
  max_discount_value?: number | null;
  min_order_value?: number | null;
  applicable_products?: string[] | null;
  applicable_categories?: string[] | null;
  free_product_name?: string | null;
  free_product_ids?: string[] | null;
  bogo_buy_qty?: number;
  bogo_free_qty?: number;
  combo_price_sen?: number | null;
  override_price_sen?: number | null;
};

// Write the chosen catalog reward into the SPA's persisted state as the
// applied reward + reserved-voucher banner, then send the customer to
// the menu — same flow as apps/pickup-native/app/rewards.tsx useCatalog.
function applyCatalogReward(r: Reward) {
  try {
    const raw = window.localStorage.getItem("celsius-pickup");
    const parsed = raw ? JSON.parse(raw) : { state: {} };
    const state = parsed.state ?? {};
    state.appliedReward = {
      id: r.id,
      name: r.name,
      points_required: r.points_required ?? 0,
      discount_type: r.discount_type ?? null,
      discount_value: r.discount_value ?? null,
      max_discount_value: r.max_discount_value ?? null,
      applicable_categories: r.applicable_categories ?? null,
      applicable_products: r.applicable_products ?? null,
      free_product_name: r.free_product_name ?? null,
      free_product_ids: r.free_product_ids ?? null,
      min_order_value: r.min_order_value ?? null,
      bogo_buy_qty: r.bogo_buy_qty,
      bogo_free_qty: r.bogo_free_qty,
      combo_price_sen: r.combo_price_sen ?? null,
      override_price_sen: r.override_price_sen ?? null,
    };
    state.reservedVoucher = {
      id: r.id,
      title: r.name,
      category: "bean",
      icon: "ticket",
      expires_at: null,
    };
    window.localStorage.setItem("celsius-pickup", JSON.stringify({ ...parsed, state }));
  } catch {
    /* ignore */
  }
}

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
          style={{ fontFamily: "var(--font-display)", letterSpacing: -0.3, fontWeight: 700 }}
        >
          Rewards
        </h1>
      </header>

      {/* Points hero — compact themed card with the customer's bean
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
            style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
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
            style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
          >
            No rewards available yet
          </p>
          <p className="text-sm text-[#6E6E73] mt-1 text-center">
            Keep ordering — rewards unlock as you earn beans.
          </p>
        </div>
      ) : (
        <ul className="px-4 py-4 flex flex-col gap-2">
          <li>
            <p
              className="uppercase"
              style={{
                color: "#8E8E93",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 1.4,
                marginBottom: 4,
                paddingLeft: 4,
              }}
            >
              Spend your beans
            </p>
          </li>
          {rewards.map((r) => (
            <CatalogCard key={r.id} reward={r} balance={beans} />
          ))}
        </ul>
      )}
    </>
  );
}

// Pick a glyph + colourway that matches the reward's flavour, mirroring
// apps/pickup-native/app/rewards.tsx's themeForReward + pickRewardIcon
// shorthand. Web doesn't have access to discount_type/flat-vs-percent
// breakdown so we fall back to keyword matching on the name.
function themeFor(reward: Reward): {
  bg: string;
  fg: string;
  fgDim: string;
  accent: string;
  iconBg: string;
  Icon: typeof Gift;
} {
  const name = (reward.name ?? "").toLowerCase();
  if (/free|bogo|buy.*free/.test(name)) {
    return {
      bg: "#1A0200",
      fg: "#FFFFFF",
      fgDim: "rgba(255,255,255,0.65)",
      accent: "#FBBF24",
      iconBg: "rgba(251,191,36,0.20)",
      Icon: Coffee,
    };
  }
  if (/cookie|pastry|cake|croissant/.test(name)) {
    return {
      bg: "#FBEBE8",
      fg: "#1A0200",
      fgDim: "rgba(26,2,0,0.65)",
      accent: "#A2492C",
      iconBg: "rgba(162,73,44,0.18)",
      Icon: Cookie,
    };
  }
  if (/rm\s*\d|%\s*off|off$/i.test(reward.name ?? "")) {
    return {
      bg: "rgba(162,73,44,0.10)",
      fg: "#1A0200",
      fgDim: "rgba(26,2,0,0.65)",
      accent: "#A2492C",
      iconBg: "rgba(162,73,44,0.18)",
      Icon: Tag,
    };
  }
  return {
    bg: "#FBEBE8",
    fg: "#1A0200",
    fgDim: "rgba(26,2,0,0.65)",
    accent: "#A2492C",
    iconBg: "rgba(162,73,44,0.18)",
    Icon: Ticket,
  };
}

function CatalogCard({ reward, balance }: { reward: Reward; balance: number }) {
  const router = useRouter();
  const required = reward.points_required ?? 0;
  const canUse = balance >= required;
  const theme = themeFor(reward);
  const Icon = theme.Icon;
  return (
    <li
      style={{
        backgroundColor: theme.bg,
        border: `1px solid ${theme.bg}`,
        borderRadius: 18,
        padding: 14,
        opacity: canUse ? 1 : 0.78,
        boxShadow: "0 4px 10px rgba(0,0,0,0.06)",
      }}
    >
      <div className="flex items-center" style={{ gap: 14 }}>
        <span
          className="flex items-center justify-center flex-shrink-0"
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            backgroundColor: theme.iconBg,
          }}
        >
          <Icon size={24} color={theme.accent} strokeWidth={2} />
        </span>
        <div className="flex-1 min-w-0">
          <p
            className="uppercase truncate"
            style={{
              color: theme.accent,
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: 1.4,
              marginBottom: 3,
            }}
          >
            Reward
          </p>
          <p
            className="font-peachi font-bold truncate"
            style={{ color: theme.fg, fontSize: 17, lineHeight: "21px" }}
          >
            {reward.name}
          </p>
          <p
            className="truncate"
            style={{ color: theme.fgDim, fontSize: 11, marginTop: 2, fontWeight: 500 }}
          >
            {canUse
              ? required > 0 ? `Spend ${required.toLocaleString()} beans` : "Free to claim"
              : `${(required - balance).toLocaleString()} beans to go`}
          </p>
        </div>
        <button
          type="button"
          disabled={!canUse}
          onClick={() => {
            if (!canUse) return;
            applyCatalogReward(reward);
            // Return to wherever the customer started applying from
            // (checkout / cart) so the deduction is immediately visible and
            // they can pay — instead of always dumping them on the menu.
            // Whitelisted to known routes (no open redirect).
            const next =
              typeof window !== "undefined"
                ? new URLSearchParams(window.location.search).get("next")
                : null;
            router.push(next === "checkout" ? "/checkout" : next === "cart" ? "/cart" : "/menu");
          }}
          className="rounded-full flex items-center justify-center flex-shrink-0 active:opacity-80"
          style={{
            backgroundColor: canUse ? theme.accent : "rgba(0,0,0,0.10)",
            color: canUse ? "#FFFFFF" : theme.fgDim,
            paddingLeft: 14,
            paddingRight: 14,
            paddingTop: 7,
            paddingBottom: 7,
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 12,
          }}
        >
          {canUse ? `Use · ${required.toLocaleString()}` : `${required.toLocaleString()}`}
        </button>
      </div>
    </li>
  );
}
