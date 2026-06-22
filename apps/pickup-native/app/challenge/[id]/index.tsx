import { useMemo } from "react";
import { View, Text, ScrollView, Pressable, Alert } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "@/lib/haptics";
import type { AppliedReward } from "../../../lib/store";
import {
  Gift,
  Clock,
  Lock,
  Sparkles,
  Target,
  ChevronRight,
  ArrowRightLeft,
} from "lucide-react-native";
import { EspressoHeader } from "../../../components/EspressoHeader";
import { CelsiusLoader } from "../../../components/CelsiusLoader";
import { CelsiusGift } from "../../../components/brand/CelsiusGift";
import { THEME_CHALLENGE, pickRewardIcon } from "../../../components/VoucherWallet";
import { useApp } from "../../../lib/store";
import {
  fetchActiveMissions,
  fetchMyVouchers,
  voucherUrgencyLabel,
  type ActiveMission,
  type Voucher,
} from "../../../lib/rewards-v2";

// ─── Goal copy helpers ─────────────────────────────────────────────────
// Each known goal_type maps to a short rules block and a "how to win"
// hint, so the customer reads the detail page and knows exactly what
// behaviour the challenge is asking for. New goal types fall back to
// the mission's own `description` field — never blank.

function howToWin(m: ActiveMission): string[] {
  switch (m.goal_type) {
    case "single_order_total_at_least":
      return [
        `Spend at least RM${Math.floor(m.goal_threshold / 100)} in a single order.`,
        "Add-ons, sides and pastries all count toward the total.",
        "Discounts and vouchers don't reduce the qualifying amount.",
      ];
    case "spend_amount":
      return [
        `Spend RM${Math.floor(m.goal_threshold / 100)} in total this week.`,
        "Every order this week adds up — no single big bill needed.",
        "Discounts and vouchers don't reduce the qualifying amount.",
      ];
    case "drinks_count":
    case "cups_count":
      return [
        `Order ${m.goal_threshold} drinks before the challenge ends.`,
        "Drinks can be on the same order or split across visits.",
        "Both hot and iced count.",
      ];
    case "distinct_products":
    case "distinct_drinks_count":
      return [
        `Try ${m.goal_threshold} different items you haven't ordered before.`,
        "We only count the first time you ever buy a given item.",
        "Both drinks and food count unless the description says otherwise.",
      ];
    case "single_order_items_count":
      return [
        `Order ${m.goal_threshold}+ items in a single transaction.`,
        "Each individual cup or plate counts as one item.",
        "Mix and match across drinks and food.",
      ];
    case "drink_and_food":
      return [
        "Order at least one drink and one food item in the same order.",
        "Roti bakar, pastries and cakes all count as food.",
      ];
    default:
      return [m.description];
  }
}

function progressLabel(m: ActiveMission): string {
  if (m.goal_type === "single_order_total_at_least" || m.goal_type === "spend_amount") {
    return `RM${Math.floor(m.progress_current / 100)} of RM${Math.floor(m.goal_threshold / 100)}`;
  }
  return `${m.progress_current} of ${m.goal_threshold}`;
}

function remainingHint(m: ActiveMission): string {
  const remaining = Math.max(0, m.goal_threshold - m.progress_current);
  if (remaining === 0) return "You're done — claim your reward!";
  if (m.goal_type === "single_order_total_at_least" || m.goal_type === "spend_amount") {
    return `RM${Math.ceil(remaining / 100)} more to unlock`;
  }
  return remaining === 1 ? "1 more to unlock" : `${remaining} more to unlock`;
}

function expiryCopy(iso: string): { label: string; urgent: boolean } {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return { label: "Challenge ended", urgent: true };
  const hours = Math.ceil(ms / (1000 * 60 * 60));
  if (hours <= 24) return { label: `Ends in ${hours}h`, urgent: true };
  const days = Math.ceil(hours / 24);
  return { label: `Ends in ${days}d`, urgent: days <= 1 };
}

// ─── Screen ────────────────────────────────────────────────────────────

export default function ChallengeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const phone = useApp((s) => s.phone);
  const setReservedVoucher = useApp((s) => s.setReservedVoucher);
  const setAppliedReward = useApp((s) => s.setAppliedReward);

  // Reuses the same React Query key as the rewards tab so the screen
  // reads from the prewarmed cache on navigation — no spinner flash on
  // the typical card-tap entry.
  const missionsQ = useQuery({
    queryKey: ["active-missions", phone ?? "anon"],
    queryFn: fetchActiveMissions,
    enabled: !!phone,
    staleTime: 60_000,
  });
  const vouchersQ = useQuery({
    queryKey: ["my-vouchers", phone ?? "anon"],
    queryFn: fetchMyVouchers,
    enabled: !!phone,
    staleTime: 60_000,
  });

  const mission = useMemo(
    () => (missionsQ.data ?? []).find((m) => m.assignment_id === id) ?? null,
    [missionsQ.data, id],
  );

  // Try to surface the wallet voucher this mission pays out, when the
  // member has already completed it. Lets the Claim button route the
  // same way the rewards-tab USE pill does.
  const linkedVoucher = useMemo<Voucher | null>(() => {
    if (!mission || mission.status !== "completed") return null;
    return (
      (vouchersQ.data ?? []).find(
        (v) => v.source_type === "mission" && v.source_ref_id === mission.assignment_id,
      ) ?? null
    );
  }, [mission, vouchersQ.data]);

  if (missionsQ.isLoading) {
    return (
      <View className="flex-1 bg-background">
        <Stack.Screen options={{ headerShown: false }} />
        <EspressoHeader title="Challenge" showBack showCart={false} />
        <View className="flex-1 items-center justify-center">
          <CelsiusLoader size="md" />
        </View>
      </View>
    );
  }

  if (!mission) {
    return (
      <View className="flex-1 bg-background">
        <Stack.Screen options={{ headerShown: false }} />
        <EspressoHeader title="Challenge" showBack showCart={false} />
        <View className="flex-1 items-center justify-center px-8">
          <Text
            style={{
              fontFamily: "Peachi-Bold",
              fontSize: 20,
              color: "#1A0200",
              textAlign: "center",
            }}
          >
            Challenge not found
          </Text>
          <Text
            style={{
              marginTop: 8,
              fontFamily: "SpaceGrotesk_500Medium",
              fontSize: 14,
              color: "rgba(26,2,0,0.65)",
              textAlign: "center",
            }}
          >
            It may have already expired or rolled over to a new week.
          </Text>
        </View>
      </View>
    );
  }

  const theme = THEME_CHALLENGE;
  const Icon = pickRewardIcon(linkedVoucher?.title ?? mission.reward_summary);
  const expiry = expiryCopy(mission.week_end_at);
  const ratio = Math.min(1, mission.progress_current / Math.max(1, mission.goal_threshold));
  const isCompleted = mission.status === "completed";
  const isExpired = mission.status === "expired";
  const rules = howToWin(mission);

  const handleUse = () => {
    // Mirror of useCompletedChallenge → useWalletVoucher on the
    // Rewards tab: reserve the linked voucher in app state and pop
    // the customer onto /menu so they can build a cart and spend it.
    // Earlier this just routed to /rewards which made the customer
    // tap a second USE button there to do the same thing.
    if (!linkedVoucher) {
      Alert.alert(
        "Reward not ready",
        "Your reward will land in your wallet shortly. Try again in a moment.",
        [{ text: "OK", style: "default" }],
      );
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setReservedVoucher({
      id: linkedVoucher.id,
      title: linkedVoucher.title,
      category: linkedVoucher.category,
      icon: linkedVoucher.icon,
      expires_at: linkedVoucher.expires_at,
    });
    const dtMap = (t: NonNullable<Voucher["discount_type"]>): AppliedReward["discount_type"] => {
      switch (t) {
        case "free_item":        return "free_item";
        case "flat":             return "flat";
        case "percent":          return "percent";
        case "beans_multiplier": return "none";
        default:                  return "none";
      }
    };
    setAppliedReward({
      id: linkedVoucher.id,
      name: linkedVoucher.title,
      points_required: 0,
      discount_type: linkedVoucher.discount_type ? dtMap(linkedVoucher.discount_type) : null,
      discount_value: linkedVoucher.discount_value ?? null,
      applicable_categories: linkedVoucher.applicable_categories ?? null,
      applicable_products: linkedVoucher.applicable_products ?? null,
      free_product_name: linkedVoucher.free_product_name ?? null,
      min_order_value: linkedVoucher.min_order_value ?? null,
      voucher_id: linkedVoucher.id,
    });
    router.push("/menu" as never);
  };

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <EspressoHeader title="Challenge" showBack showCart={false} />

      <ScrollView contentContainerClassName="pb-24" style={{ paddingHorizontal: 16 }}>
        {/* ── Hero card ──────────────────────────────────── */}
        <View
          style={{
            marginTop: 16,
            borderRadius: 22,
            overflow: "hidden",
            backgroundColor: theme.bg,
            borderWidth: 1,
            borderColor: isCompleted ? theme.accent : theme.bg,
            opacity: isExpired ? 0.55 : 1,
          }}
        >
          {/* Decorative gift glyph */}
          <View style={{ position: "absolute", right: -20, bottom: -30, opacity: 0.10 }}>
            <CelsiusGift size={200} color={theme.iconColor} />
          </View>

          <View style={{ padding: 20 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 16,
                  backgroundColor: theme.iconBg,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon size={32} color={theme.iconColor} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily: "SpaceGrotesk_700Bold",
                    fontSize: 10,
                    letterSpacing: 1.6,
                    color: theme.accent,
                    textTransform: "uppercase",
                  }}
                >
                  Challenge{isCompleted ? " · Done" : isExpired ? " · Missed" : ""}
                </Text>
                <Text
                  style={{
                    marginTop: 3,
                    fontFamily: "Peachi-Bold",
                    fontSize: 22,
                    color: theme.fg,
                    lineHeight: 26,
                  }}
                >
                  {mission.title}
                </Text>
              </View>
            </View>

            <Text
              style={{
                marginTop: 16,
                fontFamily: "SpaceGrotesk_500Medium",
                fontSize: 14,
                color: theme.fgDim,
                lineHeight: 20,
              }}
            >
              {mission.description}
            </Text>
          </View>
        </View>

        {/* ── Reward callout ─────────────────────────────── */}
        <View
          style={{
            marginTop: 14,
            borderRadius: 18,
            backgroundColor: "#FFFBEA",
            borderWidth: 1,
            borderColor: "rgba(217,148,4,0.30)",
            padding: 16,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              backgroundColor: "rgba(217,148,4,0.18)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Gift size={22} color="#D99404" strokeWidth={2.2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 10,
                letterSpacing: 1.4,
                color: "#A37200",
                textTransform: "uppercase",
              }}
            >
              {isCompleted ? "You earned" : "You'll earn"}
            </Text>
            <Text
              style={{
                marginTop: 2,
                fontFamily: "Peachi-Bold",
                fontSize: 17,
                color: "#1A0200",
                lineHeight: 22,
              }}
            >
              {linkedVoucher?.title ?? mission.reward_summary}
            </Text>
            {/* Expiry hint — only shows after completion, once the
                voucher is in the wallet with a real expires_at. Tells
                the customer how long they have to spend the prize so
                they don't let it lapse silently. Reuses
                voucherUrgencyLabel so the copy matches the wallet
                tile ("Expires in 13 days" / "Expires today"). */}
            {isCompleted && linkedVoucher ? (() => {
              const u = voucherUrgencyLabel(linkedVoucher);
              if (!u.label) return null;
              return (
                <Text
                  style={{
                    marginTop: 6,
                    fontFamily: "SpaceGrotesk_700Bold",
                    fontSize: 11.5,
                    letterSpacing: 0.4,
                    color: u.warning ? "#B91C1C" : "#A37200",
                  }}
                  numberOfLines={1}
                >
                  {u.label}
                </Text>
              );
            })() : null}
          </View>
        </View>

        {/* ── Progress ───────────────────────────────────── */}
        <View
          style={{
            marginTop: 14,
            borderRadius: 18,
            backgroundColor: "#FFFFFF",
            borderWidth: 1,
            borderColor: "rgba(0,0,0,0.06)",
            padding: 16,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Target size={16} color="#1A0200" strokeWidth={2.4} />
            <Text
              style={{
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 10.5,
                letterSpacing: 1.4,
                color: "#1A0200",
                textTransform: "uppercase",
              }}
            >
              Your progress
            </Text>
          </View>

          <Text
            style={{
              marginTop: 10,
              fontFamily: "Peachi-Bold",
              fontSize: 28,
              color: "#1A0200",
              lineHeight: 32,
            }}
          >
            {progressLabel(mission)}
          </Text>
          <Text
            style={{
              marginTop: 2,
              fontFamily: "SpaceGrotesk_500Medium",
              fontSize: 12,
              color: isCompleted ? "#1F7A33" : "rgba(26,2,0,0.55)",
            }}
          >
            {isExpired ? "This challenge has ended." : remainingHint(mission)}
          </Text>

          <View
            style={{
              marginTop: 12,
              height: 8,
              borderRadius: 4,
              backgroundColor: "rgba(0,0,0,0.08)",
              overflow: "hidden",
            }}
          >
            <View
              style={{
                width: `${Math.round(ratio * 100)}%`,
                height: "100%",
                backgroundColor: isCompleted ? "#1F7A33" : "#D99404",
                borderRadius: 4,
              }}
            />
          </View>
        </View>

        {/* ── How to win ────────────────────────────────── */}
        <View
          style={{
            marginTop: 14,
            borderRadius: 18,
            backgroundColor: "#FFFFFF",
            borderWidth: 1,
            borderColor: "rgba(0,0,0,0.06)",
            padding: 16,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Sparkles size={16} color="#1A0200" strokeWidth={2.4} />
            <Text
              style={{
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 10.5,
                letterSpacing: 1.4,
                color: "#1A0200",
                textTransform: "uppercase",
              }}
            >
              How it works
            </Text>
          </View>

          <View style={{ marginTop: 10, gap: 8 }}>
            {rules.map((line, idx) => (
              <View key={idx} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: "#D99404",
                    marginTop: 7,
                  }}
                />
                <Text
                  style={{
                    flex: 1,
                    fontFamily: "SpaceGrotesk_500Medium",
                    fontSize: 13.5,
                    color: "rgba(26,2,0,0.80)",
                    lineHeight: 20,
                  }}
                >
                  {line}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Time remaining ────────────────────────────── */}
        <View
          style={{
            marginTop: 14,
            borderRadius: 18,
            backgroundColor: expiry.urgent && !isCompleted ? "#FFF1F0" : "#FFFFFF",
            borderWidth: 1,
            borderColor: expiry.urgent && !isCompleted ? "rgba(184,29,19,0.20)" : "rgba(0,0,0,0.06)",
            padding: 16,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: expiry.urgent && !isCompleted ? "rgba(184,29,19,0.15)" : "rgba(0,0,0,0.06)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Clock
              size={18}
              color={expiry.urgent && !isCompleted ? "#B81D13" : "#1A0200"}
              strokeWidth={2.2}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 10,
                letterSpacing: 1.4,
                color: expiry.urgent && !isCompleted ? "#B81D13" : "rgba(26,2,0,0.55)",
                textTransform: "uppercase",
              }}
            >
              {isExpired ? "Ended" : "Time left"}
            </Text>
            <Text
              style={{
                marginTop: 2,
                fontFamily: "Peachi-Bold",
                fontSize: 16,
                color: "#1A0200",
              }}
            >
              {expiry.label}
            </Text>
          </View>
        </View>

        {/* ── CTA: use the earned reward (completed) / locked (active) ─── */}
        {isCompleted ? (
          <Pressable
            onPress={handleUse}
            className="active:opacity-85"
            style={{
              marginTop: 18,
              backgroundColor: "#D99404",
              borderRadius: 16,
              paddingVertical: 16,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <Gift size={18} color="#FFFFFF" strokeWidth={2.4} />
            <Text
              style={{
                color: "#FFFFFF",
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 14,
                letterSpacing: 1.2,
                textTransform: "uppercase",
              }}
            >
              Use this reward
            </Text>
            <ChevronRight size={16} color="#FFFFFF" strokeWidth={2.4} />
          </Pressable>
        ) : !isExpired ? (
          <View
            style={{
              marginTop: 18,
              backgroundColor: "rgba(217,148,4,0.10)",
              borderWidth: 1,
              borderColor: "rgba(217,148,4,0.30)",
              borderRadius: 16,
              paddingVertical: 16,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <Lock size={14} color="#A37200" strokeWidth={2.4} />
            <Text
              style={{
                color: "#A37200",
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 12,
                letterSpacing: 1.2,
                textTransform: "uppercase",
              }}
            >
              Locked · keep ordering to unlock
            </Text>
          </View>
        ) : null}

        {/* ── Swap (active only) ─────────────────────────
            Routes to /challenge/[id]/swap which loads up to 3
            candidate missions. Server enforces 1 swap per week — this
            link surfaces it unconditionally for active challenges, and
            the picker screen renders the "already swapped" explainer
            when the cap is hit. */}
        {!isCompleted && !isExpired ? (
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/challenge/[id]/swap" as never,
                params: { id: mission.assignment_id },
              } as never)
            }
            className="active:opacity-85"
            style={{
              marginTop: 12,
              borderRadius: 16,
              paddingVertical: 14,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              backgroundColor: "transparent",
              borderWidth: 1,
              borderColor: "rgba(26,2,0,0.18)",
            }}
          >
            <ArrowRightLeft size={14} color="#1A0200" strokeWidth={2.4} />
            <Text
              style={{
                color: "#1A0200",
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 12,
                letterSpacing: 1.2,
                textTransform: "uppercase",
              }}
            >
              Swap this challenge
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}
