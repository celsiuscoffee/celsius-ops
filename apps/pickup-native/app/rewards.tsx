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
              <Section
                title={`${ts.displayName.toLowerCase()} benefits`}
                eyebrow={`${ts.displayName} BENEFITS`}
                trailingRule={false}
              >
                {tier.tier_benefits.map((b, i) => (
                  <View key={i} style={{ paddingVertical: 10 }}>
                    <Text
                      style={{
                        color: "#1A0200",
                        fontFamily: "SpaceGrotesk_500Medium",
                        fontSize: 16,
                        letterSpacing: 0.1,
                      }}
                    >
                      {b}
                    </Text>
                  </View>
                ))}
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

// Brand-poster section header — small caps eyebrow stacked above a
// large Peachii display title. Optional right-aligned meta sits next
// to the eyebrow row in matching small caps. Pattern from the
// "BREWING HOURS / Monday—Thursday" outlet poster (CC Brand System).
function Section({
  title,
  rightLabel,
  eyebrow,
  children,
  trailingRule = true,
}: {
  title: string;
  rightLabel?: string;
  /** Tiny caps line above the Peachii title. Falls back to the title's
   *  small-caps form (e.g. "CLAIM NOW") if not provided. */
  eyebrow?: string;
  children: React.ReactNode;
  /** Render a thin rule below this section to divide it from the next.
   *  Match the poster: one hairline between sections, not around cards. */
  trailingRule?: boolean;
}) {
  const eb = eyebrow ?? title.toUpperCase();
  return (
    <View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginTop: 24,
          marginBottom: 10,
        }}
      >
        <Text
          style={{
            color: "#1A0200",
            fontFamily: "SpaceGrotesk_700Bold",
            fontSize: 10,
            letterSpacing: 2.5,
          }}
        >
          {eb}
        </Text>
        {rightLabel ? (
          <Text
            style={{
              color: "rgba(26, 2, 0, 0.55)",
              fontFamily: "SpaceGrotesk_500Medium",
              fontSize: 10,
              letterSpacing: 1.5,
              textTransform: "uppercase",
            }}
          >
            {rightLabel}
          </Text>
        ) : null}
      </View>
      {children}
      {trailingRule ? (
        <View
          style={{
            height: 1,
            backgroundColor: "rgba(26, 2, 0, 0.12)",
            marginTop: 18,
          }}
        />
      ) : null}
    </View>
  );
}

// Cardless layout — content sits directly on the cream body, divided
// only by thin rules. Matches the brand poster aesthetic where the
// page is a single vertical column with breathing room, not a stack
// of bordered rectangles.
function Card({ children }: { children: React.ReactNode }) {
  return <View>{children}</View>;
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
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        gap: 12,
        paddingVertical: 12,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: "#1A0200",
            fontFamily: "SpaceGrotesk_700Bold",
            fontSize: 17,
            letterSpacing: 0.1,
          }}
          numberOfLines={1}
        >
          {reward.name}
        </Text>
        <Text
          style={{
            color: "rgba(26, 2, 0, 0.55)",
            fontFamily: "SpaceGrotesk_400Regular",
            fontSize: 12,
            marginTop: 3,
          }}
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
          backgroundColor: isApplied ? "#16A34A" : "#1A0200",
          paddingHorizontal: 16,
          paddingVertical: 9,
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
  const canClaim = pointsShort === 0;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "space-between",
        paddingVertical: 12,
        opacity: canClaim ? 1 : 0.45,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: "#1A0200",
            fontFamily: "SpaceGrotesk_700Bold",
            fontSize: 17,
            letterSpacing: 0.1,
          }}
          numberOfLines={1}
        >
          {reward.name}
        </Text>
        {!canClaim ? (
          <Text
            style={{
              color: "rgba(26, 2, 0, 0.55)",
              fontFamily: "SpaceGrotesk_400Regular",
              fontSize: 12,
              marginTop: 3,
            }}
            numberOfLines={1}
          >
            {pointsShort.toLocaleString()} points to go
          </Text>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 5 }}>
        <Text
          style={{
            color: "#1A0200",
            // Numbers stay Peachii — the brand poster keeps numerals
            // ("12:30 PM") in Space Grotesk but in our points list
            // the number IS the value being weighed, so it gets the
            // hero treatment. Keeps a Peachii beat in every section.
            fontFamily: "Peachi-Bold",
            fontSize: 22,
            lineHeight: 26,
          }}
        >
          {reward.points_required.toLocaleString()}
        </Text>
        <Text
          style={{
            color: "rgba(26, 2, 0, 0.55)",
            fontFamily: "SpaceGrotesk_700Bold",
            fontSize: 10,
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
