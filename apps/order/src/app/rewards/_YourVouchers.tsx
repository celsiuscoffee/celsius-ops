"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Gift, Sparkles, Coffee, Tag, Ticket, Percent } from "lucide-react";

/**
 * "Your vouchers" — the web mirror of apps/pickup-native's "Yours" wallet
 * (components/VoucherWallet.tsx). The web Rewards page previously showed
 * only the spend-your-beans catalogue + challenges; a customer's HELD
 * vouchers (mystery-bag wins, win-back campaign rewards, birthday gifts,
 * manual admin grants) only appeared on the home rail, never here. This
 * brings the rewards screen to parity with native.
 *
 * Tapping "Use" applies the voucher exactly like the catalogue cards do
 * (writes appliedReward + reservedVoucher into the SPA's persisted state),
 * carrying ALL discount mechanics — flat / percent (+cap) / free_item /
 * bogo / combo / override_price — so the cart preview + the server quote
 * both read the right discount. voucher_id marks it as a wallet voucher
 * (an issued_rewards burn) rather than a points redemption.
 */

// Canonical wallet allowlist — same set as the native wallet
// (WALLET_SOURCES) and the home rail. Bean-shop redemptions, referrals
// and welcome gifts are deliberately excluded (they live elsewhere).
const WALLET_SOURCES = ["mystery", "manual", "birthday", "campaign"];

type Voucher = {
  id: string;
  title?: string | null;
  name?: string | null;
  description?: string | null;
  value_label?: string | null;
  source_type?: string | null;
  category?: string | null;
  icon?: string | null;
  status?: string | null;
  expires_at?: string | null;
  discount_type?: string | null;
  discount_value?: number | null;
  max_discount_value?: number | null;
  min_order_value?: number | null;
  applicable_categories?: string[] | null;
  applicable_products?: string[] | null;
  free_product_name?: string | null;
  free_product_ids?: string[] | null;
  bogo_buy_qty?: number | null;
  bogo_free_qty?: number | null;
  combo_price_sen?: number | null;
  override_price_sen?: number | null;
};

type Persisted = { state?: { sessionToken?: string | null } };

function expiresLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return null;
  if (days === 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  if (days <= 7) return `${days} days left`;
  return `Expires ${new Date(iso).toLocaleDateString("en-MY", { day: "numeric", month: "short" })}`;
}

function eyebrowFor(v: Voucher): string {
  switch (v.source_type) {
    case "campaign":  return "Welcome back";
    case "birthday":  return "Birthday gift";
    case "mystery":   return "Mystery reward";
    case "manual":    return "Gift";
    default:          return "Reward";
  }
}

// Source-driven colourway, matching the home rail's toneFor: auto-issued
// "gift" rewards get gold-on-espresso, everything else terracotta.
function themeFor(v: Voucher): {
  bg: string; fg: string; fgDim: string; accent: string; iconBg: string; Icon: typeof Gift;
} {
  const name = `${v.title ?? v.name ?? ""}`.toLowerCase();
  const Icon =
    /coffee|tea|drink|latte|matcha/.test(name) ? Coffee
    : /free|bogo|buy.*free/.test(name) ? Gift
    : v.discount_type === "percent" || v.discount_type === "flat" ? Percent
    : /rm\s*\d|%/.test(name) ? Tag
    : v.source_type === "mystery" ? Sparkles
    : Ticket;
  const gold = v.source_type === "mystery" || v.source_type === "birthday";
  if (gold) {
    return {
      bg: "#1A0200", fg: "#FFFFFF", fgDim: "rgba(255,255,255,0.65)",
      accent: "#FBBF24", iconBg: "rgba(251,191,36,0.20)", Icon,
    };
  }
  // campaign / manual → terracotta-tint card
  return {
    bg: "rgba(162,73,44,0.10)", fg: "#1A0200", fgDim: "rgba(26,2,0,0.62)",
    accent: "#A2492C", iconBg: "rgba(162,73,44,0.18)", Icon,
  };
}

// Write the chosen wallet voucher into the SPA's persisted state as the
// applied reward + reserved-voucher banner. Mirrors native VoucherWallet's
// "Use Now" mapping — carries every discount mechanic so flat/percent/
// free_item/bogo/combo/override all preview + charge correctly.
function applyWalletVoucher(v: Voucher) {
  try {
    const raw = window.localStorage.getItem("celsius-pickup");
    const parsed = raw ? JSON.parse(raw) : { state: {} };
    const state = parsed.state ?? {};
    // beans_multiplier is applied post-payment, never a cart discount.
    const discountType =
      v.discount_type && v.discount_type !== "beans_multiplier" ? v.discount_type : null;
    state.appliedReward = {
      id: v.id,
      name: v.title ?? v.name ?? "Reward",
      points_required: 0,
      discount_type: discountType,
      discount_value: v.discount_value ?? null,
      max_discount_value: v.max_discount_value ?? null,
      applicable_categories: v.applicable_categories ?? null,
      applicable_products: v.applicable_products ?? null,
      free_product_name: v.free_product_name ?? null,
      free_product_ids: v.free_product_ids ?? null,
      min_order_value: v.min_order_value ?? null,
      bogo_buy_qty: v.bogo_buy_qty ?? undefined,
      bogo_free_qty: v.bogo_free_qty ?? undefined,
      combo_price_sen: v.combo_price_sen ?? null,
      override_price_sen: v.override_price_sen ?? null,
      voucher_id: v.id, // marks this as a wallet voucher (issued_rewards burn)
    };
    state.reservedVoucher = {
      id: v.id,
      title: v.title ?? v.name ?? "Reward",
      category: v.category ?? "special",
      icon: v.icon ?? "ticket",
      expires_at: v.expires_at ?? null,
    };
    window.localStorage.setItem("celsius-pickup", JSON.stringify({ ...parsed, state }));
  } catch {
    /* ignore */
  }
}

export function YourVouchers() {
  const router = useRouter();
  const [vouchers, setVouchers] = useState<Voucher[] | null>(null);

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
    fetch("/api/loyalty/me/vouchers", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        const list = (Array.isArray(data) ? data : (data?.vouchers ?? [])) as Voucher[];
        setVouchers(
          list.filter(
            (v) =>
              (v.status === "active" || !v.status) &&
              WALLET_SOURCES.includes(v.source_type ?? ""),
          ),
        );
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  if (!vouchers || vouchers.length === 0) return null;

  return (
    <section className="px-4 pt-4">
      <p
        className="uppercase"
        style={{
          color: "#8E8E93", fontSize: 10, fontWeight: 700,
          letterSpacing: 1.4, marginBottom: 8, paddingLeft: 4,
        }}
      >
        Your vouchers
      </p>
      <ul className="flex flex-col gap-2">
        {vouchers.map((v) => (
          <VoucherCard key={v.id} voucher={v} router={router} />
        ))}
      </ul>
    </section>
  );
}

function VoucherCard({
  voucher,
  router,
}: {
  voucher: Voucher;
  router: ReturnType<typeof useRouter>;
}) {
  const theme = themeFor(voucher);
  const Icon = theme.Icon;
  const headline = voucher.title ?? voucher.name ?? "Reward";
  const sub = expiresLabel(voucher.expires_at) ?? "Ready to use";
  return (
    <li
      style={{
        backgroundColor: theme.bg,
        border: `1px solid ${theme.bg}`,
        borderRadius: 18,
        padding: 14,
        boxShadow: "0 4px 10px rgba(0,0,0,0.06)",
      }}
    >
      <div className="flex items-center" style={{ gap: 14 }}>
        <span
          className="flex items-center justify-center flex-shrink-0"
          style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: theme.iconBg }}
        >
          <Icon size={24} color={theme.accent} strokeWidth={2} />
        </span>
        <div className="flex-1 min-w-0">
          <p
            className="uppercase truncate"
            style={{
              color: theme.accent, fontSize: 9.5, fontWeight: 700,
              letterSpacing: 1.4, marginBottom: 3,
            }}
          >
            {eyebrowFor(voucher)}
          </p>
          <p
            className="font-peachi font-bold truncate"
            style={{ color: theme.fg, fontSize: 17, lineHeight: "21px" }}
          >
            {headline}
          </p>
          <p
            className="truncate"
            style={{ color: theme.fgDim, fontSize: 11, marginTop: 2, fontWeight: 500 }}
          >
            {sub}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            applyWalletVoucher(voucher);
            const next =
              typeof window !== "undefined"
                ? new URLSearchParams(window.location.search).get("next")
                : null;
            router.push(next === "checkout" ? "/checkout" : next === "cart" ? "/cart" : "/menu");
          }}
          className="rounded-full flex items-center justify-center flex-shrink-0 active:opacity-80"
          style={{
            backgroundColor: theme.accent,
            color: "#FFFFFF",
            paddingLeft: 16, paddingRight: 16, paddingTop: 7, paddingBottom: 7,
            fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 12,
          }}
        >
          Use
        </button>
      </div>
    </li>
  );
}
