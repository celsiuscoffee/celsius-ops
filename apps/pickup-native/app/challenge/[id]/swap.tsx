// /challenge/[id]/swap — picker for swapping an active challenge.
//
// Flow:
//   1. Mount → fetch /swap-options
//   2. If can_swap=false, render an explanation (already swapped this
//      week, mission isn't eligible, no alternatives in pool)
//   3. Otherwise render up to 3 candidate cards. Tapping one fires
//      /swap. On success, invalidate the active-missions query so the
//      Rewards tab + detail page re-render with the new mission, then
//      pop back to the (now-replaced) detail screen.

import { useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { Alert } from "@/lib/alert";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, ChevronRight, Sparkles, Info } from "lucide-react-native";
import { EspressoHeader } from "../../../components/EspressoHeader";
import { CelsiusLoader } from "../../../components/CelsiusLoader";
import { THEME_CHALLENGE, pickRewardIcon } from "../../../components/VoucherWallet";
import { useApp } from "../../../lib/store";
import {
  fetchSwapOptions,
  confirmSwap,
  type SwapOption,
  type ActiveMission,
} from "../../../lib/rewards-v2";

function formatGoal(option: SwapOption): string {
  switch (option.goal_type) {
    case "single_order_total_at_least":
      return `Spend RM${Math.floor(option.goal_threshold / 100)} in one order`;
    case "spend_amount":
      return `Spend RM${Math.floor(option.goal_threshold / 100)} this week`;
    case "drinks_count":
    case "cups_count":
      return option.goal_threshold === 1
        ? "Order 1 drink"
        : `Order ${option.goal_threshold} drinks`;
    case "distinct_products":
    case "distinct_drinks_count":
      return `Try ${option.goal_threshold} new items`;
    case "single_order_items_count":
      return `${option.goal_threshold}+ items in one order`;
    case "drink_and_food":
      return "One drink + one food item";
    default:
      return option.description;
  }
}

function reasonCopy(reason: string | null): { title: string; body: string } {
  switch (reason) {
    case "already_swapped_this_week":
      return {
        title: "You've already swapped this week",
        body: "You get one free swap per week. Your next swap unlocks on Monday.",
      };
    case "mission_not_swap_eligible":
      return {
        title: "This challenge can't be swapped",
        body: "Featured challenges stay locked to all customers for the week.",
      };
    case "assignment_not_active":
      return {
        title: "Nothing to swap",
        body: "This challenge has already been completed or expired.",
      };
    case "no_alternatives":
      return {
        title: "No swaps available right now",
        body: "You've tried most of our challenges recently. Check back next week.",
      };
    default:
      return {
        title: "Swap unavailable",
        body: "We couldn't load swap options. Try again later.",
      };
  }
}

export default function ChallengeSwap() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const phone = useApp((s) => s.phone);
  const qc = useQueryClient();
  const [committingId, setCommittingId] = useState<string | null>(null);

  const optionsQ = useQuery({
    queryKey: ["swap-options", id],
    queryFn: () => fetchSwapOptions(id),
    enabled: !!phone && !!id,
    staleTime: 30_000,
  });

  const handlePick = async (option: SwapOption) => {
    if (committingId) return;
    setCommittingId(option.mission_id);
    const result = await confirmSwap(id, option.mission_id);
    setCommittingId(null);

    if (!result.ok) {
      Alert.alert(
        "Couldn't swap",
        reasonCopy(result.error ?? null).body,
      );
      return;
    }

    // Splice the updated assignment into the active-missions cache so
    // the previous screen reflects the new mission without a refetch.
    if (result.updated_assignment && phone) {
      qc.setQueryData<ActiveMission[]>(["active-missions", phone], (prev) =>
        (prev ?? []).map((m) =>
          m.assignment_id === id ? (result.updated_assignment as ActiveMission) : m,
        ),
      );
    }
    // Also kill the cached swap-options for this assignment — the
    // member can't swap again this week, so a re-mount of this screen
    // should re-fetch and show the "already swapped" state.
    qc.invalidateQueries({ queryKey: ["swap-options", id] });

    // Back to the detail screen, which now reads the new mission.
    router.back();
  };

  if (optionsQ.isLoading) {
    return (
      <View className="flex-1 bg-background">
        <Stack.Screen options={{ headerShown: false }} />
        <EspressoHeader title="Swap challenge" showBack showCart={false} />
        <View className="flex-1 items-center justify-center">
          <CelsiusLoader size="md" />
        </View>
      </View>
    );
  }

  const data = optionsQ.data;
  if (!data || !data.can_swap) {
    const copy = reasonCopy(data?.reason ?? null);
    return (
      <View className="flex-1 bg-background">
        <Stack.Screen options={{ headerShown: false }} />
        <EspressoHeader title="Swap challenge" showBack showCart={false} />
        <View className="flex-1 items-center justify-center px-8">
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              backgroundColor: "rgba(217,148,4,0.18)",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <Info size={28} color="#A37200" strokeWidth={2.2} />
          </View>
          <Text
            style={{
              fontFamily: "Peachi-Bold",
              fontSize: 20,
              color: "#1A0200",
              textAlign: "center",
            }}
          >
            {copy.title}
          </Text>
          <Text
            style={{
              marginTop: 8,
              fontFamily: "SpaceGrotesk_500Medium",
              fontSize: 14,
              color: "rgba(26,2,0,0.65)",
              textAlign: "center",
              lineHeight: 20,
            }}
          >
            {copy.body}
          </Text>
          <Pressable
            onPress={() => router.back()}
            className="active:opacity-85"
            style={{
              marginTop: 24,
              backgroundColor: "#1A0200",
              paddingHorizontal: 24,
              paddingVertical: 12,
              borderRadius: 999,
            }}
          >
            <Text
              style={{
                color: "#FFFFFF",
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 12,
                letterSpacing: 1.2,
                textTransform: "uppercase",
              }}
            >
              Back to challenge
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const theme = THEME_CHALLENGE;

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <EspressoHeader title="Swap challenge" showBack showCart={false} />

      <ScrollView contentContainerClassName="pb-24" style={{ paddingHorizontal: 16 }}>
        <View style={{ marginTop: 16, marginBottom: 4, flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: "rgba(217,148,4,0.18)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ArrowRightLeft size={18} color="#A37200" strokeWidth={2.2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontFamily: "Peachi-Bold",
                fontSize: 18,
                color: "#1A0200",
                lineHeight: 22,
              }}
            >
              Pick your new challenge
            </Text>
            <Text
              style={{
                marginTop: 2,
                fontFamily: "SpaceGrotesk_500Medium",
                fontSize: 13,
                color: "rgba(26,2,0,0.65)",
                lineHeight: 18,
              }}
            >
              You get one free swap per week. Choose carefully — your
              progress will reset to zero on the new challenge.
            </Text>
          </View>
        </View>

        <View style={{ marginTop: 14, gap: 10 }}>
          {data.options.map((option) => {
            const Icon = pickRewardIcon(option.reward_summary);
            const committing = committingId === option.mission_id;
            const disabled = !!committingId && !committing;
            return (
              <Pressable
                key={option.mission_id}
                onPress={() => handlePick(option)}
                disabled={!!committingId}
                className={disabled ? "" : "active:opacity-90"}
                style={{
                  borderRadius: 18,
                  backgroundColor: theme.bg,
                  borderWidth: 1,
                  borderColor: committing ? theme.accent : theme.bg,
                  padding: 16,
                  opacity: disabled ? 0.5 : 1,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
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
                    <Icon size={24} color={theme.iconColor} strokeWidth={2} />
                  </View>
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
                    >
                      Challenge
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
                      {option.title}
                    </Text>
                    <Text
                      style={{
                        marginTop: 2,
                        fontFamily: "SpaceGrotesk_500Medium",
                        fontSize: 12,
                        color: theme.fgDim,
                        lineHeight: 16,
                      }}
                      numberOfLines={2}
                    >
                      {formatGoal(option)}
                    </Text>
                    <View
                      style={{
                        marginTop: 8,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <Sparkles size={13} color={theme.accent} strokeWidth={2.2} />
                      <Text
                        style={{
                          fontFamily: "Peachi-Bold",
                          fontSize: 13.5,
                          color: theme.accent,
                          letterSpacing: -0.1,
                        }}
                        numberOfLines={1}
                      >
                        {option.reward_summary}
                      </Text>
                    </View>
                  </View>
                  <ChevronRight size={18} color={theme.fgDim} strokeWidth={2.2} />
                </View>

                {committing ? (
                  <View
                    style={{
                      marginTop: 12,
                      backgroundColor: theme.accent,
                      paddingVertical: 8,
                      borderRadius: 999,
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={{
                        color: "#1A0200",
                        fontFamily: "SpaceGrotesk_700Bold",
                        fontSize: 11,
                        letterSpacing: 1.2,
                        textTransform: "uppercase",
                      }}
                    >
                      Swapping…
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        {data.options.length < 3 ? (
          <Text
            style={{
              marginTop: 16,
              fontFamily: "SpaceGrotesk_500Medium",
              fontSize: 12,
              color: "rgba(26,2,0,0.55)",
              textAlign: "center",
            }}
          >
            Fewer alternatives this week — you've tried most of our
            challenges recently. Cooldowns reset over time.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
