/**
 * VoucherWallet — voucher list section for the Rewards screen's Vouchers tab.
 *
 * Each row has an inline "Use" pill so the customer can go from
 * "I have a voucher" → "I'm starting to use it" in one tap.
 * The whole row is also pressable to open detail.
 *
 * Auto-issued (mission/mystery/birthday/milestone/referral) → amber icon
 * Points-redemption → terracotta-50 icon
 */

import { useState, useMemo } from "react";
import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";
import {
  Croissant, Plus, Sparkles, Percent, Ticket, ChevronRight,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { type Voucher, voucherUrgencyLabel } from "../lib/rewards-v2";
import { useApp, type AppliedReward } from "../lib/store";

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

const CATEGORY_ICON: Record<Voucher["category"], React.ComponentType<{ size: number; color: string; strokeWidth?: number }>> = {
  free_item:  Croissant,
  upgrade:    Plus,  // Celsius offers add-ons (extra shot, oat milk) — not size upgrades
  discount:   Percent,
  multiplier: Sparkles,
  special:    Ticket,
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
  const Icon = CATEGORY_ICON[voucher.category] ?? Ticket;
  const urgency = voucherUrgencyLabel(voucher);
  const setReservedVoucher = useApp((s) => s.setReservedVoucher);
  const setAppliedReward = useApp((s) => s.setAppliedReward);

  // Auto-issued vouchers (birthday/mission/mystery/milestone/referral)
  // wear an amber surface so they stand apart from points-shop redeems
  // at a glance. Same brand language as the tier-card mascot accent.
  const isAutoIssued = ["birthday", "mission", "mystery", "milestone", "referral"].includes(
    voucher.source_type ?? "",
  );
  const surfaceBg     = isAutoIssued ? "#FFF6E0" : "#FBEBE8";
  const surfaceBorder = isAutoIssued ? "rgba(217,148,4,0.22)" : "rgba(192,80,64,0.18)";
  const accent        = isAutoIssued ? "#D99404" : "#C05040";
  const iconTint      = isAutoIssued ? "rgba(217,148,4,0.18)" : "rgba(192,80,64,0.18)";

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

  return (
    <Pressable
      onPress={openDetail}
      className="active:opacity-80"
      style={{
        borderRadius: 16,
        overflow: "hidden",
        backgroundColor: surfaceBg,
        borderWidth: 1,
        borderColor: surfaceBorder,
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 1,
      }}
    >
      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        {/* Foreground icon — matches Claim card sizing. */}
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: iconTint,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon size={20} color={accent} strokeWidth={1.8} />
        </View>

        {/* Title + meta */}
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontFamily: "Peachi-Bold",
              fontSize: 14,
              color: "#1A0200",
            }}
            numberOfLines={1}
          >
            {voucher.title}
          </Text>
          <Text
            style={{
              marginTop: 1,
              color: urgency.warning ? "#C05040" : "rgba(26,2,0,0.60)",
              fontFamily: "SpaceGrotesk_500Medium",
              fontSize: 11,
            }}
            numberOfLines={1}
          >
            <Text
              style={{
                color: accent,
                fontFamily: "SpaceGrotesk_700Bold",
                letterSpacing: 1,
              }}
            >
              {categoryLabel.toUpperCase()}
            </Text>
            {"  ·  "}
            {urgency.label}
          </Text>
        </View>

        {/* Use pill — solid accent so it stays as the obvious primary
            action on the card. */}
        <Pressable
          onPress={useNow}
          hitSlop={8}
          className="active:opacity-80"
          style={{
            backgroundColor: accent,
            paddingHorizontal: 14,
            paddingVertical: 7,
            borderRadius: 999,
            flexDirection: "row",
            alignItems: "center",
            gap: 3,
          }}
        >
          <Text
            style={{
              color: "#FFFFFF",
              fontFamily: "SpaceGrotesk_700Bold",
              fontSize: 10.5,
              letterSpacing: 0.8,
              textTransform: "uppercase",
            }}
          >
            Use
          </Text>
          <ChevronRight size={11} color="#FFFFFF" strokeWidth={2.4} />
        </Pressable>
      </View>
    </Pressable>
  );
}
