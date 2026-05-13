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

  const isAutoIssued = ["birthday", "mission", "mystery", "milestone", "referral"].includes(
    voucher.source_type ?? ""
  );
  const iconBg = isAutoIssued ? "#FBBF24" : "#FBEBE8";
  const iconColor = isAutoIssued ? "#1A0200" : "#C05040";

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

  return (
    <Pressable
      onPress={openDetail}
      className="bg-surface rounded-2xl border border-border p-3 flex-row items-center gap-3 active:opacity-70"
      style={{
        shadowColor: "#000",
        shadowOpacity: 0.04,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 1,
      }}
    >
      <View
        className="rounded-xl items-center justify-center"
        style={{ width: 42, height: 42, backgroundColor: iconBg }}
      >
        <Icon size={22} color={iconColor} strokeWidth={1.8} />
      </View>

      <View className="flex-1 min-w-0">
        <Text
          className="text-espresso text-[15px]"
          style={{ fontFamily: "Peachi-Bold" }}
          numberOfLines={1}
        >
          {voucher.title}
        </Text>
        <Text
          className="text-[11px] mt-0.5"
          style={{
            fontFamily: "SpaceGrotesk_500Medium",
            color: urgency.warning ? "#C05040" : "#6B6B6B",
            letterSpacing: 0.2,
          }}
          numberOfLines={1}
        >
          {urgency.label}
        </Text>
      </View>

      {/* Inline Use pill */}
      <Pressable
        onPress={useNow}
        hitSlop={8}
        className={`rounded-full flex-row items-center active:opacity-80 ${
          isAutoIssued ? "" : "bg-white"
        }`}
        style={{
          backgroundColor: isAutoIssued ? "#C05040" : "#FFFFFF",
          paddingHorizontal: 12,
          paddingVertical: 6,
          gap: 3,
          flexShrink: 0,
          borderWidth: isAutoIssued ? 0 : 1.5,
          borderColor: "#C05040",
        }}
      >
        <Text
          className="text-[12px]"
          style={{
            fontFamily: "Peachi-Bold",
            color: isAutoIssued ? "#FFFFFF" : "#C05040",
          }}
        >
          Use
        </Text>
        <ChevronRight
          size={11}
          color={isAutoIssued ? "#FFFFFF" : "#C05040"}
          strokeWidth={2.4}
        />
      </Pressable>
    </Pressable>
  );
}
