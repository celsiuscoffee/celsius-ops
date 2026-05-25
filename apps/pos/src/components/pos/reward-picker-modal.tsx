"use client";

/**
 * Mirrors the pickup-native VoucherWallet display so the cashier reads
 * the same labels + themes the customer sees in their app:
 *
 *   • Source-driven eyebrow ("Mystery Bag", "Birthday Gift", "Challenge",
 *     "Bean Points", "Promo", "Reward") instead of a generic "GIFT" pill.
 *     Mirrors voucherSourceLabel() in
 *     apps/pickup-native/components/VoucherWallet.tsx.
 *   • Four source-themed cards (Challenge espresso+gold, Mystery
 *     saffron+espresso, Gift peach+terracotta, Bean terracotta+gold)
 *     so a mixed deck reads as visually grouped families.
 *   • Peachi-Bold title + urgency subline (formatted expiry).
 *   • Big "USE ›" pill.
 *   • Lucide icon picked from the title/icon-key, same heuristic as
 *     native pickRewardIcon().
 */

import { useState, useEffect } from "react";
import {
  Cake, Cookie, Coffee, Croissant, Gift, Percent, Plus,
  Sandwich, Sparkles, Ticket,
  type LucideIcon,
} from "lucide-react";
import type { ActiveVoucher, AffordableCatalogReward } from "@celsius/shared";

type SourceType = ActiveVoucher["source_type"];

/** Local row shape rendered by VoucherCard. Normalised from either
 *  an ActiveVoucher (wallet) or a catalog Reward so the card itself
 *  doesn't have to branch on the source. Discriminated by
 *  `voucher_id`: present → wallet voucher (free to use); absent →
 *  catalog item (costs `points_required` beans). */
type DisplayReward = {
  id: string;
  name: string;
  description: string | null;
  points_required: number | null;  // null for wallet vouchers
  discount_type: string | null;
  discount_value: number | null;
  max_discount_value: number | null;
  free_product_name: string | null;
  icon: string | null;
  source_type: SourceType;
  /** issued_rewards.id — only on wallet rewards (mark-used target) */
  voucher_id: string | null;
  /** Catalog back-reference for the /redeem endpoint's rewards-table
   *  lookup. ActiveVoucher.reward_id for wallet rows; the catalog
   *  row's own id for catalog rows. */
  reward_back_ref_id: string;
  expires_at: string | null;
};

/** Catalog row shape returned by /api/loyalty/rewards. Imported
 *  directly from the shared package so POS + Pickup never drift on
 *  catalog field shape. */
type CatalogReward = AffordableCatalogReward;

type RewardDiscount = {
  type: string;
  value: number;
  max_discount: number | null;
  min_order: number | null;
  applicable_products: string[] | null;
  applicable_categories: string[] | null;
  free_product_ids: string[] | null;
  free_product_name: string | null;
  note?: string;
};

type Props = {
  memberId: string;
  memberName: string | null;
  outletId: string;
  subtotal: number; // in sen
  onRedeem: (result: {
    reward_name: string;
    redemption_id: string;
    discount: RewardDiscount;
    new_balance: number;
  }) => void;
  onClose: () => void;
};

// ─── Native-mirroring helpers ────────────────────────────────────

/** Source → display eyebrow. Same mapping as native VoucherWallet's
 *  voucherSourceLabel() — answers "where did this reward come from?" */
function sourceLabel(source: SourceType): string {
  switch (source) {
    case "mystery":           return "Mystery Bag";
    case "birthday":          return "Birthday Gift";
    case "referral":          return "Referral Gift";
    case "manual":            return "Promo";
    case "points_redemption": return "Bean Points";
    case "mission":           return "Challenge";
    default:                  return "Reward";
  }
}

/** Source → 4-bucket theme. Mirrors native themeForSource(). */
type Theme = {
  bg: string;
  border: string;
  accent: string;   // pill + eyebrow + icon color
  fg: string;       // title text
  fgDim: string;    // expiry text
  iconBg: string;
  iconColor: string;
  pillFg: string;   // text inside USE pill (contrast on accent)
};
const THEME_CHALLENGE: Theme = {
  bg: "#1A0200", border: "rgba(251,191,36,0.32)",
  accent: "#FBBF24", fg: "#FFFFFF", fgDim: "rgba(255,255,255,0.65)",
  iconBg: "rgba(251,191,36,0.20)", iconColor: "#FBBF24", pillFg: "#1A0200",
};
const THEME_MYSTERY: Theme = {
  bg: "#FBBF24", border: "rgba(26,2,0,0.25)",
  accent: "#1A0200", fg: "#1A0200", fgDim: "rgba(26,2,0,0.65)",
  iconBg: "rgba(26,2,0,0.12)", iconColor: "#1A0200", pillFg: "#FBBF24",
};
const THEME_GIFT: Theme = {
  bg: "#F4D3B0", border: "rgba(162,73,44,0.28)",
  accent: "#A2492C", fg: "#1A0200", fgDim: "rgba(26,2,0,0.62)",
  iconBg: "rgba(162,73,44,0.14)", iconColor: "#A2492C", pillFg: "#F4D3B0",
};
const THEME_BEAN: Theme = {
  bg: "#A2492C", border: "rgba(251,191,36,0.36)",
  accent: "#FBBF24", fg: "#FFFFFF", fgDim: "rgba(255,245,225,0.78)",
  iconBg: "rgba(255,245,225,0.18)", iconColor: "#FBBF24", pillFg: "#1A0200",
};
function themeForSource(source: SourceType): Theme {
  switch (source) {
    case "mission":           return THEME_CHALLENGE;
    case "mystery":           return THEME_MYSTERY;
    case "birthday":
    case "referral":
    case "manual":            return THEME_GIFT;
    case "points_redemption": return THEME_BEAN;
    default:                  return THEME_GIFT;
  }
}

/** Lucide icon picker — title is the primary signal, icon key fallback.
 *  Mirrors native pickRewardIcon(). */
function pickRewardIcon(title: string, iconKey?: string | null): LucideIcon {
  const k = (iconKey ?? "").toLowerCase();
  const t = (title ?? "").toLowerCase();
  if (k === "cake" || t.includes("cake"))           return Cake;
  if (k === "sandwich" || t.includes("sandwich"))   return Sandwich;
  if (k === "croissant" || t.includes("croissant")) return Croissant;
  if (k === "cookie" || t.includes("cookie"))       return Cookie;
  if (k === "coffee" || t.includes("drink") || t.includes("coffee")) return Coffee;
  if (k === "sparkle" || t.includes("boost") || t.includes("beans") || t.includes("multiplier"))
    return Sparkles;
  if (t.includes("birthday")) return Cake;
  if (k === "percent" || t.includes("off") || /\brm\d/i.test(t) || t.includes("discount"))
    return Percent;
  if (k === "plus" || t.includes("add") || t.includes("upgrade")) return Plus;
  if (k === "gift" || t.includes("gift") || t.includes("welcome")) return Gift;
  return Ticket;
}

/** Expiry text. Mirrors native voucherUrgencyLabel() so a voucher
 *  reads the same in-store as it does in the app. */
function urgencyLabel(expiresAt: string | null | undefined): { label: string; warn: boolean } {
  if (!expiresAt) return { label: "No expiry", warn: false };
  const ms = new Date(expiresAt).getTime() - Date.now();
  const days = Math.ceil(ms / 86_400_000);
  if (days <= 0) return { label: "Expired", warn: true };
  if (days <= 3) return { label: `Expires in ${days} day${days === 1 ? "" : "s"}`, warn: true };
  if (days <= 14) return { label: `Expires in ${days} days`, warn: false };
  return {
    label: `Expires ${new Date(expiresAt).toLocaleDateString("en-MY", { month: "short", day: "numeric" })}`,
    warn: false,
  };
}

// ─── Modal ────────────────────────────────────────────────────────

/** Normalise an ActiveVoucher (wallet) into the modal's DisplayReward
 *  shape. Wallet vouchers have no points cost; `voucher_id` carries
 *  the issued_rewards.id (mark-used target). */
function fromActiveVoucher(v: ActiveVoucher): DisplayReward {
  return {
    id: v.id,
    name: v.title,
    description: v.description || null,
    points_required: null,
    discount_type: v.discount_type,
    discount_value: v.discount_value,
    max_discount_value: v.max_discount_value,
    free_product_name: v.free_product_name,
    icon: v.icon,
    source_type: v.source_type,
    voucher_id: v.id,
    // Modern voucher-template-backed rows have no rewards-table back-
    // ref. Fall back to the voucher's own id so /redeem at least gets
    // a string — it'll 404 the catalog lookup if there's no row, but
    // that's a pre-existing limitation outside this consolidation's
    // scope (Phase 2 will fix the redeem endpoint to accept template-
    // backed vouchers directly).
    reward_back_ref_id: v.reward_id ?? v.id,
    expires_at: v.expires_at,
  };
}

/** Normalise a catalog row into the same DisplayReward shape. */
function fromCatalog(r: CatalogReward): DisplayReward {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    points_required: r.points_required,
    discount_type: r.discount_type,
    discount_value: r.discount_value,
    max_discount_value: r.max_discount_value,
    free_product_name: r.free_product_name,
    // Catalog rows on the rewards table don't carry a Lucide icon
    // key — pickRewardIcon falls back to a title-based heuristic
    // when null.
    icon: null,
    source_type: "points_redemption",
    voucher_id: null,
    reward_back_ref_id: r.id,
    expires_at: null,
  };
}

export function RewardPickerModal({ memberId, memberName, outletId, onRedeem, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [balance, setBalance] = useState(0);
  const [catalog, setCatalog] = useState<DisplayReward[]>([]);
  const [issued, setIssued] = useState<DisplayReward[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/loyalty/rewards?member_id=${memberId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setBalance(data.balance);
        setCatalog((data.catalog ?? []).map(fromCatalog));
        setIssued((data.issued ?? []).map(fromActiveVoucher));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load rewards");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [memberId]);

  async function handleRedeem(reward: DisplayReward) {
    setRedeeming(reward.id);
    setError("");
    try {
      const res = await fetch("/api/loyalty/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          member_id: memberId,
          reward_id: reward.reward_back_ref_id,
          outlet_id: outletId,
          issued_reward_id: reward.voucher_id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onRedeem({
        reward_name: data.reward_name,
        redemption_id: data.redemption_id,
        discount: data.discount,
        new_balance: data.new_balance,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Redemption failed");
      setRedeeming(null);
    }
  }

  const allRewards = [...issued, ...catalog];
  const hasRewards = allRewards.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="mx-4 w-full max-w-md overflow-hidden rounded-2xl shadow-2xl"
        style={{ backgroundColor: "#160800" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-5 py-4"
          style={{ borderColor: "rgba(245,243,240,0.08)" }}
        >
          <div>
            <h3
              className="text-xl"
              style={{ fontFamily: "Peachi", fontWeight: 700, color: "#F5F3F0" }}
            >
              Redeem Reward
            </h3>
            <p
              className="mt-0.5 text-[11px] font-bold uppercase tracking-[0.16em]"
              style={{ fontFamily: "Space Grotesk", color: "rgba(251,191,36,0.85)" }}
            >
              {memberName ?? "Member"} · {balance.toLocaleString()} Beans
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-white/10"
            style={{ color: "rgba(245,243,240,0.7)" }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto p-4">
          {loading ? (
            <div
              className="py-8 text-center text-sm"
              style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.55)" }}
            >
              Loading rewards…
            </div>
          ) : error && !hasRewards ? (
            <div className="py-8 text-center text-sm text-danger">{error}</div>
          ) : !hasRewards ? (
            <div className="py-8 text-center">
              <p
                className="text-base"
                style={{ fontFamily: "Peachi", fontWeight: 500, color: "rgba(245,243,240,0.6)" }}
              >
                No rewards yet
              </p>
              <p
                className="mt-1.5 text-[11px]"
                style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.4)" }}
              >
                {balance.toLocaleString()} Beans — earn more to unlock
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {/* Issued (wallet vouchers) — source-themed, free to use */}
              {issued.map((r) => (
                <VoucherCard
                  key={`issued-${r.voucher_id ?? r.id}`}
                  reward={r}
                  cost={null}
                  redeeming={redeeming === r.id}
                  disabled={!!redeeming}
                  onUse={() => handleRedeem(r)}
                />
              ))}
              {/* Catalog (Spend Beans) — always Bean theme */}
              {catalog.map((r) => {
                // fromCatalog guarantees points_required is non-null
                // for catalog rows; widen safely for the comparison.
                const cost = r.points_required ?? 0;
                const tooLow = cost > balance;
                return (
                  <VoucherCard
                    key={`cat-${r.id}`}
                    reward={r}
                    cost={cost}
                    redeeming={redeeming === r.id}
                    disabled={tooLow || !!redeeming}
                    onUse={() => handleRedeem(r)}
                  />
                );
              })}
            </div>
          )}

          {error && hasRewards && (
            <p className="mt-3 text-center text-xs text-danger">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Per-row card — mirrors native VoucherRow visual ────────────

function VoucherCard({
  reward,
  cost,
  redeeming,
  disabled,
  onUse,
}: {
  reward: DisplayReward;
  cost: number | null;     // points cost for catalog; null for issued
  redeeming: boolean;
  disabled: boolean;
  onUse: () => void;
}) {
  const theme = themeForSource(reward.source_type ?? null);
  const eyebrow = sourceLabel(reward.source_type ?? null);
  const RewardIcon = pickRewardIcon(reward.name, reward.icon);
  // Urgency line only renders for wallet vouchers — catalog items
  // have no expiry to show. Discriminate by voucher_id presence
  // (set only on wallet rows).
  const urgency = reward.voucher_id !== null ? urgencyLabel(reward.expires_at) : null;

  return (
    <button
      type="button"
      onClick={onUse}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
      style={{ backgroundColor: theme.bg, borderColor: theme.border }}
    >
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
        style={{ backgroundColor: theme.iconBg }}
      >
        <RewardIcon size={22} color={theme.iconColor} strokeWidth={2} />
      </div>

      <div className="min-w-0 flex-1">
        <p
          className="text-[9.5px] font-bold uppercase tracking-[0.16em]"
          style={{ fontFamily: "Space Grotesk", color: theme.accent }}
        >
          {eyebrow}
        </p>
        <p
          className="mt-0.5 truncate text-[15px]"
          style={{ fontFamily: "Peachi", fontWeight: 700, color: theme.fg, lineHeight: 1.2 }}
        >
          {reward.name}
        </p>
        {urgency ? (
          <p
            className="mt-0.5 truncate text-[11px]"
            style={{
              fontFamily: "Space Grotesk",
              color: urgency.warn ? "#FFB070" : theme.fgDim,
              fontWeight: 500,
            }}
          >
            {urgency.label}
          </p>
        ) : reward.description ? (
          <p
            className="mt-0.5 truncate text-[11px]"
            style={{ fontFamily: "Space Grotesk", color: theme.fgDim }}
          >
            {reward.description}
          </p>
        ) : null}
      </div>

      <span
        className="shrink-0 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em]"
        style={{
          fontFamily: "Space Grotesk",
          backgroundColor: theme.accent,
          color: theme.pillFg,
        }}
      >
        {redeeming ? "…" : cost !== null ? `${cost.toLocaleString()} ›` : "Use ›"}
      </span>
    </button>
  );
}
