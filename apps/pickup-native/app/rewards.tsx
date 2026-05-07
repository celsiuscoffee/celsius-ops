import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, Image, ActivityIndicator } from "react-native";
import { Stack, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Gift, ChevronRight } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomNav } from "../components/BottomNav";
import { TierHero } from "../components/TierHero";
import { tierStyle } from "../lib/tier-styles";
import * as Haptics from "expo-haptics";
import { useApp } from "../lib/store";
import { fetchRewards, fetchTier, formatRewardValue, type MemberTier, type Reward } from "../lib/rewards";

export default function RewardsTab() {
  const phone = useApp((s) => s.phone);
  const loyaltyId = useApp((s) => s.loyaltyId);
  const insets = useSafeAreaInsets();

  // Tier — fetched alongside rewards. Drives the hero theme + the
  // benefits card.
  const [tier, setTier] = useState<MemberTier | null>(null);
  useEffect(() => {
    if (!loyaltyId) {
      setTier(null);
      return;
    }
    fetchTier(loyaltyId).then(setTier).catch(() => setTier(null));
  }, [loyaltyId]);

  const { data, isLoading } = useQuery({
    queryKey: ["rewards", phone ?? "anonymous"],
    queryFn: () => fetchRewards(phone),
    staleTime: 30_000,
  });

  const balance = data?.pointsBalance ?? 0;
  const rewards = data?.rewards ?? [];
  const ts = tierStyle(tier);

  const { claimable, locked } = useMemo(() => {
    const sorted = [...rewards].sort((a, b) => a.points_required - b.points_required);
    return {
      claimable: sorted.filter((r) => balance >= r.points_required),
      locked: sorted.filter((r) => balance < r.points_required),
    };
  }, [rewards, balance]);

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />

      {/* Tier-themed hero — eyebrow + balance numerals + status sub. */}
      <TierHero
        style={ts}
        paddingTop={insets.top + 12}
        paddingBottom={36}
        variant="tall"
      >
        <Text
          className="text-[10px] uppercase"
          style={{
            color: ts.eyebrowColor,
            fontFamily: "SpaceGrotesk_700Bold",
            letterSpacing: 4,
          }}
        >
          {tier?.tier_slug ? ts.displayName : "REWARDS"}
        </Text>
        <View className="flex-row items-baseline mt-3.5" style={{ gap: 10 }}>
          <Text
            style={{
              color: ts.textColor,
              fontFamily: "Peachi-Bold",
              fontSize: 42,
              lineHeight: 44,
            }}
          >
            {isLoading && balance === 0 ? "—" : balance.toLocaleString()}
          </Text>
          <Text
            style={{
              color: ts.mutedColor,
              fontFamily: "SpaceGrotesk_700Bold",
              fontSize: 11,
              letterSpacing: 1.5,
            }}
          >
            POINTS
          </Text>
        </View>
        {tier ? (
          <Text
            className="mt-2 text-[11px]"
            style={{ color: ts.mutedColor, fontFamily: "SpaceGrotesk_400Regular" }}
          >
            {`Earning ${tier.tier_multiplier ?? 1}× on every order`}
          </Text>
        ) : null}
      </TierHero>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {!phone ? (
          <SignInPrompt />
        ) : (
          <>
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
                <ActivityIndicator color="#C05040" />
              </View>
            )}

            {/* CLAIM NOW — affordable rewards in a single card */}
            {claimable.length > 0 && (
              <Section title="Claim now" rightLabel={`${claimable.length} active`}>
                <Card>
                  {claimable.map((r, i) => (
                    <ClaimRow
                      key={r.id}
                      reward={r}
                      isFirst={i === 0}
                    />
                  ))}
                </Card>
              </Section>
            )}

            {/* REDEEM — points cost rewards (still claimable + locked
                merged into one list, locked ones faded with "X to go") */}
            {locked.length > 0 && (
              <Section title="Redeem" rightLabel={`${balance.toLocaleString()} available`}>
                <Card>
                  {locked.map((r, i) => (
                    <RedeemRow
                      key={r.id}
                      reward={r}
                      balance={balance}
                      isFirst={i === 0}
                    />
                  ))}
                </Card>
              </Section>
            )}

            {/* TIER BENEFITS — only when tier is loaded with benefits */}
            {tier && tier.tier_benefits && tier.tier_benefits.length > 0 && (
              <Section title={`Your ${ts.displayName.toLowerCase()} benefits`}>
                <Card>
                  {tier.tier_benefits.map((b, i, arr) => (
                    <View
                      key={i}
                      style={{
                        paddingVertical: 12,
                        borderTopWidth: i === 0 ? 0 : 1,
                        borderTopColor: "#EFE9DD",
                      }}
                    >
                      <Text
                        className="text-[13px]"
                        style={{ color: "#160800", fontFamily: "Peachi-Bold" }}
                      >
                        {b}
                      </Text>
                    </View>
                  ))}
                </Card>
              </Section>
            )}
          </>
        )}
      </ScrollView>

      <BottomNav />
    </View>
  );
}

// ─── building blocks ───

function Section({
  title,
  rightLabel,
  children,
}: {
  title: string;
  rightLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginBottom: 20 }}>
      <View
        className="flex-row items-baseline justify-between"
        style={{ paddingHorizontal: 4, marginBottom: 10 }}
      >
        <Text
          className="text-[10px] uppercase"
          style={{
            color: "#160800",
            fontFamily: "SpaceGrotesk_700Bold",
            letterSpacing: 2.5,
          }}
        >
          {title}
        </Text>
        {rightLabel ? (
          <Text
            className="text-[11px]"
            style={{ color: "#8E8E93", fontFamily: "SpaceGrotesk_500Medium" }}
          >
            {rightLabel}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: "#FFFFFF",
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "#E8E2D6",
        paddingHorizontal: 16,
      }}
    >
      {children}
    </View>
  );
}

function ClaimRow({ reward, isFirst }: { reward: Reward; isFirst: boolean }) {
  const appliedReward = useApp((s) => s.appliedReward);
  const setAppliedReward = useApp((s) => s.setAppliedReward);
  const cart = useApp((s) => s.cart);
  const isApplied = appliedReward?.id === reward.id;

  const onApply = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setAppliedReward({
      id: reward.id,
      name: reward.name,
      points_required: reward.points_required,
      discount_type: reward.discount_type,
      discount_value: reward.discount_value,
      bogo_buy_qty: reward.bogo_buy_qty,
      bogo_free_qty: reward.bogo_free_qty,
      free_product_name: reward.free_product_name,
    });
    if (cart.length > 0) router.push("/cart");
  };

  return (
    <View
      className="flex-row items-center"
      style={{
        paddingVertical: 14,
        gap: 12,
        borderTopWidth: isFirst ? 0 : 1,
        borderTopColor: "#EFE9DD",
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          className="text-[14px]"
          style={{ color: "#160800", fontFamily: "Peachi-Bold" }}
          numberOfLines={1}
        >
          {reward.name}
        </Text>
        <Text
          className="text-[11px] mt-0.5"
          style={{ color: "#8E8E93", fontFamily: "SpaceGrotesk_500Medium" }}
          numberOfLines={1}
        >
          {formatRewardValue(reward)}
        </Text>
      </View>
      <Pressable
        onPress={onApply}
        disabled={isApplied}
        className="active:opacity-80"
        style={{
          backgroundColor: isApplied ? "#16A34A" : "#160800",
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: 999,
        }}
      >
        <Text
          className="text-[11px]"
          style={{
            color: "#FFFFFF",
            fontFamily: "Peachi-Bold",
            letterSpacing: 0.5,
          }}
        >
          {isApplied ? "Applied" : "Apply"}
        </Text>
      </Pressable>
    </View>
  );
}

function RedeemRow({
  reward,
  balance,
  isFirst,
}: {
  reward: Reward;
  balance: number;
  isFirst: boolean;
}) {
  const pointsShort = Math.max(0, reward.points_required - balance);
  return (
    <View
      className="flex-row items-end justify-between"
      style={{
        paddingVertical: 14,
        borderTopWidth: isFirst ? 0 : 1,
        borderTopColor: "#EFE9DD",
        opacity: 0.55,
      }}
    >
      <View>
        <Text
          className="text-[14px]"
          style={{ color: "#160800", fontFamily: "Peachi-Bold" }}
          numberOfLines={1}
        >
          {reward.name}
        </Text>
        <Text
          className="text-[10px] mt-1"
          style={{ color: "#8E8E93", fontFamily: "SpaceGrotesk_500Medium" }}
          numberOfLines={1}
        >
          {pointsShort.toLocaleString()} points to go
        </Text>
      </View>
      <View className="flex-row items-baseline" style={{ gap: 4 }}>
        <Text
          className="text-[14px]"
          style={{ color: "#160800", fontFamily: "Peachi-Bold" }}
        >
          {reward.points_required.toLocaleString()}
        </Text>
        <Text
          className="text-[9px]"
          style={{
            color: "#8E8E93",
            fontFamily: "SpaceGrotesk_700Bold",
            letterSpacing: 1.5,
          }}
        >
          PTS
        </Text>
      </View>
    </View>
  );
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
