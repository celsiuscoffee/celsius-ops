import { useMemo } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { Stack, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Gift, ChevronRight } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomNav } from "../components/BottomNav";
import { EspressoHeader } from "../components/EspressoHeader";
import { CelsiusLoader } from "../components/CelsiusLoader";
import { CelsiusCup } from "../components/brand/CelsiusCup";
import { CelsiusGift } from "../components/brand/CelsiusGift";
import { CelsiusTag } from "../components/brand/CelsiusTag";
import { tierStyle } from "../lib/tier-styles";
import * as Haptics from "expo-haptics";
import { useApp } from "../lib/store";
import { trackEvent } from "../lib/analytics";
import {
  fetchRewards,
  fetchTier,
  formatRewardValue,
  rewardUrgencyLabel,
  type Reward,
} from "../lib/rewards";
import { supabase } from "../lib/supabase";
import { TierCardCarousel, type TierLite } from "../components/TierCardCarousel";

// Locked rewards within this much of the customer's balance get a
// visible progress bar + "X to go" sub-line. Anything further out
// stays minimal so the list doesn't read as an unreachable ladder.
const PROGRESS_VISIBLE_THRESHOLD = 0.3;

export default function RewardsTab() {
  const phone = useApp((s) => s.phone);
  const loyaltyId = useApp((s) => s.loyaltyId);
  const member = useApp((s) => s.member);
  const insets = useSafeAreaInsets();

  // Tier — drives the hero theme + benefits card. Read via React Query
  // so the _layout.tsx prefetch (fired on loyaltyId resolve) populates
  // this view's cache. First-paint instead of post-RTT spinner.
  const tierQ = useQuery({
    queryKey: ["tier", loyaltyId],
    queryFn: () => (loyaltyId ? fetchTier(loyaltyId) : Promise.resolve(null)),
    enabled: !!loyaltyId,
    staleTime: 5 * 60_000,
  });
  const tier = tierQ.data ?? null;

  // Full tier ladder — drives the embedded carousel below the points
  // card so customers can see what each tier unlocks without leaving
  // the Rewards tab. Cached for 5 min; light SELECT so cheap to keep.
  const tiersQ = useQuery({
    queryKey: ["tiers"],
    queryFn: async () => {
      const { data: rows } = await supabase
        .from("tiers")
        .select("id,slug,name,min_visits,min_spend,multiplier,color,icon,benefits,benefit_rules,qualification_metric,sort_order")
        .eq("brand_id", "brand-celsius")
        .eq("is_active", true)
        .order("sort_order", { ascending: true, nullsFirst: true })
        .order("min_visits", { ascending: true, nullsFirst: true });
      return (rows ?? []) as TierLite[];
    },
    staleTime: 5 * 60_000,
  });
  const tiers = tiersQ.data ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ["rewards", phone ?? "anonymous"],
    queryFn: () => fetchRewards(phone),
    staleTime: 5 * 60_000,
  });

  const balance = data?.pointsBalance ?? 0;
  const rewards = data?.rewards ?? [];
  const ts = tierStyle(tier);

  // Single ordered list — easiest to redeem first. Drives both the
  // hero progress bar (cheapest unaffordable = "next reward") and the
  // unified rewards list below.
  const sortedRewards = useMemo(
    () => [...rewards].sort((a, b) => a.points_required - b.points_required),
    [rewards],
  );
  const nextReward = useMemo(
    () => sortedRewards.find((r) => r.points_required > balance) ?? null,
    [sortedRewards, balance],
  );
  const nextProgress = nextReward
    ? Math.max(0, Math.min(1, balance / nextReward.points_required))
    : 0;
  const nextShortBy = nextReward
    ? Math.max(0, nextReward.points_required - balance)
    : 0;

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />

      {/* Standard espresso header (matches Orders / Account). The
          old espresso balance card was removed — Points / Visits /
          Earned now fold into the tier carousel's current-tier card
          below, and per-reward progress lives on each row of the
          rewards catalogue. One source of truth per number. */}
      <EspressoHeader title="Rewards" showCart={false} />

      {/* Next-reward progress strip — slim flat line replacing the
          old espresso card. Keeps "X pts to <reward>" surfaced
          without duplicating the points number. */}
      {nextReward && (
        <View className="mx-4 mt-4">
          <View
            style={{
              height: 4,
              borderRadius: 2,
              backgroundColor: "rgba(26,2,0,0.10)",
              overflow: "hidden",
            }}
          >
            <View
              style={{
                height: "100%",
                width: `${nextProgress * 100}%`,
                backgroundColor: ts.accentColor,
                borderRadius: 2,
              }}
            />
          </View>
          <Text
            className="mt-2 text-[11px]"
            style={{ color: "rgba(26,2,0,0.6)", fontFamily: "SpaceGrotesk_500Medium" }}
            numberOfLines={1}
          >
            {`${nextShortBy.toLocaleString()} pts to ${nextReward.name}`}
          </Text>
        </View>
      )}

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {!phone ? (
          <SignInPrompt />
        ) : (
          <>
            {/* Tier ladder — themed carousel of every tier with the
                customer's current one auto-snapped. Tap any card to
                open the full Membership screen for that tier. Sits
                above the perks block + rewards list so customers
                immediately see "this is your tier — here's what's
                next" before they scan the redemption catalogue. */}
            {tiers.length > 0 && (
              <View style={{ marginHorizontal: -16, marginTop: -8, marginBottom: 8 }}>
                <TierCardCarousel
                  tiers={tiers}
                  currentSlug={tier?.tier_slug ?? null}
                  memberVisits={tier?.visits_this_period ?? 0}
                  memberSpend={tier?.spend_this_period ?? 0}
                  stats={{
                    points: balance,
                    visits: member?.totalVisits         ?? 0,
                    earned: member?.totalPointsEarned   ?? balance,
                  }}
                  title="Membership tiers"
                  onCardPress={() => {
                    Haptics.selectionAsync();
                    router.push("/tier-benefits" as never);
                  }}
                />
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    router.push("/tier-benefits" as never);
                  }}
                  className="mx-4 mt-3 active:opacity-70"
                  accessibilityRole="button"
                  accessibilityLabel="See all tier benefits"
                >
                  <Text
                    style={{
                      color: "#C05040",
                      fontFamily: "Peachi-Bold",
                      fontSize: 13,
                      textAlign: "right",
                    }}
                  >
                    See all tier benefits →
                  </Text>
                </Pressable>
              </View>
            )}

            {/* Tier perks — moved up so the answer to "what's special
                about being PLATINUM" lands before the rewards list,
                not as an afterthought at the bottom. */}
            {tier && tier.tier_benefits && tier.tier_benefits.length > 0 && (
              <View
                style={{
                  marginTop: 8,
                  marginBottom: 8,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: "rgba(26, 2, 0, 0.12)",
                  padding: 14,
                }}
              >
                <Text
                  style={{
                    color: "rgba(26, 2, 0, 0.55)",
                    fontFamily: "SpaceGrotesk_700Bold",
                    fontSize: 10,
                    letterSpacing: 2.5,
                    textTransform: "uppercase",
                    marginBottom: 8,
                  }}
                >
                  {`${ts.displayName} perks`}
                </Text>
                {tier.tier_benefits.map((b, i) => (
                  <View
                    key={i}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      paddingVertical: 4,
                    }}
                  >
                    <View
                      style={{
                        width: 4,
                        height: 4,
                        borderRadius: 2,
                        backgroundColor: "#C05040",
                      }}
                    />
                    <Text
                      style={{
                        color: "#1A0200",
                        fontFamily: "SpaceGrotesk_500Medium",
                        fontSize: 14,
                      }}
                    >
                      {b}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Empty state — only when fetch is done and no rewards */}
            {!isLoading && rewards.length === 0 && (
              <View className="py-12 items-center">
                <Gift size={36} color="#C05040" strokeWidth={1.25} />
                <Text
                  className="text-[15px] mt-3"
                  style={{ color: "#160800", fontFamily: "Peachi-Bold" }}
                >
                  No rewards yet
                </Text>
                <Text
                  className="text-[12px] text-center mt-1.5"
                  style={{ color: "#8E8E93", fontFamily: "SpaceGrotesk_400Regular" }}
                >
                  Check back soon — new rewards drop regularly.
                </Text>
              </View>
            )}

            {isLoading && rewards.length === 0 && (
              <View className="py-12 items-center">
                <CelsiusLoader size="md" />
              </View>
            )}

            {/* Unified rewards list — replaces the prior "Claim now" /
                "Redeem" split. One ordered ladder, easiest first.
                Affordable rows get the terracotta Apply pill;
                in-reach locked rows show a thin progress bar; far-off
                ones stay minimal so the list doesn't read as an
                unreachable wall. */}
            {sortedRewards.length > 0 && (
              <View style={{ marginTop: 4 }}>
                <Text
                  style={{
                    color: "rgba(26, 2, 0, 0.55)",
                    fontFamily: "SpaceGrotesk_700Bold",
                    fontSize: 10,
                    letterSpacing: 2.5,
                    textTransform: "uppercase",
                    marginTop: 16,
                    marginBottom: 8,
                  }}
                >
                  Your rewards
                </Text>
                {sortedRewards.map((reward, i) => (
                  <RewardListRow
                    key={reward.id}
                    reward={reward}
                    balance={balance}
                    isFirst={i === 0}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <BottomNav />
    </View>
  );
}

// ─── reward row ───

function RewardListRow({
  reward,
  balance,
  isFirst,
}: {
  reward: Reward;
  balance: number;
  isFirst: boolean;
}) {
  const appliedReward = useApp((s) => s.appliedReward);
  const setAppliedReward = useApp((s) => s.setAppliedReward);
  const cart = useApp((s) => s.cart);
  const isApplied = appliedReward?.id === reward.id;

  const required = reward.points_required;
  const canClaim = balance >= required;
  const progress = required > 0 ? Math.max(0, Math.min(1, balance / required)) : 1;
  const shortBy = Math.max(0, required - balance);
  const showProgress = !canClaim && progress >= PROGRESS_VISIBLE_THRESHOLD;

  const urgency = canClaim ? rewardUrgencyLabel(reward) : null;

  const onApply = () => {
    if (!canClaim) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    trackEvent("reward_applied", {
      rewardId:        reward.id,
      rewardName:      reward.name,
      rewardType:      reward.reward_type,
      discountType:    reward.discount_type,
      pointsRequired:  reward.points_required,
      isVoucher:       !!(reward as { voucher_id?: string }).voucher_id,
    });
    setAppliedReward({
      id: reward.id,
      name: reward.name,
      points_required: reward.points_required,
      discount_type: reward.discount_type,
      discount_value: reward.discount_value,
      bogo_buy_qty: reward.bogo_buy_qty,
      bogo_free_qty: reward.bogo_free_qty,
      free_product_name: reward.free_product_name,
      applicable_categories: reward.applicable_categories,
      applicable_products: reward.applicable_products,
      min_order_value: reward.min_order_value,
    });
    if (cart.length > 0) router.push("/cart");
  };

  const Icon = pickRewardIcon(reward);
  const iconColor = canClaim ? "#C05040" : "rgba(26, 2, 0, 0.45)";

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 12,
        borderTopWidth: isFirst ? 0 : 1,
        borderTopColor: "rgba(26, 2, 0, 0.08)",
        opacity: !canClaim && !showProgress ? 0.55 : 1,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: canClaim ? "rgba(192, 80, 64, 0.10)" : "rgba(26, 2, 0, 0.06)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={22} color={iconColor} />
      </View>

      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Text
            style={{
              color: "#1A0200",
              fontFamily: "SpaceGrotesk_700Bold",
              fontSize: 15,
              flexShrink: 1,
            }}
            numberOfLines={1}
          >
            {reward.name}
          </Text>
          {urgency && (
            <View
              style={{
                backgroundColor: "#C05040",
                borderRadius: 999,
                paddingHorizontal: 6,
                paddingVertical: 1.5,
              }}
            >
              <Text
                style={{ color: "#FFFFFF", fontFamily: "Peachi-Bold", fontSize: 9 }}
              >
                {urgency}
              </Text>
            </View>
          )}
        </View>
        <Text
          style={{
            color: "rgba(26, 2, 0, 0.55)",
            fontFamily: "SpaceGrotesk_400Regular",
            fontSize: 12,
            marginTop: 2,
          }}
          numberOfLines={1}
        >
          {formatRewardValue(reward)}
        </Text>
        {showProgress && (
          <View style={{ marginTop: 6 }}>
            <View
              style={{
                height: 3,
                borderRadius: 2,
                backgroundColor: "rgba(26, 2, 0, 0.08)",
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  height: "100%",
                  width: `${progress * 100}%`,
                  backgroundColor: "#C05040",
                }}
              />
            </View>
            <Text
              style={{
                color: "rgba(26, 2, 0, 0.55)",
                fontFamily: "SpaceGrotesk_500Medium",
                fontSize: 11,
                marginTop: 4,
              }}
              numberOfLines={1}
            >
              {`${shortBy.toLocaleString()} pts to go`}
            </Text>
          </View>
        )}
      </View>

      {canClaim ? (
        <Pressable
          onPress={onApply}
          disabled={isApplied}
          className="active:opacity-80"
          style={{
            backgroundColor: isApplied ? "#16A34A" : "#C05040",
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 999,
          }}
        >
          <Text
            style={{
              color: "#FFFFFF",
              fontFamily: "SpaceGrotesk_700Bold",
              fontSize: 11,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            {isApplied ? "Applied" : "Apply"}
          </Text>
        </Pressable>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
          <Text
            style={{
              color: "#1A0200",
              fontFamily: "Peachi-Bold",
              fontSize: 18,
              lineHeight: 22,
            }}
          >
            {required.toLocaleString()}
          </Text>
          <Text
            style={{
              color: "rgba(26, 2, 0, 0.55)",
              fontFamily: "SpaceGrotesk_700Bold",
              fontSize: 9,
              letterSpacing: 1.5,
            }}
          >
            PTS
          </Text>
        </View>
      )}
    </View>
  );
}

// Map reward shape to a brand icon — gift for auto-issued (welcome /
// birthday), tag for monetary discounts, cup for everything else
// (free drinks / BOGO / unknown). Mirrors the icon mapping on
// RewardTicket so the ticket on home and the row here read as the
// same item.
function pickRewardIcon(reward: Reward): typeof CelsiusCup {
  const type = (reward as { reward_type?: string }).reward_type;
  if (type === "new_member" || type === "birthday") return CelsiusGift;
  const dt = reward.discount_type;
  if (dt === "percent" || dt === "percentage" || dt === "flat" || dt === "fixed_amount") {
    return CelsiusTag;
  }
  return CelsiusCup;
}

function SignInPrompt() {
  return (
    <View className="px-6 pt-12 items-center">
      <View
        className="bg-primary/10 items-center justify-center mb-4"
        style={{ width: 72, height: 72, borderRadius: 36 }}
      >
        <Gift size={32} color="#C05040" strokeWidth={1.5} />
      </View>
      <Text
        className="text-espresso text-xl text-center"
        style={{ fontFamily: "Peachi-Bold" }}
      >
        Earn on every cup
      </Text>
      <Text
        className="text-muted-fg text-sm text-center mt-2 max-w-xs"
        style={{ fontFamily: "SpaceGrotesk_400Regular" }}
      >
        Add your phone to start collecting points and unlock free drinks, fries, and more.
      </Text>
      <Pressable
        onPress={() => router.push("/account")}
        className="mt-6 bg-espresso rounded-full active:opacity-80 flex-row items-center"
        style={{ paddingHorizontal: 20, paddingVertical: 12 }}
      >
        <Text
          className="text-white text-[15px] mr-2"
          style={{ fontFamily: "Peachi-Bold" }}
        >
          Sign in
        </Text>
        <ChevronRight size={16} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}
