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
import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";
import { Sparkles, ChevronRight } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { type Voucher, voucherUrgencyLabel } from "../lib/rewards-v2";
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

export const VOUCHER_THEME: Record<Voucher["category"], VoucherTheme> = {
  free_item: {
    bg:         "#1A0200",
    border:     "rgba(251,191,36,0.32)",
    accent:     "#FBBF24",
    fg:         "#FFF6E0",
    fgDim:      "rgba(255,246,224,0.66)",
    iconBg:     "rgba(251,191,36,0.20)",
    iconColor:  "#FBBF24",
    iconKind:   "brand",
    brandIcon:  CelsiusCup,
  },
  discount: {
    bg:         "#C05040",
    border:     "rgba(255,255,255,0.30)",
    accent:     "#FFFFFF",
    fg:         "#FFFFFF",
    fgDim:      "rgba(255,255,255,0.78)",
    iconBg:     "rgba(255,255,255,0.22)",
    iconColor:  "#FFFFFF",
    iconKind:   "brand",
    brandIcon:  CelsiusTag,
  },
  upgrade: {
    bg:         "#FBEBE8",
    border:     "rgba(192,80,64,0.22)",
    accent:     "#C05040",
    fg:         "#1A0200",
    fgDim:      "rgba(26,2,0,0.60)",
    iconBg:     "rgba(192,80,64,0.18)",
    iconColor:  "#C05040",
    iconKind:   "brand",
    brandIcon:  CelsiusGift,
  },
  multiplier: {
    bg:         "#FBBF24",
    border:     "rgba(26,2,0,0.14)",
    accent:     "#1A0200",
    fg:         "#1A0200",
    fgDim:      "rgba(26,2,0,0.65)",
    iconBg:     "rgba(26,2,0,0.10)",
    iconColor:  "#1A0200",
    iconKind:   "glyph",
    glyphIcon:  Sparkles,
  },
  special: {
    bg:         "#FFF6E0",
    border:     "rgba(217,148,4,0.30)",
    accent:     "#D99404",
    fg:         "#1A0200",
    fgDim:      "rgba(26,2,0,0.60)",
    iconBg:     "rgba(217,148,4,0.22)",
    iconColor:  "#D99404",
    iconKind:   "brand",
    brandIcon:  CelsiusGift,
  },
};

export function themeForVoucher(v: Voucher): VoucherTheme {
  return VOUCHER_THEME[v.category] ?? VOUCHER_THEME.special;
}

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

  const active = useMemo(() => vouchers.filter((v) => v.status === "active"), [vouchers]);
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
          My Vouchers · {active.length}
        </Text>
        {hasMore && (
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              router.push("/vouchers" as never);
            }}
            hitSlop={8}
            className="flex-row items-center gap-0.5 active:opacity-70"
          >
            <Text className="text-primary text-[12px]" style={{ fontFamily: "Peachi-Bold" }}>
              View all
            </Text>
            <ChevronRight size={12} color="#C05040" strokeWidth={2.2} />
          </Pressable>
        )}
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
            No vouchers in this category
          </Text>
        ) : (
          shown.map((v) => <VoucherRow key={v.id} voucher={v} />)
        )}
      </View>
    </View>
  );
}

function VoucherRow({ voucher }: { voucher: Voucher }) {
  const theme = themeForVoucher(voucher);
  const urgency = voucherUrgencyLabel(voucher);
  const setReservedVoucher = useApp((s) => s.setReservedVoucher);
  const setAppliedReward = useApp((s) => s.setAppliedReward);

  function openDetail() {
    Haptics.selectionAsync();
    router.push(`/voucher/${voucher.id}` as never);
  }

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
      points_required: 0,         // wallet vouchers cost no Beans
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

  // Friendly category label — mirrors what the Claim card shows.
  const categoryLabel = (
    voucher.category === "free_item" ? "Free Item"
      : voucher.category === "upgrade" ? "Add-on"
      : voucher.category === "discount" ? "Discount"
      : voucher.category === "multiplier" ? "Boost"
      : "Reward"
  );

  // Picks the right text colour for the Use pill's label so it has
  // contrast on whatever the category theme sets the accent to.
  const useFgIsLight = (
    theme.accent === "#FBBF24" || theme.accent === "#FFFFFF" || theme.accent === "#D99404"
  );
  const usePillFg = useFgIsLight ? "#1A0200" : "#FFFFFF";

  return (
    <Pressable
      onPress={openDetail}
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
        {/* Foreground brand icon tile. */}
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            backgroundColor: theme.iconBg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {theme.iconKind === "brand" && theme.brandIcon
            ? <theme.brandIcon size={28} color={theme.iconColor} />
            : theme.glyphIcon
              ? <theme.glyphIcon size={24} color={theme.iconColor} strokeWidth={2} />
              : null}
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
