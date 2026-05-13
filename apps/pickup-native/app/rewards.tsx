import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, Alert } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Gift, ChevronRight, Flame, Users, Clock } from "lucide-react-native";
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
import {
  fetchMyVouchers,
  fetchClaimableVouchers,
  fetchActiveMission,
  fetchMyStreak,
  redeemPointsReward,
} from "../lib/rewards-v2";
import { VoucherWallet } from "../components/VoucherWallet";
import { MissionCard } from "../components/MissionCard";
import { ClaimableSection } from "../components/ClaimableSection";
import { RewardsOnboarding } from "../components/RewardsOnboarding";

// Locked rewards within this much of the customer's balance get a
// visible progress bar + "X to go" sub-line. Anything further out
// stays minimal so the list doesn't read as an unreachable ladder.
const PROGRESS_VISIBLE_THRESHOLD = 0.3;

type RewardsTabKey = "challenges" | "vouchers" | "catalog";

const ONBOARDING_KEY = "rewards-v2-intro";

function paramToTab(raw: string | string[] | undefined): RewardsTabKey {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "vouchers" || v === "catalog" || v === "challenges") return v;
  // Friendly aliases the cart "Apply a reward" CTA + account links
  // might use. Map them onto the canonical key so the URL surface
  // stays forgiving.
  if (v === "rewards" || v === "wallet") return "vouchers";
  if (v === "claim") return "catalog";
  return "challenges";
}

export default function RewardsTab() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const phone = useApp((s) => s.phone);
  const loyaltyId = useApp((s) => s.loyaltyId);
  const member = useApp((s) => s.member);
  const seenOnboardings = useApp((s) => s.seenOnboardings);
  const markOnboardingSeen = useApp((s) => s.markOnboardingSeen);

  const [activeTab, setActiveTab] = useState<RewardsTabKey>(() => paramToTab(params.tab));
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Respect later route changes too — useful when the screen is already
  // mounted and someone pushes /rewards?tab=vouchers from a different
  // surface; without this the route param updates but the tab doesn't.
  useEffect(() => {
    const next = paramToTab(params.tab);
    setActiveTab((prev) => (prev === next ? prev : next));
  }, [params.tab]);

  // Reveal the v2 onboarding sheet on first visit per install — gated
  // on a signed-in phone so anonymous users don't see it before they
  // can act on it.
  useEffect(() => {
    if (!phone) return;
    if (seenOnboardings.includes(ONBOARDING_KEY)) return;
    // Small delay so it doesn't fight the screen entrance.
    const t = setTimeout(() => setShowOnboarding(true), 350);
    return () => clearTimeout(t);
  }, [phone, seenOnboardings]);

  // Tier — drives the hero theme + benefits card.
  const tierQ = useQuery({
    queryKey: ["tier", loyaltyId],
    queryFn: () => (loyaltyId ? fetchTier(loyaltyId) : Promise.resolve(null)),
    enabled: !!loyaltyId,
    staleTime: 5 * 60_000,
  });
  const tier = tierQ.data ?? null;

  const { data, isLoading } = useQuery({
    queryKey: ["rewards", phone ?? "anonymous"],
    queryFn: () => fetchRewards(phone),
    staleTime: 5 * 60_000,
  });

  const balance = data?.pointsBalance ?? 0;
  const rewards = data?.rewards ?? [];
  const ts = tierStyle(tier);

  // Vouchers — wallet + claimable. Both gated on a signed-in customer.
  const myVouchersQ = useQuery({
    queryKey: ["my-vouchers", phone ?? "anon"],
    queryFn: fetchMyVouchers,
    enabled: !!phone,
    staleTime: 60_000,
  });
  const claimableQ = useQuery({
    queryKey: ["claimable-vouchers", phone ?? "anon"],
    queryFn: fetchClaimableVouchers,
    enabled: !!phone,
    staleTime: 60_000,
  });
  const activeMissionQ = useQuery({
    queryKey: ["active-mission", phone ?? "anon"],
    queryFn: fetchActiveMission,
    enabled: !!phone,
    staleTime: 60_000,
  });
  const streakQ = useQuery({
    queryKey: ["my-streak", phone ?? "anon"],
    queryFn: fetchMyStreak,
    enabled: !!phone,
    staleTime: 5 * 60_000,
  });

  const vouchers = myVouchersQ.data ?? [];
  const claimables = claimableQ.data ?? [];
  const activeMission = activeMissionQ.data ?? null;
  const streakWeeks = streakQ.data?.current_streak_weeks ?? 0;

  // Claim tab only — birthday + new-member rewards are auto-issued (cron
  // for birthday, signup trigger for welcome BOGO). They shouldn't show
  // up here as if they were redeemable for Beans. The server endpoint
  // already filters by auto_issue, this is belt-and-braces against a
  // mis-configured row landing the wrong reward in front of customers.
  const sortedRewards = useMemo(
    () =>
      [...rewards]
        .filter((r) => {
          const t = (r as { reward_type?: string | null }).reward_type;
          return t !== "birthday" && t !== "new_member";
        })
        .sort((a, b) => a.points_required - b.points_required),
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

  // Rewards-tab badge counts just the wallet (active issued_rewards).
  // Claimables moved to the Claim tab and get their own badge.
  const voucherCount = vouchers.filter((v) => v.status === "active").length;
  const claimCount = claimables.length;

  function selectTab(t: RewardsTabKey) {
    Haptics.selectionAsync();
    setActiveTab(t);
  }

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />

      <EspressoHeader title="Rewards" showCart={false} />

      {!phone ? (
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
          <SignInPrompt />
        </ScrollView>
      ) : (
        <>
          {/* Compact hero — Beans + tier + streak in one strip */}
          <View className="px-4 pt-3 pb-2">
            <CompactHero
              balance={balance}
              tier={tier}
              tierStyleAccent={ts.accentColor}
              tierDisplayName={ts.displayName}
              streakWeeks={streakWeeks}
              nextReward={nextReward}
              nextProgress={nextProgress}
              nextShortBy={nextShortBy}
              accent={ts.accentColor}
            />
          </View>

          {/* Tab strip */}
          <View
            className="flex-row bg-surface border-b border-border"
            style={{ paddingHorizontal: 16, gap: 24 }}
          >
            <TabButton label="Challenges"  active={activeTab === "challenges"} onPress={() => selectTab("challenges")} />
            <TabButton label="Rewards"     active={activeTab === "vouchers"}   onPress={() => selectTab("vouchers")}   badge={voucherCount} />
            <TabButton label="Claim"       active={activeTab === "catalog"}    onPress={() => selectTab("catalog")}    badge={claimCount} />
          </View>

          <ScrollView
            className="flex-1"
            contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
            showsVerticalScrollIndicator={false}
          >
            {activeTab === "challenges" && (
              <ChallengesTab activeMission={activeMission} streakWeeks={streakWeeks} />
            )}
            {activeTab === "vouchers" && (
              <VouchersTab
                vouchers={vouchers}
                loading={myVouchersQ.isLoading}
              />
            )}
            {activeTab === "catalog" && (
              <CatalogTab
                balance={balance}
                rewards={rewards}
                sortedRewards={sortedRewards}
                claimables={claimables}
                isLoading={isLoading}
              />
            )}
          </ScrollView>
        </>
      )}

      <BottomNav />

      <RewardsOnboarding
        visible={showOnboarding}
        onDismiss={() => {
          setShowOnboarding(false);
          markOnboardingSeen(ONBOARDING_KEY);
        }}
      />
    </View>
  );
}

// ─── Compact hero (Beans + tier + streak + progress) ────────────────

function CompactHero({
  balance, tier, tierStyleAccent, tierDisplayName, streakWeeks,
  nextReward, nextProgress, nextShortBy, accent,
}: {
  balance: number;
  tier: Awaited<ReturnType<typeof fetchTier>>;
  tierStyleAccent: string;
  tierDisplayName: string;
  streakWeeks: number;
  nextReward: Reward | null;
  nextProgress: number;
  nextShortBy: number;
  accent: string;
}) {
  // Tier badge styling — same pill footprint as before, but the inner
  // composition now mirrors the full TierHeroCard: the tier's own colour
  // becomes the solid pill background, a darker shade rims the edge for
  // depth, a separate "Nx" chip on the trailing side calls out the
  // multiplier instead of running it inline with the wordmark. Keeps the
  // compact size so the hero stays tight.
  const tierColor = tier?.tier_color ?? "#1A0200";
  const tierIcon  = tier?.tier_icon  ?? "★";
  const tierMul   = tier?.tier_multiplier ?? 1;
  // Decide text contrast based on the tier colour's luminance. Light tiers
  // (Bronze cream, Silver light grey, Gold) want dark espresso text; dark
  // tiers (Platinum charcoal, Elite black) want a bright cream.
  const tierIsLight = isLightColor(tierColor);
  const tierFg = tierIsLight ? "#1A0200" : "#FFF5E1";
  const tierMulBg = tierIsLight ? "rgba(26,2,0,0.10)" : "rgba(255,245,225,0.18)";
  const tierMulFg = tierIsLight ? "#1A0200" : "#FFF5E1";

  // Tier progress copy — depends on the brand's qualification metric.
  let tierCaption: string | null = null;
  const nextTierName     = tier?.next_tier_name ?? null;
  const visitsToNextTier = tier?.visits_to_next_tier ?? 0;
  const spendToNextTier  = tier?.spend_to_next_tier ?? 0;
  const tierQualification = tier?.tier_qualification ?? null;
  if (nextTierName) {
    if (tierQualification === "spend" || tierQualification === "spend_lifetime") {
      const rm = Math.ceil(spendToNextTier);
      if (rm > 0) tierCaption = `RM${rm} to ${nextTierName}`;
    } else {
      const v = visitsToNextTier;
      if (v > 0) tierCaption = `${v} visit${v === 1 ? "" : "s"} to ${nextTierName}`;
    }
  }
  return (
    <View
      className="bg-surface rounded-2xl border border-border"
      style={{
        padding: 14,
        shadowColor: "#000",
        shadowOpacity: 0.04,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 1,
      }}
    >
      <View className="flex-row items-center justify-between" style={{ gap: 12 }}>
        {/* Left — Beans count */}
        <View className="flex-row items-baseline" style={{ gap: 6 }}>
          <Text
            style={{
              fontFamily: "Peachi-Bold",
              fontSize: 32,
              color: "#1A0200",
              letterSpacing: -1,
              lineHeight: 32,
            }}
          >
            {balance.toLocaleString()}
          </Text>
          <Text
            style={{
              fontFamily: "SpaceGrotesk_700Bold",
              fontSize: 11,
              color: "#6B6B6B",
              letterSpacing: 1.5,
              textTransform: "uppercase",
            }}
          >
            Beans
          </Text>
        </View>

        {/* Right — tier badge + streak. Pill mirrors the tier card's
            visual language: solid tier-colour fill, brand mascot emoji,
            wordmark + a separate multiplier chip riding inside. */}
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              router.push("/tier-benefits" as never);
            }}
            className="flex-row items-center active:opacity-80"
            style={{
              paddingLeft: 9,
              paddingRight: tierMul > 1 ? 4 : 12,
              paddingVertical: 4.5,
              borderRadius: 100,
              backgroundColor: tierColor,
              borderWidth: 1,
              borderColor: hexWithAlpha(tierColor, 0.55),
              gap: 6,
              shadowColor: tierColor,
              shadowOpacity: 0.18,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 2 },
              elevation: 2,
            }}
          >
            <Text style={{ fontSize: 13 }}>{tierIcon}</Text>
            <Text
              style={{
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 11,
                color: tierFg,
                letterSpacing: 1.4,
                textTransform: "uppercase",
              }}
            >
              {tierDisplayName}
            </Text>
            {tierMul > 1 && (
              <View
                style={{
                  backgroundColor: tierMulBg,
                  paddingHorizontal: 7,
                  paddingVertical: 2,
                  borderRadius: 100,
                }}
              >
                <Text
                  style={{
                    fontFamily: "SpaceGrotesk_700Bold",
                    fontSize: 10,
                    color: tierMulFg,
                    letterSpacing: 0.4,
                  }}
                >
                  {formatMul(tierMul)}×
                </Text>
              </View>
            )}
          </Pressable>
          {/* Streak chip — visible once the customer has any active streak. */}
          {streakWeeks > 0 && (
            <View
              className="flex-row items-center"
              style={{ gap: 4 }}
            >
              <Flame size={12} color="#C05040" strokeWidth={2} />
              <Text
                style={{
                  fontFamily: "SpaceGrotesk_700Bold",
                  fontSize: 11,
                  color: "#C05040",
                }}
              >
                {streakWeeks} {streakWeeks === 1 ? "wk" : "wks"}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Slim progress strip */}
      {nextReward && (
        <>
          <View
            style={{
              marginTop: 12,
              height: 4,
              borderRadius: 2,
              backgroundColor: "rgba(26,2,0,0.06)",
              overflow: "hidden",
            }}
          >
            <View
              style={{
                height: "100%",
                width: `${nextProgress * 100}%`,
                backgroundColor: accent,
                borderRadius: 2,
              }}
            />
          </View>
          <View
            style={{
              marginTop: 8,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text
              style={{
                fontFamily: "SpaceGrotesk_500Medium",
                fontSize: 11,
                color: "#6B6B6B",
                flexShrink: 1,
              }}
              numberOfLines={1}
            >
              <Text style={{ color: "#1A0200", fontFamily: "SpaceGrotesk_700Bold" }}>
                {nextShortBy.toLocaleString()} Beans
              </Text>{" "}
              to {nextReward.name}
            </Text>
            {tierCaption && (
              <Text
                style={{
                  fontFamily: "SpaceGrotesk_500Medium",
                  fontSize: 11,
                  color: "#6B6B6B",
                  marginLeft: 10,
                }}
                numberOfLines={1}
              >
                · <Text style={{ color: "#C05040", fontFamily: "SpaceGrotesk_700Bold" }}>{tierCaption}</Text>
              </Text>
            )}
          </View>
        </>
      )}
      {/* When there's no next reward (max balance reached), still surface
          tier progress if relevant — never let the hero go silent. */}
      {!nextReward && tierCaption && (
        <Text
          style={{
            marginTop: 8,
            fontFamily: "SpaceGrotesk_700Bold",
            fontSize: 11,
            color: "#C05040",
          }}
        >
          {tierCaption}
        </Text>
      )}
    </View>
  );
}

// ─── Tab button ─────────────────────────────────────────────────────

function TabButton({
  label, active, onPress, badge,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  badge?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="active:opacity-70"
      style={{ paddingVertical: 12, position: "relative" }}
    >
      <View className="flex-row items-center" style={{ gap: 5 }}>
        <Text
          style={{
            fontFamily: active ? "SpaceGrotesk_700Bold" : "SpaceGrotesk_600SemiBold",
            fontSize: 15,
            color: active ? "#1A0200" : "#6B6B6B",
          }}
        >
          {label}
        </Text>
        {badge !== undefined && badge > 0 && (
          <View
            style={{
              minWidth: 18,
              height: 16,
              paddingHorizontal: 6,
              borderRadius: 9,
              backgroundColor: "#C05040",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 10,
                color: "#FFFFFF",
                fontWeight: "800",
              }}
            >
              {badge}
            </Text>
          </View>
        )}
      </View>
      {active && (
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: -1,
            height: 2,
            backgroundColor: "#C05040",
            borderRadius: 1,
          }}
        />
      )}
    </Pressable>
  );
}

// ─── Tab: Challenges ────────────────────────────────────────────────

function ChallengesTab({
  activeMission,
  streakWeeks,
}: {
  activeMission: Awaited<ReturnType<typeof fetchActiveMission>>;
  streakWeeks: number;
}) {
  return (
    <>
      <MissionCard mission={activeMission} />

      {/* Weekly streak — info card (no claim button yet; streaks update
          via the streak-update cron after each ordering week, no
          customer action needed). Tap is a no-op so customers don't
          chase a dead route. */}
      <View
        className="mt-6 bg-surface rounded-2xl border border-border p-4 flex-row items-center"
        style={{
          gap: 12,
          shadowColor: "#000",
          shadowOpacity: 0.04,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
          elevation: 1,
        }}
      >
        <View
          style={{
            width: 46,
            height: 46,
            borderRadius: 12,
            backgroundColor: "#FBEBE8",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Flame size={22} color="#C05040" strokeWidth={1.8} />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={{ fontFamily: "Peachi-Bold", fontSize: 16, color: "#1A0200" }}
          >
            {streakWeeks > 0
              ? `${streakWeeks}-week streak`
              : "Build your streak"}
          </Text>
          <Text
            style={{
              fontFamily: "SpaceGrotesk_500Medium",
              fontSize: 12,
              color: "#6B6B6B",
              marginTop: 2,
            }}
          >
            {streakWeeks > 0
              ? "One order a week keeps your streak alive"
              : "One order a week earns a streak — first one starts after your next order"}
          </Text>
        </View>
      </View>

      {/* Referral */}
      <View className="mt-6">
        <View className="flex-row items-center justify-between mb-2.5 px-1">
          <Text
            className="text-espresso text-[12px] uppercase"
            style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 1.8 }}
          >
            Share &amp; Earn
          </Text>
        </View>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            router.push("/referral" as never);
          }}
          className="rounded-2xl p-3.5 flex-row items-center active:opacity-80"
          style={{
            gap: 12,
            backgroundColor: "#FBEBE8",
            borderWidth: 1,
            borderColor: "rgba(192,80,64,0.18)",
          }}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              backgroundColor: "#C05040",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Users size={22} color="#FFFFFF" strokeWidth={1.8} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: "Peachi-Bold", fontSize: 15, color: "#1A0200" }}>
              Invite a friend
            </Text>
            <Text
              style={{
                fontFamily: "SpaceGrotesk_500Medium",
                fontSize: 11,
                color: "#5A1F16",
                marginTop: 1,
              }}
            >
              Both get a free drink when they order
            </Text>
          </View>
          <ChevronRight size={16} color="#5A1F16" strokeWidth={2} />
        </Pressable>
      </View>
    </>
  );
}

// ─── Tab: Rewards (formerly "Vouchers") ─────────────────────────────
// This is the customer's wallet — issued_rewards rows ready to redeem
// at checkout. Claimables live on the Claim tab now (because tapping
// one moves it INTO this wallet).

function VouchersTab({
  vouchers, loading,
}: {
  vouchers: Awaited<ReturnType<typeof fetchMyVouchers>>;
  loading: boolean;
}) {
  const hasActive = vouchers.some((v) => v.status === "active");

  if (loading && !hasActive) {
    return (
      <View className="py-12 items-center">
        <CelsiusLoader size="md" />
      </View>
    );
  }

  if (!hasActive) {
    return (
      <View className="py-12 items-center">
        <Gift size={36} color="#C05040" strokeWidth={1.25} />
        <Text className="text-[15px] mt-3" style={{ color: "#1A0200", fontFamily: "Peachi-Bold" }}>
          No rewards yet
        </Text>
        <Text
          className="text-[12px] text-center mt-1.5 max-w-xs"
          style={{ color: "#6B6B6B", fontFamily: "SpaceGrotesk_500Medium" }}
        >
          Claim from the Claim tab, complete a challenge, or watch for surprises after each order.
        </Text>
      </View>
    );
  }

  return <VoucherWallet vouchers={vouchers} maxVisible={20} hideViewAll />;
}

// ─── Tab: Claim (formerly "Catalog") ────────────────────────────────
// Everything the customer can ADD to their wallet:
//   • Admin claimables (one-tap pushed offers)
//   • Points-shop rewards (spend Beans)
// Tapping any of these moves the item into the Rewards tab as an
// active issued_rewards row.

function CatalogTab({
  balance, rewards, sortedRewards, claimables, isLoading,
}: {
  balance: number;
  rewards: Reward[];
  sortedRewards: Reward[];
  claimables: Awaited<ReturnType<typeof fetchClaimableVouchers>>;
  isLoading: boolean;
}) {
  return (
    <>
      {/* Admin claimables — one-tap pushed offers (welcome drinks, comeback
          promos, segmented give-aways). Tapping Claim issues the voucher
          into the Rewards wallet. Lives at the top so it's the first thing
          customers see when they open this tab. */}
      <ClaimableSection claimables={claimables} />

      {!isLoading && rewards.length === 0 && (
        <View className="py-12 items-center">
          <Gift size={36} color="#C05040" strokeWidth={1.25} />
          <Text className="text-[15px] mt-3" style={{ color: "#160800", fontFamily: "Peachi-Bold" }}>
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

      {sortedRewards.length > 0 && (
        <View style={{ marginTop: 4 }}>
          <Text
            style={{
              color: "rgba(26,2,0,0.55)",
              fontFamily: "SpaceGrotesk_700Bold",
              fontSize: 10,
              letterSpacing: 2.5,
              textTransform: "uppercase",
              marginTop: 16,
              marginBottom: 10,
              paddingHorizontal: 4,
            }}
          >
            Spend your Beans
          </Text>
          <View style={{ gap: 8 }}>
            {sortedRewards.map((reward) => (
              <RewardCard key={reward.id} reward={reward} balance={balance} />
            ))}
          </View>
        </View>
      )}

    </>
  );
}

// ─── Reward card (Claim tab) ────────────────────────────────────────
// Full-width compact list row for one points-shop reward. Same brand
// language as TierCardCarousel (terracotta-50 fill, rounded 16, ghost
// icon corner) but stacked vertically so customers can scan all
// available rewards at a glance.

function RewardCard({
  reward,
  balance,
}: {
  reward: Reward;
  balance: number;
}) {
  const qc = useQueryClient();

  const required = reward.points_required;
  const canClaim = balance >= required;
  const progress = required > 0 ? Math.max(0, Math.min(1, balance / required)) : 1;
  const shortBy = Math.max(0, required - balance);
  const urgency = canClaim ? rewardUrgencyLabel(reward) : null;

  // Claim flow — spend Beans now, the new voucher lands in the Rewards
  // tab wallet. Mutation invalidates wallet + balance queries so both
  // surfaces update without waiting for a refocus.
  const claimMutation = useMutation({
    mutationFn: () => redeemPointsReward(reward.id),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["my-vouchers"] });
      qc.invalidateQueries({ queryKey: ["rewards"] });
      qc.invalidateQueries({ queryKey: ["member"] });
      qc.invalidateQueries({ queryKey: ["tier"] });
      trackEvent("reward_claimed_to_wallet", {
        rewardId:        reward.id,
        rewardName:      reward.name,
        pointsRequired:  reward.points_required,
      });
      Alert.alert(
        "Claimed!",
        `"${reward.name}" is now in your Rewards. Use it at checkout any time before it expires.`,
        [{ text: "OK", style: "default" }],
      );
    },
    onError: (e: unknown) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const message = e instanceof Error ? e.message : "Could not claim — try again in a moment.";
      Alert.alert("Couldn’t claim", message);
    },
  });

  const onClaim = () => {
    if (!canClaim || claimMutation.isPending) return;
    Haptics.selectionAsync();
    Alert.alert(
      "Claim this reward?",
      `Spend ${required.toLocaleString()} Beans for "${reward.name}". It will move to your Rewards tab and you can use it at checkout.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Claim", style: "default", onPress: () => claimMutation.mutate() },
      ],
    );
  };

  const Icon = pickRewardIcon(reward);
  const categoryLabel = categoryToLabel(reward);

  return (
    <View
      style={{
        borderRadius: 16,
        overflow: "hidden",
        backgroundColor: canClaim ? "#FBEBE8" : "#F4EDEA",
        borderWidth: 1,
        borderColor: canClaim ? "rgba(192,80,64,0.18)" : "rgba(26,2,0,0.08)",
        shadowColor: "#000",
        shadowOpacity: canClaim ? 0.06 : 0.03,
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
        {/* Foreground icon — compact, matches the wallet voucher row size. */}
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: canClaim ? "rgba(192,80,64,0.18)" : "rgba(26,2,0,0.06)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon size={20} color={canClaim ? "#C05040" : "rgba(26,2,0,0.45)"} />
        </View>

        {/* Title + meta */}
        <View style={{ flex: 1 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              flexWrap: "wrap",
            }}
          >
            <Text
              style={{
                fontFamily: "Peachi-Bold",
                fontSize: 14,
                color: "#1A0200",
              }}
              numberOfLines={1}
            >
              {reward.name}
            </Text>
            {urgency && (
              <View
                style={{
                  backgroundColor: "#C05040",
                  paddingHorizontal: 5,
                  paddingVertical: 1,
                  borderRadius: 3,
                }}
              >
                <Text
                  style={{
                    color: "#FFFFFF",
                    fontFamily: "SpaceGrotesk_700Bold",
                    fontSize: 8.5,
                    letterSpacing: 0.8,
                    textTransform: "uppercase",
                  }}
                >
                  {urgency}
                </Text>
              </View>
            )}
          </View>

          <Text
            style={{
              marginTop: 1,
              color: "rgba(26,2,0,0.60)",
              fontFamily: "SpaceGrotesk_500Medium",
              fontSize: 11,
            }}
            numberOfLines={1}
          >
            <Text style={{ color: canClaim ? "#C05040" : "rgba(26,2,0,0.55)", fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 1 }}>
              {categoryLabel.toUpperCase()}
            </Text>
            {"  ·  "}
            {formatRewardValue(reward)}
          </Text>

          {/* Locked: progress strip — kept minimal */}
          {!canClaim && (
            <View style={{ marginTop: 5 }}>
              <View
                style={{
                  height: 2,
                  borderRadius: 1,
                  backgroundColor: "rgba(26,2,0,0.08)",
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    height: "100%",
                    width: `${Math.max(progress * 100, 4)}%`,
                    backgroundColor: "#C05040",
                    borderRadius: 1,
                  }}
                />
              </View>
              <Text
                style={{
                  marginTop: 3,
                  color: "rgba(26,2,0,0.55)",
                  fontFamily: "SpaceGrotesk_500Medium",
                  fontSize: 10,
                }}
              >
                {`${shortBy.toLocaleString()} Beans to go`}
              </Text>
            </View>
          )}
        </View>

        {/* Right side — claim button when affordable, Bean cost otherwise. */}
        {canClaim ? (
          <Pressable
            onPress={onClaim}
            disabled={claimMutation.isPending}
            className="active:opacity-80"
            style={{
              backgroundColor: "#C05040",
              paddingHorizontal: 12,
              paddingVertical: 7,
              borderRadius: 999,
              opacity: claimMutation.isPending ? 0.6 : 1,
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
              {claimMutation.isPending ? "Claiming…" : `Claim · ${required.toLocaleString()}`}
            </Text>
          </Pressable>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 2 }}>
            <Text
              style={{
                color: "rgba(26,2,0,0.55)",
                fontFamily: "Peachi-Bold",
                fontSize: 14,
              }}
            >
              {required.toLocaleString()}
            </Text>
            <Text
              style={{
                color: "rgba(26,2,0,0.45)",
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 8.5,
                letterSpacing: 1,
              }}
            >
              BEANS
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

/** Friendlier label for the reward's category — falls back to the
 *  discount-type when no explicit category is set. */
function categoryToLabel(reward: Reward): string {
  const cat = (reward as { category?: string }).category;
  if (cat === "free_item" || cat === "free_drink") return "Free Item";
  if (cat === "upgrade") return "Add-on";
  if (cat === "discount") return "Discount";
  if (cat === "multiplier") return "Boost";
  if (cat === "special") return "Special";
  const dt = reward.discount_type;
  if (dt === "percent" || dt === "percentage") return "Discount";
  if (dt === "flat" || dt === "fixed_amount") return "Discount";
  if (dt === "free_item") return "Free Item";
  return "Reward";
}

// Map reward shape to a brand icon — gift for auto-issued (welcome /
// ─── Tier helpers ───────────────────────────────────────────────────

/** Apply alpha to a hex color. Accepts #RGB / #RRGGBB / rgba(...).
 *  Defensive — bad input returns the original. */
function hexWithAlpha(color: string, alpha: number): string {
  const c = color.trim();
  if (c.startsWith("rgb")) return c; // already rgba — leave it
  // Normalise #RGB → #RRGGBB
  let hex = c.startsWith("#") ? c.slice(1) : c;
  if (hex.length === 3) hex = hex.split("").map((ch) => ch + ch).join("");
  if (hex.length !== 6) return color;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Format a tier multiplier — drop trailing zeros so "1.5" stays compact
 *  and "2.00" reads as just "2". */
function formatMul(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** True when the colour's relative luminance reads as a "light" surface —
 *  used to pick between espresso text and cream text on the tier pill.
 *  Defensive: bad input returns false (treat as dark, use cream text). */
function isLightColor(color: string): boolean {
  const c = color.trim();
  let hex = c.startsWith("#") ? c.slice(1) : c;
  if (hex.length === 3) hex = hex.split("").map((ch) => ch + ch).join("");
  if (hex.length !== 6) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return false;
  // sRGB luminance approximation — close enough for binary contrast picks.
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62;
}

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
