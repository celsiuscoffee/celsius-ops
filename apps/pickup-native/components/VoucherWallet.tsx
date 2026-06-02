/**
 * VoucherWallet — voucher list section for the Rewards screen's Vouchers tab.
 *
 * Each row is a category-themed card with a Celsius brand icon on the
 * left, the voucher title + expiry meta in the middle, and a Use pill
 * on the right. The whole row is also pressable to open detail.
 *
 * Category themes — each voucher type gets its own colourway so the
 * wallet reads as a deck of distinct cards rather than a uniform list:
 *   • free_item   → espresso + gold (CelsiusCup)
 *   • discount    → terracotta + white (CelsiusTag)
 *   • upgrade     → cream + terracotta (CelsiusGift)
 *   • multiplier  → amber + espresso (Sparkles)
 *   • special     → cream + gold (CelsiusGift)
 */

import { useState, useMemo } from "react";
import { View, Text, Pressable, Image } from "react-native";
import { router } from "expo-router";
import {
  Sparkles, ChevronRight, Cake, Sandwich, Cookie, Croissant,
  Coffee, Percent, Plus, Gift, Ticket,
} from "lucide-react-native";
import * as Haptics from "@/lib/haptics";
import { type Voucher, voucherUrgencyLabel } from "../lib/rewards-v2";

// Pick a lucide icon that matches what the reward actually is. The
// title is the primary signal (admins write it for human readability),
// the icon key set on the voucher template is a fallback. Falls all
// the way through to Ticket for generic "Reward" entries.
export function pickRewardIcon(title: string, iconKey?: string | null) {
  const k = (iconKey ?? "").toLowerCase();
  const t = (title ?? "").toLowerCase();
  if (k === "cake" || t.includes("cake"))             return Cake;
  if (k === "sandwich" || t.includes("sandwich"))     return Sandwich;
  if (k === "croissant" || t.includes("croissant"))   return Croissant;
  if (k === "cookie" || t.includes("cookie"))         return Cookie;
  if (k === "coffee" || t.includes("drink") || t.includes("coffee")) return Coffee;
  // 2× Points Boost / Points Multiplier / Sparkle-coded mystery rewards.
  if (k === "sparkle" || t.includes("boost") || t.includes("beans") || t.includes("multiplier"))
    return Sparkles;
  if (t.includes("birthday"))                          return Cake;
  // Money-off vouchers / discount-typed.
  if (k === "percent" || t.includes("off") || /\brm\d/i.test(t) || t.includes("discount"))
    return Percent;
  if (k === "plus" || t.includes("add") || t.includes("upgrade")) return Plus;
  if (k === "gift" || t.includes("gift") || t.includes("welcome")) return Gift;
  return Ticket;
}
import { useApp, type AppliedReward } from "../lib/store";
import { CelsiusCup } from "./brand/CelsiusCup";
import { CelsiusGift } from "./brand/CelsiusGift";
import { CelsiusTag } from "./brand/CelsiusTag";

// Voucher template discount_type → AppliedReward discount_type.
// Wallet voucher's `free_upgrade` (add-on) is treated as free_item by
// the discount engine — same picker semantics (cheapest eligible item).
function mapDiscountType(
  t: NonNullable<Voucher["discount_type"]>,
): AppliedReward["discount_type"] {
  switch (t) {
    case "free_item":         return "free_item";
    case "free_upgrade":      return "free_item";  // add-on = free pick
    case "flat":              return "flat";
    case "percent":           return "percent";
    case "beans_multiplier":  return "none";       // applied post-payment
    default:                  return "none";
  }
}

// Category-driven theme — colour palette + brand icon per voucher type.
// Used by both the wallet rows below and the home-screen voucher rail
// (re-exported as VOUCHER_THEME) so a free-drink voucher reads the same
// on home as in the wallet.
// Loose typedefs — lucide-react-native and brand SVG components return
// slightly different React node shapes, but we only call them with
// these two prop sets, so accept anything that takes them.
type BrandIcon = React.ComponentType<{ size: number; color: string; fill?: string; knockout?: string }>;
type GlyphIcon = React.ComponentType<{ size: number; color: string; strokeWidth?: number }>;
export type VoucherTheme = {
  bg: string;
  border: string;
  accent: string;            // for the Use pill + category label
  fg: string;                // primary text
  fgDim: string;             // secondary text (expiry / urgency / category label)
  iconBg: string;            // tinted tile behind the brand icon
  iconColor: string;         // brand-icon stroke / fill
  iconKind: "brand" | "glyph";
  brandIcon?: BrandIcon;
  glyphIcon?: GlyphIcon;
};

// Four source-bucket themes — answer "where did this reward come from?"
// at a glance, before the customer reads the title. Each bucket pairs a
// distinct background + accent so a deck of mixed rewards reads as four
// visually grouped families:
//   • Challenge (missions)             → espresso + gold (Sparkles)
//   • Mystery   (mystery bag outcomes) → espresso + gold (Gift) — same
//                                        celebratory palette as the
//                                        Mystery Bean pre-reveal card;
//                                        icon differentiates from
//                                        Challenge.
//   • Gift      (birthday, welcome,    → peach + terracotta
//                referral, promo)
//   • Bean      (catalogue / points    → terracotta + gold
//                redemption)
// Each theme can be overridden per-reward-kind from the backoffice
// (reward_kinds.color). When a voucher / mission outcome / mystery
// outcome references a kind with a custom colour, it wins over the
// bucket default — falls back to the bucket when null.

export const THEME_CHALLENGE: VoucherTheme = {
  bg:         "#1A0200",  // espresso
  border:     "rgba(251,191,36,0.32)",
  accent:     "#FBBF24",  // gold
  fg:         "#FFFFFF",
  fgDim:      "rgba(255,255,255,0.65)",
  iconBg:     "rgba(251,191,36,0.20)",
  iconColor:  "#FBBF24",
  iconKind:   "glyph",
  glyphIcon:  Sparkles,
};

export const THEME_MYSTERY: VoucherTheme = {
  // Saffron-yellow surface + espresso ink. Matches the bright gold
  // used on the home rewards rail's yellow tickets, so a wallet
  // mystery voucher and its home-rail counterpart read as the same
  // family. Espresso ink (instead of pure #000) keeps the type on
  // brand while staying high-contrast on the yellow base.
  bg:         "#FBBF24",  // saffron yellow (Tailwind amber-400)
  border:     "rgba(26,2,0,0.25)",
  accent:     "#1A0200",  // espresso ink
  fg:         "#1A0200",
  fgDim:      "rgba(26,2,0,0.65)",
  iconBg:     "rgba(26,2,0,0.12)",
  iconColor:  "#1A0200",
  iconKind:   "glyph",
  glyphIcon:  Gift,
};

export const THEME_GIFT: VoucherTheme = {
  bg:         "#F4D3B0",  // warm peach
  border:     "rgba(162,73,44,0.28)",
  accent:     "#A2492C",  // terracotta
  fg:         "#1A0200",
  fgDim:      "rgba(26,2,0,0.62)",
  iconBg:     "rgba(162,73,44,0.14)",
  iconColor:  "#A2492C",
  iconKind:   "glyph",
  glyphIcon:  Gift,
};

export const THEME_BEAN: VoucherTheme = {
  bg:         "#A2492C",  // terracotta
  border:     "rgba(251,191,36,0.36)",
  accent:     "#FBBF24",  // gold
  fg:         "#FFFFFF",
  fgDim:      "rgba(255,245,225,0.78)",
  iconBg:     "rgba(255,245,225,0.18)",
  iconColor:  "#FBBF24",
  iconKind:   "glyph",
  glyphIcon:  Ticket,
};

// Map a source_type to one of the four bucket themes. Source is the
// strongest signal for "where did this come from" so it drives the
// theme; category (free_item / discount / etc.) only nudges icon
// selection inside pickRewardIcon().
export function themeForSource(source: Voucher["source_type"] | null | undefined): VoucherTheme {
  switch (source) {
    case "mission":            return THEME_CHALLENGE;
    case "mystery":            return THEME_MYSTERY;
    case "birthday":           return THEME_GIFT;
    case "referral":           return THEME_GIFT;
    case "manual":             return THEME_GIFT;
    case "points_redemption":  return THEME_BEAN;
    default:                    return THEME_GIFT;  // welcome / unknown promo
  }
}

// Apply a per-kind colour override on top of a base theme. The
// backoffice (reward_kinds.color / illustration_url) lets admin tune a
// specific kind's card colour without touching code. When colour is
// set, we recompute border / iconBg / accent against the override so
// the card stays internally consistent.
function withKindOverride(base: VoucherTheme, color: string | null | undefined): VoucherTheme {
  if (!color || !/^#[0-9a-fA-F]{3,8}$/.test(color)) return base;
  // Override only the accent (pill + eyebrow + icon stroke). Background
  // stays bucket-default so the four-family read survives — the
  // override is a per-kind highlight, not a full re-skin.
  return {
    ...base,
    accent:    color,
    iconColor: color,
    border:    `${color}55`,  // ~33% alpha border
    iconBg:    `${color}22`,  // ~13% alpha tile
  };
}

// Resolve theme for a wallet voucher: bucket from source, optional
// per-kind accent override.
export function themeForVoucher(v: Voucher): VoucherTheme {
  const base = themeForSource(v.source_type ?? null);
  return withKindOverride(base, (v as { kind_color?: string | null }).kind_color);
}

// Legacy export — five voucher categories all mapped to source-derived
// themes. Kept so existing callers that pass a category-keyed lookup
// keep compiling; new code should call themeForSource / themeForVoucher
// directly.
export const VOUCHER_THEME: Record<Voucher["category"], VoucherTheme> = {
  free_item:  THEME_GIFT,
  discount:   THEME_BEAN,
  upgrade:    THEME_BEAN,
  multiplier: THEME_MYSTERY,
  special:    THEME_GIFT,
};

type Props = {
  vouchers: Voucher[];
  maxVisible?: number;
  /** Hide the "View all" link — useful when this is already the full list (Vouchers tab). */
  hideViewAll?: boolean;
};

// Category chips for filtering — shown when wallet has >5 vouchers so
// the customer can find the one they want without scrolling.
const FILTER_CATS: Array<{ id: "all" | Voucher["category"]; label: string }> = [
  { id: "all",        label: "All" },
  { id: "free_item",  label: "Free items" },
  { id: "upgrade",    label: "Add-ons" },
  { id: "discount",   label: "Discounts" },
  { id: "multiplier", label: "Boosts" },
];

export function VoucherWallet({ vouchers, maxVisible = 3, hideViewAll = false }: Props) {
  const [filter, setFilter] = useState<"all" | Voucher["category"]>("all");

  // Wallet shows passively-earned / surprise vouchers only — Mystery,
  // Challenge, Birthday, Referral, Promo. Bean-Points redemptions
  // (catalog purchases the customer just made with their beans) are
  // intentionally excluded so the wallet reads as "rewards I got",
  // not "things I bought a moment ago + things I got". The
  // points-shop redemption flow auto-stages the voucher onto the
  // next order, so the customer doesn't need the wallet row to find it.
  const active = useMemo(
    () =>
      vouchers.filter(
        (v) => v.status === "active" && v.source_type !== "points_redemption",
      ),
    [vouchers],
  );
  const filtered = useMemo(
    () => (filter === "all" ? active : active.filter((v) => v.category === filter)),
    [active, filter],
  );

  if (active.length === 0) return null;

  const sorted = [...filtered].sort((a, b) => {
    const ax = a.expires_at ? new Date(a.expires_at).getTime() : Infinity;
    const bx = b.expires_at ? new Date(b.expires_at).getTime() : Infinity;
    return ax - bx;
  });

  const shown = sorted.slice(0, maxVisible);
  const hasMore = !hideViewAll && sorted.length > maxVisible;

  // Show filter chips only when wallet is busy enough to warrant them.
  // The threshold avoids the chip row taking visual weight on a single
  // voucher wallet where it'd just be noise.
  const showFilter = !hideViewAll ? false : active.length > 5;
  const availableCats = new Set(active.map((v) => v.category));

  return (
    <View className="mt-6">
      <View className="flex-row items-center justify-between mb-2.5 px-1">
        <Text
          className="text-espresso text-[12px] uppercase"
          style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 1.8 }}
        >
          My Rewards · {active.length}
        </Text>
        {/* "View all" link removed — /vouchers as a dedicated list page
            no longer exists. The whole wallet renders inline on the
            Rewards tab now. */}
      </View>

      {showFilter && (
        <View
          className="flex-row mb-2"
          style={{ gap: 6, flexWrap: "wrap" }}
        >
          {FILTER_CATS.filter((c) => c.id === "all" || availableCats.has(c.id as Voucher["category"])).map((c) => {
            const isActive = filter === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => { Haptics.selectionAsync(); setFilter(c.id); }}
                className="active:opacity-70"
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 5,
                  borderRadius: 100,
                  backgroundColor: isActive ? "#1A0200" : "#FFFFFF",
                  borderWidth: 1,
                  borderColor: isActive ? "#1A0200" : "rgba(26,2,0,0.10)",
                }}
              >
                <Text
                  style={{
                    fontFamily: "SpaceGrotesk_700Bold",
                    fontSize: 11,
                    color: isActive ? "#FBBF24" : "#1A0200",
                    letterSpacing: 0.5,
                  }}
                >
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={{ gap: 8 }}>
        {sorted.length === 0 ? (
          <Text
            className="text-muted-fg text-[12px] text-center py-6"
            style={{ fontFamily: "SpaceGrotesk_500Medium" }}
          >
            No rewards in this category
          </Text>
        ) : (
          shown.map((v) => <VoucherRow key={v.id} voucher={v} />)
        )}
      </View>
    </View>
  );
}

// Source-driven eyebrow — answers "where did I get this?". Wallet
// vouchers used to read out category ("Free Item" / "Discount") which
// told the customer WHAT the reward was; the unified rewards list cares
// more about WHERE the reward came from since the deck mixes earned,
// purchased, and challenge rewards on one screen. Falls back to a
// generic label when source_type is unset (legacy rows).
function voucherSourceLabel(v: Voucher): string {
  switch (v.source_type) {
    case "mystery":            return "Mystery Bag";
    case "birthday":           return "Birthday Gift";
    case "referral":           return "Referral Gift";
    case "manual":             return "Promo";
    case "points_redemption":  return "Bean Points";
    case "mission":            return "Challenge";
    default:                    return "Reward";
  }
}

export function VoucherRow({ voucher }: { voucher: Voucher }) {
  const theme = themeForVoucher(voucher);
  const urgency = voucherUrgencyLabel(voucher);
  const setReservedVoucher = useApp((s) => s.setReservedVoucher);
  const setAppliedReward = useApp((s) => s.setAppliedReward);

  function useNow() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Reserve voucher (banner) AND apply it to the discount engine so
    // cart + checkout reflect the line item immediately. The two are
    // intentionally coupled — they always travel together. We set
    // appliedReward unconditionally even when discount_type is null
    // (legacy vouchers backfilled later) — calcRewardDiscount returns
    // 0 for unknown types, so the chip stays visible and the customer
    // sees the voucher staked out for their next order. The eventual
    // backfill / proper template config lights up the actual discount.
    setReservedVoucher({
      id: voucher.id,
      title: voucher.title,
      category: voucher.category,
      icon: voucher.icon,
      expires_at: voucher.expires_at,
    });
    setAppliedReward({
      id: voucher.id,
      name: voucher.title,
      points_required: 0,         // wallet vouchers cost no Points
      discount_type: voucher.discount_type
        ? mapDiscountType(voucher.discount_type)
        : null,
      discount_value: voucher.discount_value ?? null,
      applicable_categories: voucher.applicable_categories ?? null,
      applicable_products: voucher.applicable_products ?? null,
      free_product_name: voucher.free_product_name ?? null,
      min_order_value: voucher.min_order_value ?? null,
      voucher_id: voucher.id,    // marks this as a wallet voucher (not a points redemption)
    });
    router.push("/menu" as never);
  }

  // Source-driven eyebrow — see voucherSourceLabel above.
  const categoryLabel = voucherSourceLabel(voucher);

  // Picks the right text colour for the Use pill's label so it has
  // contrast on whatever the category theme sets the accent to.
  const useFgIsLight = (
    theme.accent === "#FBBF24" || theme.accent === "#FFFFFF" || theme.accent === "#D99404"
  );
  const usePillFg = useFgIsLight ? "#1A0200" : "#FFFFFF";

  return (
    <Pressable
      onPress={useNow}
      className="active:opacity-90"
      style={{
        borderRadius: 18,
        overflow: "hidden",
        backgroundColor: theme.bg,
        borderWidth: 1,
        borderColor: theme.border,
        shadowColor: "#000",
        shadowOpacity: 0.12,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
      }}
    >
      {/* Decorative brand ghost — large translucent CelsiusCup mascot
          tucked in the bottom-right, mirroring the TierHeroCard mascot
          placement. Stays out of the way of text + the Use pill. */}
      <View
        style={{
          position: "absolute",
          right: -10,
          bottom: -16,
          opacity: 0.12,
        }}
      >
        {theme.iconKind === "brand" && theme.brandIcon
          ? <theme.brandIcon size={120} color={theme.iconColor} />
          : theme.glyphIcon
            ? <theme.glyphIcon size={120} color={theme.iconColor} />
            : null}
      </View>

      <View
        style={{
          paddingHorizontal: 14,
          paddingVertical: 14,
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
        }}
      >
        {/* Foreground icon tile — Celsius illustration if set on the
            linked reward_kind, else fall back to a category-aware
            Lucide glyph so empty backoffice config never reads as
            broken. */}
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            backgroundColor: theme.iconBg,
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {voucher.illustration_url ? (
            <Image
              source={{ uri: voucher.illustration_url }}
              style={{ width: 40, height: 40 }}
              resizeMode="contain"
            />
          ) : (() => {
            const RewardIcon = pickRewardIcon(voucher.title, voucher.icon);
            return <RewardIcon size={24} color={theme.iconColor} strokeWidth={2} />;
          })()}
        </View>

        {/* Title + meta */}
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontFamily: "SpaceGrotesk_700Bold",
              fontSize: 9.5,
              letterSpacing: 1.4,
              color: theme.accent,
              textTransform: "uppercase",
              marginBottom: 3,
            }}
            numberOfLines={1}
          >
            {categoryLabel}
          </Text>
          <Text
            style={{
              fontFamily: "Peachi-Bold",
              fontSize: 17,
              color: theme.fg,
              lineHeight: 21,
            }}
            numberOfLines={1}
          >
            {voucher.title}
          </Text>
          <Text
            style={{
              marginTop: 2,
              color: urgency.warning ? "#FFB070" : theme.fgDim,
              fontFamily: "SpaceGrotesk_500Medium",
              fontSize: 11,
            }}
            numberOfLines={1}
          >
            {urgency.label}
          </Text>
        </View>

        {/* Use pill — solid accent so it stays as the obvious primary
            action on the card. */}
        <Pressable
          onPress={useNow}
          hitSlop={8}
          className="active:opacity-85"
          style={{
            backgroundColor: theme.accent,
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 999,
            flexDirection: "row",
            alignItems: "center",
            gap: 3,
          }}
        >
          <Text
            style={{
              color: usePillFg,
              fontFamily: "SpaceGrotesk_700Bold",
              fontSize: 11,
              letterSpacing: 0.8,
              textTransform: "uppercase",
            }}
          >
            Use
          </Text>
          <ChevronRight size={11} color={usePillFg} strokeWidth={2.4} />
        </Pressable>
      </View>
    </Pressable>
  );
}
