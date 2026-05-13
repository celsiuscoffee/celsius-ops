import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, Alert, ActivityIndicator, Modal } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Gift, ChevronRight, Flame, Users, Clock, Sparkles, Trophy } from "lucide-react-native";
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
  type MemberTier,
} from "../lib/rewards";
import {
  fetchMyVouchers,
  fetchClaimableVouchers,
  fetchActiveMission,
  fetchMyStreak,
  fetchStreakChests,
  claimStreakChest,
  fetchMyMilestones,
  claimMilestone,
  redeemPointsReward,
  type Milestone,
  type MilestoneClaimOutcome,
  type StreakState,
  type StreakChest,
  type StreakChestTier,
  type StreakChestsResponse,
  type StreakChestClaimOutcome,
} from "../lib/rewards-v2";
import { VoucherWallet, VOUCHER_THEME } from "../components/VoucherWallet";
import type { Voucher } from "../lib/rewards-v2";
import { MissionCard } from "../components/MissionCard";
import { ClaimableSection } from "../components/ClaimableSection";

// Locked rewards within this much of the customer's balance get a
// visible progress bar + "X to go" sub-line. Anything further out
// stays minimal so the list doesn't read as an unreachable ladder.
const PROGRESS_VISIBLE_THRESHOLD = 0.3;

type RewardsTabKey = "challenges" | "rewards" | "milestones";

function paramToTab(raw: string | string[] | undefined): RewardsTabKey {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "challenges") return "challenges";
  if (v === "milestones") return "milestones";
  // Friendly aliases — the cart "Apply a reward" CTA, home rail, and
  // pre-merge deeplinks (?tab=vouchers / ?tab=catalog / ?tab=claim /
  // ?tab=wallet) all map onto the single Rewards tab now.
  return "rewards";
}

export default function RewardsTab() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const phone = useApp((s) => s.phone);
  const loyaltyId = useApp((s) => s.loyaltyId);
  const member = useApp((s) => s.member);

  const [activeTab, setActiveTab] = useState<RewardsTabKey>(() => paramToTab(params.tab));

  // Respect later route changes too — useful when the screen is already
  // mounted and someone pushes /rewards?tab=vouchers from a different
  // surface; without this the route param updates but the tab doesn't.
  useEffect(() => {
    const next = paramToTab(params.tab);
    setActiveTab((prev) => (prev === next ? prev : next));
  }, [params.tab]);

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
  const milestonesQ = useQuery({
    queryKey: ["my-milestones", phone ?? "anon"],
    queryFn: fetchMyMilestones,
    enabled: !!phone,
    staleTime: 5 * 60_000,
  });
  const chestsQ = useQuery({
    queryKey: ["streak-chests", phone ?? "anon"],
    queryFn: fetchStreakChests,
    enabled: !!phone,
    staleTime: 60_000,
  });

  const vouchers = myVouchersQ.data ?? [];
  const claimables = claimableQ.data ?? [];
  const activeMission = activeMissionQ.data ?? null;
  const streak = streakQ.data ?? null;
  const streakWeeks = streak?.current_streak_weeks ?? 0;
  const milestones = milestonesQ.data ?? [];
  const chestData = chestsQ.data ?? { claimable: [], recent: [], tier_ladder: [] };

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

  // Rewards-tab badge — wallet vouchers + claim-now offers count
  // together (each is something the customer can act on right now).
  const activeVoucherCount = vouchers.filter((v) => v.status === "active").length;
  const rewardsBadge = activeVoucherCount + claimables.length;

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

          {/* Tab strip — three tabs:
                Challenges  → weekly mission loop
                Rewards     → wallet + ways to add to it
                Milestones  → tier ladder + lifetime achievements */}
          <View
            className="flex-row bg-surface border-b border-border"
            style={{ paddingHorizontal: 16, gap: 22 }}
          >
            <TabButton label="Challenges" active={activeTab === "challenges"} onPress={() => selectTab("challenges")} />
            <TabButton label="Rewards"    active={activeTab === "rewards"}    onPress={() => selectTab("rewards")}    badge={rewardsBadge} />
            <TabButton label="Milestones" active={activeTab === "milestones"} onPress={() => selectTab("milestones")} />
          </View>

          <ScrollView
            className="flex-1"
            contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
            showsVerticalScrollIndicator={false}
          >
            {activeTab === "challenges" && (
              <ChallengesTab
                activeMission={activeMission}
                streak={streak}
                chests={chestData}
              />
            )}
            {activeTab === "rewards" && (
              <RewardsTabBody
                vouchers={vouchers}
                claimables={claimables}
                rewards={rewards}
                sortedRewards={sortedRewards}
                balance={balance}
                loadingVouchers={myVouchersQ.isLoading}
                loadingRewards={isLoading}
              />
            )}
            {activeTab === "milestones" && (
              <MilestonesTab
                tier={tier}
                milestones={milestones}
                loading={milestonesQ.isLoading}
              />
            )}
          </ScrollView>
        </>
      )}

      <BottomNav />
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
  // v2 of the Rewards-tab hero. Old version was a flat white surface
  // with the tier as a tiny pill in the top-right and the Beans count
  // fighting for attention against multiple captions. The new card
  // treats this as a premium-membership artefact:
  //
  //   ┌────────────────────────────┐
  //   │  ★ GOLD MEMBER     1.5× BEANS │  ← tier-colour identity strip
  //   ├────────────────────────────┤
  //   │  2,314                    🔥 4w  │  ← Beans dominant, streak chip
  //   │  BEANS AVAILABLE                 │
  //   │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │  ← amber progress
  //   │  186 to Free Drink  ·  RM45 to Platinum │
  //   └────────────────────────────┘
  //
  // Espresso body anchors the brand. Tier colour shines at the top
  // and is the only place the customer's tier identity lives. Beans
  // count becomes the centrepiece. Multiplier moves into the band
  // so 1× members don't see an empty chip.
  const tierColor = tier?.tier_color ?? "#FBBF24"; // amber fallback — feels positive when there's no tier yet
  const tierIcon  = tier?.tier_icon  ?? "★";
  const tierMul   = tier?.tier_multiplier ?? 1;
  // Decide text contrast based on the tier colour's luminance. Light tiers
  // (Bronze cream, Silver light grey, Gold) want dark espresso text; dark
  // tiers (Platinum charcoal, Elite black) want a bright cream.
  const tierIsLight = isLightColor(tierColor);
  const tierFg = tierIsLight ? "#1A0200" : "#FFF5E1";
  const tierMulBg = tierIsLight ? "rgba(26,2,0,0.12)" : "rgba(255,245,225,0.20)";

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
  } else if (tier) {
    // Top-tier members deserve a quiet acknowledgement instead of an
    // empty progress caption.
    tierCaption = "Top tier";
  }

  return (
    <View
      className="rounded-2xl overflow-hidden"
      style={{
        backgroundColor: "#1A0200",
        shadowColor: "#160800",
        shadowOpacity: 0.18,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
      }}
    >
      {/* ── Top: tier identity band ───────────────────────────────────
          Tier colour fills a slim strip — same overall footprint as
          the previous compact card, so the hero doesn't grow on the
          page. Tapping anywhere on the band opens the tier-benefits
          sheet. */}
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          router.push("/tier-benefits" as never);
        }}
        className="active:opacity-85"
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 14,
          paddingVertical: 7,
          backgroundColor: tierColor,
          gap: 10,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 1 }}>
          <Text style={{ fontSize: 12 }}>{tierIcon}</Text>
          <Text
            style={{
              fontFamily: "Peachi-Bold",
              fontSize: 12,
              color: tierFg,
              letterSpacing: 0.3,
            }}
            numberOfLines={1}
          >
            {tierDisplayName}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <View
            style={{
              backgroundColor: tierMulBg,
              paddingHorizontal: 7,
              paddingVertical: 1.5,
              borderRadius: 100,
            }}
          >
            <Text
              style={{
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 9.5,
                color: tierFg,
                letterSpacing: 0.5,
              }}
            >
              {formatMul(tierMul)}× BEANS
            </Text>
          </View>
          <ChevronRight size={12} color={tierFg} strokeWidth={2.4} />
        </View>
      </Pressable>

      {/* ── Body: Beans + streak + progress ─────────────────────────
          Padding + type sizing matches the original CompactHero
          dimensions so the card slots back into the layout at the
          height customers are used to. */}
      <View style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, flexShrink: 1 }}>
            <Text
              style={{
                fontFamily: "Peachi-Bold",
                fontSize: 32,
                color: "#FFFFFF",
                letterSpacing: -1,
                lineHeight: 32,
              }}
              numberOfLines={1}
            >
              {balance.toLocaleString()}
            </Text>
            <Text
              style={{
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 11,
                color: "rgba(255,255,255,0.55)",
                letterSpacing: 1.5,
                textTransform: "uppercase",
              }}
            >
              Beans
            </Text>
          </View>

          {/* Streak — amber-on-espresso chip. Hidden when none. */}
          {streakWeeks > 0 && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: 8,
                paddingVertical: 3,
                backgroundColor: "rgba(251,191,36,0.14)",
                borderRadius: 100,
                borderWidth: 1,
                borderColor: "rgba(251,191,36,0.35)",
              }}
            >
              <Flame size={11} color="#FBBF24" strokeWidth={2.2} />
              <Text
                style={{
                  fontFamily: "SpaceGrotesk_700Bold",
                  fontSize: 10.5,
                  color: "#FBBF24",
                }}
              >
                {streakWeeks} {streakWeeks === 1 ? "wk" : "wks"}
              </Text>
            </View>
          )}
        </View>

        {/* Progress strip — gold rail on a translucent track. Surfaces
            "X Beans to next reward" + "RM/visits to next tier" so both
            short-term and long-term goals are visible at a glance. */}
        {nextReward && (
          <>
            <View
              style={{
                marginTop: 10,
                height: 4,
                borderRadius: 2,
                backgroundColor: "rgba(255,255,255,0.10)",
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  height: "100%",
                  width: `${Math.round(nextProgress * 100)}%`,
                  backgroundColor: "#FBBF24",
                  borderRadius: 2,
                }}
              />
            </View>
            <View
              style={{
                marginTop: 7,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <Text
                style={{
                  fontFamily: "SpaceGrotesk_500Medium",
                  fontSize: 11,
                  color: "rgba(255,255,255,0.55)",
                  flexShrink: 1,
                }}
                numberOfLines={1}
              >
                <Text style={{ color: "#FFFFFF", fontFamily: "SpaceGrotesk_700Bold" }}>
                  {nextShortBy.toLocaleString()}
                </Text>
                {" "}to {nextReward.name}
              </Text>
              {tierCaption && (
                <Text
                  style={{
                    fontFamily: "SpaceGrotesk_700Bold",
                    fontSize: 11,
                    color: "#FBBF24",
                  }}
                  numberOfLines={1}
                >
                  {tierCaption}
                </Text>
              )}
            </View>
          </>
        )}
        {/* No reward in reach yet — still surface tier progress on its
            own line so the hero never reads as silent. */}
        {!nextReward && tierCaption && (
          <Text
            style={{
              marginTop: 8,
              fontFamily: "SpaceGrotesk_700Bold",
              fontSize: 11,
              color: "#FBBF24",
            }}
          >
            {tierCaption}
          </Text>
        )}
      </View>
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
  streak,
  chests,
}: {
  activeMission: Awaited<ReturnType<typeof fetchActiveMission>>;
  streak: StreakState | null;
  chests: StreakChestsResponse;
}) {
  const [streakSheet, setStreakSheet] = useState(false);
  const [celebration, setCelebration] = useState<{
    outcome: StreakChestClaimOutcome;
    weeks: number;
  } | null>(null);
  const queryClient = useQueryClient();
  const streakWeeks = streak?.current_streak_weeks ?? 0;
  const longestWeeks = streak?.longest_streak_weeks ?? 0;

  const claimChestMut = useMutation({
    mutationFn: (chest: StreakChest) => claimStreakChest(chest.id),
    onSuccess: (res, chest) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCelebration({ outcome: res.outcome, weeks: chest.streak_at_qualify });
      queryClient.invalidateQueries({ queryKey: ["streak-chests"] });
      queryClient.invalidateQueries({ queryKey: ["my-vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["rewards"] });
      queryClient.invalidateQueries({ queryKey: ["tier"] });
    },
    onError: (e: unknown) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Couldn't open bag", e instanceof Error ? e.message : "Try again in a moment");
    },
  });

  // The most actionable chest is always the newest claimable one.
  const nextChest = chests.claimable[0] ?? null;
  const nextTier  = nextChest
    ? chests.tier_ladder.find((t) => t.streak_floor === nextChest.tier_floor) ?? null
    : null;

  return (
    <>
      <MissionCard mission={activeMission} />

      {/* Streak chest — the centerpiece. Shows the next claimable
          chest if there is one, otherwise becomes a "build your
          streak" prompt with the same tappable affordance. */}
      {nextChest && nextTier ? (
        <ChestClaimCard
          chest={nextChest}
          tier={nextTier}
          streakWeeks={streakWeeks}
          onOpen={() => claimChestMut.mutate(nextChest)}
          onTapDetails={() => {
            Haptics.selectionAsync();
            setStreakSheet(true);
          }}
          claiming={claimChestMut.isPending}
        />
      ) : (
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            setStreakSheet(true);
          }}
          className="mt-6 bg-surface rounded-2xl border border-border p-4 flex-row items-center active:opacity-85"
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
              backgroundColor: streakWeeks > 0 ? "rgba(192,80,64,0.15)" : "#FBEBE8",
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
              numberOfLines={1}
            >
              {streakWeeks > 0
                ? `Order this week to unlock your next bag · best: ${longestWeeks}wk`
                : "One order a week earns a bag — tap to learn how"}
            </Text>
          </View>
          <ChevronRight size={16} color="#8E8E93" />
        </Pressable>
      )}

      <StreakSheet
        visible={streakSheet}
        onClose={() => setStreakSheet(false)}
        streak={streak}
        chests={chests}
      />

      {celebration && (
        <ChestCelebrationModal
          outcome={celebration.outcome}
          weeks={celebration.weeks}
          onClose={() => setCelebration(null)}
        />
      )}

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

// ─── Chest claim card ────────────────────────────────────────────────
// The marquee card on the Challenges tab when a chest is waiting. Big
// emoji badge, tier label, reward preview, and a chunky gold "Open
// chest" pill. Tapping the body (outside the pill) opens the streak
// sheet so customers can browse the ladder.
function ChestClaimCard({
  chest, tier, streakWeeks, onOpen, onTapDetails, claiming,
}: {
  chest: StreakChest;
  tier: StreakChestTier;
  streakWeeks: number;
  onOpen: () => void;
  onTapDetails: () => void;
  claiming: boolean;
}) {
  const rewardChips: string[] = [];
  if (tier.bonus_beans > 0)   rewardChips.push(`+${tier.bonus_beans} Beans`);
  if (tier.voucher_title)     rewardChips.push(tier.voucher_title);
  return (
    <Pressable
      onPress={onTapDetails}
      className="mt-6 rounded-2xl overflow-hidden active:opacity-95"
      style={{
        backgroundColor: "#1A0200",
        shadowColor: "#160800",
        shadowOpacity: 0.22,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
        elevation: 5,
      }}
    >
      <View style={{ padding: 18 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View
            style={{
              width: 64, height: 64, borderRadius: 18,
              backgroundColor: "rgba(251,191,36,0.18)",
              alignItems: "center", justifyContent: "center",
              borderWidth: 1,
              borderColor: "rgba(251,191,36,0.35)",
            }}
          >
            <Text style={{ fontSize: 32 }}>{tier.emoji}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 10.5,
                color: "#FBBF24",
                letterSpacing: 2,
                textTransform: "uppercase",
                marginBottom: 2,
              }}
              numberOfLines={1}
            >
              Week {streakWeeks > 0 ? streakWeeks : chest.streak_at_qualify} bag ready
            </Text>
            <Text
              style={{
                fontFamily: "Peachi-Bold",
                fontSize: 19,
                color: "#FFFFFF",
                letterSpacing: -0.3,
              }}
              numberOfLines={1}
            >
              {tier.label}
            </Text>
            {rewardChips.length > 0 && (
              <Text
                style={{
                  fontFamily: "SpaceGrotesk_500Medium",
                  fontSize: 12,
                  color: "rgba(255,255,255,0.65)",
                  marginTop: 3,
                }}
                numberOfLines={1}
              >
                {rewardChips.join(" · ")}
              </Text>
            )}
          </View>
        </View>

        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            if (claiming) return;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onOpen();
          }}
          disabled={claiming}
          className="active:opacity-85"
          style={{
            marginTop: 16,
            backgroundColor: "#FBBF24",
            borderRadius: 100,
            paddingVertical: 13,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            opacity: claiming ? 0.6 : 1,
          }}
        >
          {claiming ? (
            <ActivityIndicator size="small" color="#1A0200" />
          ) : (
            <>
              <Gift size={15} color="#1A0200" strokeWidth={2.4} />
              <Text
                style={{
                  fontFamily: "Peachi-Bold",
                  fontSize: 14.5,
                  color: "#1A0200",
                  letterSpacing: 0.2,
                }}
              >
                Open bag
              </Text>
            </>
          )}
        </Pressable>

        <Text
          style={{
            marginTop: 10,
            fontFamily: "SpaceGrotesk_500Medium",
            fontSize: 11,
            color: "rgba(255,255,255,0.45)",
            textAlign: "center",
          }}
        >
          Tap card to see the bag ladder
        </Text>
      </View>
    </Pressable>
  );
}

// ─── Bean-bag celebration modal ──────────────────────────────────────
// Mirrors MilestoneCelebration but tuned for the weekly rhythm. The
// emoji is the tier's emoji (rises through the ladder: 🫘 🛍️ ☕ 🏆 👑)
// so the moment visibly upgrades as the customer's streak grows.
// Single "Got it" CTA — the previous "View in wallet" pill landed
// customers on the same screen they were already on, which felt
// redundant. Voucher is already in the wallet; they can navigate
// there on their own time.
function ChestCelebrationModal({
  outcome, weeks, onClose,
}: {
  outcome: StreakChestClaimOutcome;
  weeks: number;
  onClose: () => void;
}) {
  const hasVoucher = !!outcome.voucher_title;
  const hasBeans   = outcome.bonus_beans > 0;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.65)",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            width: "100%",
            maxWidth: 360,
            borderRadius: 24,
            backgroundColor: "#1A0200",
            padding: 24,
            alignItems: "center",
            shadowColor: "#000",
            shadowOpacity: 0.4,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 12 },
          }}
        >
          <View
            style={{
              width: 86, height: 86, borderRadius: 43,
              backgroundColor: "rgba(251,191,36,0.18)",
              alignItems: "center", justifyContent: "center",
              marginBottom: 14,
              borderWidth: 1,
              borderColor: "rgba(251,191,36,0.4)",
            }}
          >
            <Text style={{ fontSize: 44 }}>{outcome.emoji}</Text>
          </View>

          <Text style={{
            fontFamily: "SpaceGrotesk_700Bold",
            fontSize: 10.5, color: "#FBBF24",
            letterSpacing: 2, textTransform: "uppercase", marginBottom: 4,
          }}>
            Week {weeks} bag opened
          </Text>
          <Text
            style={{ fontFamily: "Peachi-Bold", fontSize: 24, color: "#FFFFFF", letterSpacing: -0.3, textAlign: "center" }}
            numberOfLines={2}
          >
            {outcome.label}
          </Text>

          {/* Outcome */}
          <View style={{ alignSelf: "stretch", marginTop: 18, borderTopWidth: 1, borderTopColor: "rgba(251,191,36,0.15)", paddingTop: 14, gap: 8 }}>
            {hasVoucher && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Gift size={16} color="#FBBF24" strokeWidth={2} />
                <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 13, color: "rgba(255,255,255,0.92)" }} numberOfLines={1}>
                  {outcome.voucher_title}
                </Text>
              </View>
            )}
            {hasBeans && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Sparkles size={16} color="#FBBF24" strokeWidth={2} />
                <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 13, color: "rgba(255,255,255,0.92)" }}>
                  +{outcome.bonus_beans.toLocaleString()} Beans
                </Text>
              </View>
            )}
          </View>

          <View style={{ alignSelf: "stretch", marginTop: 22 }}>
            <Pressable
              onPress={onClose}
              className="active:opacity-85"
              style={{ backgroundColor: "#FBBF24", borderRadius: 100, paddingVertical: 13, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ fontFamily: "Peachi-Bold", fontSize: 14, color: "#1A0200" }}>
                Got it
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Streak sheet ────────────────────────────────────────────────────
// Tapping the "Build your streak" card opens this. Surfaces the
// customer's current state (current weeks, longest run, saver
// availability + the date their last saver was burned + when their
// next saver refills), and a clear "how this works" explainer so
// streaks stop being a passive number on the home screen.
//
// CTA at the bottom takes the customer to Menu so they can act on
// the explanation — if their next order keeps the streak alive,
// that should be one tap away.

function StreakSheet({
  visible, onClose, streak, chests,
}: {
  visible: boolean;
  onClose: () => void;
  streak: StreakState | null;
  chests?: StreakChestsResponse;
}) {
  const current = streak?.current_streak_weeks ?? 0;
  const longest = streak?.longest_streak_weeks ?? 0;
  const saver   = streak?.saver_available ?? true;
  const lastWeek = streak?.last_order_week_start ?? null;

  // Did the customer order in the current ISO-Monday week? If not we
  // surface a "place an order to keep it alive" nudge.
  function thisWeekStartMs(): number {
    const now = new Date();
    const dow = now.getDay(); // 0=Sun, 1=Mon, ...
    const daysFromMonday = (dow + 6) % 7;
    const mon = new Date(now);
    mon.setDate(now.getDate() - daysFromMonday);
    mon.setHours(0, 0, 0, 0);
    return mon.getTime();
  }
  const orderedThisWeek =
    !!lastWeek && new Date(lastWeek).getTime() >= thisWeekStartMs();
  const atRisk = current > 0 && !orderedThisWeek;

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.55)",
          justifyContent: "flex-end",
        }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: "#FFFFFF",
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingHorizontal: 22,
            paddingTop: 14,
            paddingBottom: 34,
          }}
        >
          {/* Drag indicator */}
          <View
            style={{
              alignSelf: "center",
              width: 38, height: 4, borderRadius: 2,
              backgroundColor: "rgba(26,2,0,0.12)",
              marginBottom: 16,
            }}
          />

          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View
              style={{
                width: 52, height: 52, borderRadius: 14,
                backgroundColor: current > 0 ? "rgba(192,80,64,0.15)" : "#FBEBE8",
                alignItems: "center", justifyContent: "center",
              }}
            >
              <Flame size={26} color="#C05040" strokeWidth={1.8} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: "Peachi-Bold", fontSize: 22, color: "#1A0200", letterSpacing: -0.3 }}>
                {current > 0 ? `${current}-week streak` : "Build your streak"}
              </Text>
              <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 12.5, color: "#6B6B6B", marginTop: 2 }}>
                {current > 0
                  ? "One order each week keeps it alive"
                  : "Order once a week to start a streak"}
              </Text>
            </View>
          </View>

          {/* Stat row */}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
            <StreakStat label="Current"  value={current} suffix={current === 1 ? "wk" : "wks"} accent="#C05040" />
            <StreakStat label="Longest"  value={longest} suffix={longest === 1 ? "wk" : "wks"} accent="#1A0200" />
            <StreakStat
              label="Saver"
              value={saver ? "Ready" : "Used"}
              accent={saver ? "#22C55E" : "#8E8E93"}
            />
          </View>

          {/* Status line */}
          {atRisk && (
            <View
              style={{
                marginTop: 14,
                padding: 12,
                borderRadius: 14,
                backgroundColor: "#FEF3C7",
                borderWidth: 1,
                borderColor: "rgba(217,148,4,0.30)",
              }}
            >
              <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 11, color: "#92400E", letterSpacing: 1.4, textTransform: "uppercase" }}>
                ⚠ Streak at risk
              </Text>
              <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 12.5, color: "#5A1F16", marginTop: 3, lineHeight: 17 }}>
                Place an order this week or your saver will catch the miss. Burn the saver and your next miss resets the streak to 0.
              </Text>
            </View>
          )}

          {/* Chest ladder — shows every tier so the customer sees
              what they're working toward. Highlights the current
              tier and marks past tiers as cleared. */}
          {chests && chests.tier_ladder.length > 0 && (
            <View style={{ marginTop: 18 }}>
              <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 10.5, color: "#6B6B6B", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 8 }}>
                Bean bag ladder
              </Text>
              <View style={{ gap: 8 }}>
                {chests.tier_ladder.map((t) => (
                  <ChestLadderRow
                    key={t.streak_floor}
                    tier={t}
                    currentStreak={current}
                  />
                ))}
              </View>
            </View>
          )}

          {/* How it works */}
          <View style={{ marginTop: 18 }}>
            <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 10.5, color: "#6B6B6B", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 8 }}>
              How streaks work
            </Text>
            <StreakRule
              icon="🗓"
              title="One order a week, every week"
              body="Order at least once between Monday and Sunday (MYT) and your streak ticks up by one."
            />
            <StreakRule
              icon="🫘"
              title="Open a bean bag every week you order"
              body="The bag gets better as your streak grows: Week 1, 4, 8, 12, and 24 each upgrade your reward."
            />
            <StreakRule
              icon="🛡"
              title="One saver per quarter"
              body="Miss a week and the saver absorbs it. A fresh saver appears 90 days after your last one was used."
            />
            <StreakRule
              icon="🏆"
              title="Streaks unlock milestones"
              body="Hit thresholds on the Milestones tab (e.g. 4-week run) to earn bonus rewards + Beans."
              last
            />
          </View>

          {/* CTA */}
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              onClose();
              router.push("/menu");
            }}
            className="active:opacity-85"
            style={{
              marginTop: 18,
              backgroundColor: "#1A0200",
              borderRadius: 100,
              paddingVertical: 14,
              alignItems: "center",
              flexDirection: "row",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <Text style={{ fontFamily: "Peachi-Bold", fontSize: 15, color: "#FFFFFF" }}>
              {orderedThisWeek ? "Order again" : "Order now"}
            </Text>
            <ChevronRight size={16} color="#FFFFFF" strokeWidth={2.4} />
          </Pressable>
          <Pressable onPress={onClose} className="active:opacity-70" style={{ paddingVertical: 10, alignItems: "center", marginTop: 4 }}>
            <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 13, color: "#6B6B6B" }}>
              Close
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function StreakStat({
  label, value, suffix, accent,
}: {
  label: string;
  value: number | string;
  suffix?: string;
  accent: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#FFFFFF",
        borderRadius: 14,
        padding: 12,
        borderWidth: 1,
        borderColor: "#E5E5E5",
      }}
    >
      <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 9.5, color: "#8E8E93", letterSpacing: 1.4, textTransform: "uppercase" }}>
        {label}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3, marginTop: 4 }}>
        <Text style={{ fontFamily: "Peachi-Bold", fontSize: 22, color: accent, letterSpacing: -0.3, lineHeight: 24 }}>
          {value}
        </Text>
        {suffix && (
          <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 10, color: "#8E8E93", letterSpacing: 1 }}>
            {suffix}
          </Text>
        )}
      </View>
    </View>
  );
}

// Single row on the chest ladder. Three visual states based on the
// customer's current streak vs this tier's floor:
//   - active   (current is at this exact tier): espresso bg + gold ring
//   - cleared  (current >= this floor, but there's a higher tier they
//               match): light surface with a check
//   - locked   (current < floor): faded preview with "X-week chest"
function ChestLadderRow({
  tier, currentStreak,
}: {
  tier: StreakChestTier;
  currentStreak: number;
}) {
  const cleared = currentStreak >= tier.streak_floor;
  const reward: string[] = [];
  if (tier.bonus_beans > 0) reward.push(`+${tier.bonus_beans} Beans`);
  if (tier.voucher_title)   reward.push(tier.voucher_title);
  const rewardLine = reward.length > 0 ? reward.join(" · ") : "Bonus reward";

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 11,
        borderRadius: 14,
        backgroundColor: cleared ? "#FFFFFF" : "#FBEBE8",
        borderWidth: 1,
        borderColor: cleared ? "#E5E5E5" : "rgba(192,80,64,0.25)",
        opacity: cleared ? 1 : 0.85,
      }}
    >
      <View
        style={{
          width: 38, height: 38, borderRadius: 10,
          backgroundColor: cleared ? "rgba(34,197,94,0.12)" : "rgba(192,80,64,0.12)",
          alignItems: "center", justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 20 }}>{tier.emoji}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{ fontFamily: "Peachi-Bold", fontSize: 13.5, color: "#1A0200" }}
          numberOfLines={1}
        >
          {tier.label}
        </Text>
        <Text
          style={{
            fontFamily: "SpaceGrotesk_500Medium",
            fontSize: 11.5,
            color: "#6B6B6B",
            marginTop: 1,
          }}
          numberOfLines={1}
        >
          Week {tier.streak_floor}+ · {rewardLine}
        </Text>
      </View>
      <Text
        style={{
          fontFamily: "SpaceGrotesk_700Bold",
          fontSize: 10.5,
          color: cleared ? "#22C55E" : "#8E8E93",
          letterSpacing: 1.2,
          textTransform: "uppercase",
        }}
      >
        {cleared ? "✓ Unlocked" : "Locked"}
      </Text>
    </View>
  );
}

function StreakRule({
  icon, title, body, last,
}: {
  icon: string;
  title: string;
  body: string;
  last?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 12,
        paddingVertical: 10,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: "#F0E8E5",
      }}
    >
      <Text style={{ fontSize: 18, lineHeight: 22 }}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: "Peachi-Bold", fontSize: 13.5, color: "#1A0200" }}>
          {title}
        </Text>
        <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 12, color: "#6B6B6B", marginTop: 2, lineHeight: 17 }}>
          {body}
        </Text>
      </View>
    </View>
  );
}

// ─── Tab: Rewards (formerly "Vouchers") ─────────────────────────────
// This is the customer's wallet — issued_rewards rows ready to redeem
// at checkout. Claimables live on the Claim tab now (because tapping
// one moves it INTO this wallet).

// ─── Tab: Rewards (unified) ─────────────────────────────────────────
// Single home for everything reward-related:
//
//   Yours        — wallet vouchers ready to redeem (gifts, mission
//                  wins, mystery reveals, points-shop redeems — all
//                  with a "Use" pill, all in one place)
//   Get more
//     Claim now  — admin claimables (one-tap, free)
//     Spend Beans — points-shop catalogue (Claim · N → Use)
//
// One verb per area: "Use" for everything in Yours, "Claim" for
// everything in Get more. Customer learns the rule once.

// ─── Tab: Milestones ────────────────────────────────────────────────
//
// Long-term progression in one place. Section order matters:
//   1. Next tier — what the customer is actively working toward right
//      now. This is the highest-frequency question ("how do I get to
//      Gold?") and lives at the top.
//   2. Lifetime achievements — the milestone ladder configured in
//      backoffice (50 cups, 200 cups, 3 outlets, etc.). Each card
//      shows progress and what the customer earns on unlock.
//   3. Earned — a quiet trophy shelf for everything already cleared.

function MilestonesTab({
  tier,
  milestones,
  loading,
}: {
  tier: MemberTier | null;
  milestones: Milestone[];
  loading: boolean;
}) {
  const queryClient = useQueryClient();
  const [celebration, setCelebration] = useState<{
    milestone: Milestone;
    outcome: MilestoneClaimOutcome;
  } | null>(null);

  const claimMut = useMutation({
    mutationFn: (m: Milestone) => claimMilestone(m.id),
    onSuccess: (res, m) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCelebration({ milestone: m, outcome: res.outcome });
      // Refresh anything the reward could have touched: balance,
      // vouchers, claimables, and the milestones list itself.
      queryClient.invalidateQueries({ queryKey: ["my-milestones"] });
      queryClient.invalidateQueries({ queryKey: ["my-vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["rewards"] });
      queryClient.invalidateQueries({ queryKey: ["tier"] });
    },
    onError: (e: unknown) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Couldn't claim", e instanceof Error ? e.message : "Try again in a moment");
    },
  });

  // Partition into the three lifecycle buckets so the most actionable
  // rows surface first: claimable on top (do something now!), locked
  // in the middle (working toward), and the earned trophy shelf last.
  const claimable = milestones.filter((m) => m.state === "claimable");
  const locked    = milestones.filter((m) => m.state === "locked");
  const claimed   = milestones.filter((m) => m.state === "claimed").sort((a, b) => {
    const ta = a.claimed_at ? new Date(a.claimed_at).getTime() : 0;
    const tb = b.claimed_at ? new Date(b.claimed_at).getTime() : 0;
    return tb - ta;
  });

  return (
    <View style={{ gap: 20 }}>
      {/* ── 1. Next tier ─────────────────────────────────────────── */}
      <NextTierCard tier={tier} />

      {/* ── 2. Ready-to-claim section — only shown when something is
              actively waiting on the customer. Espresso card with a
              gold "Claim" pill keeps the moment celebratory. */}
      {claimable.length > 0 && (
        <View>
          <SectionLabel label="Ready to claim" count={claimable.length} />
          <View style={{ gap: 10, marginTop: 6 }}>
            {claimable.map((m) => (
              <MilestoneRow
                key={m.id}
                milestone={m}
                onClaim={() => claimMut.mutate(m)}
                claiming={claimMut.isPending && claimMut.variables?.id === m.id}
              />
            ))}
          </View>
        </View>
      )}

      {/* ── 3. Locked achievements ladder ─────────────────────────── */}
      <View>
        <SectionLabel label="Achievements" count={milestones.length} />
        {loading ? (
          <View
            className="bg-surface rounded-2xl border border-border p-5 mt-2"
            style={{ alignItems: "center" }}
          >
            <ActivityIndicator color="#C05040" />
          </View>
        ) : milestones.length === 0 ? (
          <View
            className="bg-surface rounded-2xl border border-border p-5 mt-2"
            style={{ alignItems: "center" }}
          >
            <Text
              className="text-muted-fg text-[13px] text-center"
              style={{ fontFamily: "SpaceGrotesk_500Medium" }}
            >
              No milestones set up yet. Check back soon.
            </Text>
          </View>
        ) : (
          <View style={{ gap: 10, marginTop: 6 }}>
            {locked.map((m) => (
              <MilestoneRow key={m.id} milestone={m} />
            ))}
          </View>
        )}
      </View>

      {/* ── 4. Earned trophy shelf ──────────────────────────────── */}
      {claimed.length > 0 && (
        <View>
          <SectionLabel label="Earned" count={claimed.length} />
          <View style={{ gap: 10, marginTop: 6 }}>
            {claimed.map((m) => (
              <MilestoneRow key={m.id} milestone={m} />
            ))}
          </View>
        </View>
      )}

      {/* ── Celebration modal — fires after a successful claim ──── */}
      {celebration && (
        <MilestoneCelebration
          milestone={celebration.milestone}
          outcome={celebration.outcome}
          onClose={() => setCelebration(null)}
        />
      )}
    </View>
  );
}

// Celebration sheet — espresso surface, gold accents, mirrors the
// Mystery Bean reveal language so wins across the app feel like the
// same family. Shown the moment a milestone claim succeeds. Single
// "Got it" CTA — the previous "View in wallet" pill flipped the tab
// on the same screen, which read as redundant.
function MilestoneCelebration({
  milestone,
  outcome,
  onClose,
}: {
  milestone: Milestone;
  outcome: MilestoneClaimOutcome;
  onClose: () => void;
}) {
  const hasVouchers = outcome.voucher_titles.length > 0;
  const hasBeans    = outcome.bonus_beans > 0;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.65)",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            width: "100%",
            maxWidth: 360,
            borderRadius: 24,
            backgroundColor: "#1A0200",
            padding: 24,
            alignItems: "center",
            shadowColor: "#000",
            shadowOpacity: 0.4,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 12 },
          }}
        >
          <View
            style={{
              width: 72, height: 72, borderRadius: 36,
              backgroundColor: "rgba(251,191,36,0.18)",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 14,
            }}
          >
            <Trophy size={36} color="#FBBF24" strokeWidth={1.8} />
          </View>

          <Text
            style={{
              fontFamily: "SpaceGrotesk_700Bold",
              fontSize: 10.5,
              color: "#FBBF24",
              letterSpacing: 2,
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            Milestone unlocked
          </Text>
          <Text
            style={{
              fontFamily: "Peachi-Bold",
              fontSize: 24,
              color: "#FFFFFF",
              letterSpacing: -0.3,
              textAlign: "center",
            }}
            numberOfLines={2}
          >
            {milestone.title}
          </Text>

          {/* Outcome list */}
          <View
            style={{
              alignSelf: "stretch",
              marginTop: 18,
              borderTopWidth: 1,
              borderTopColor: "rgba(251,191,36,0.15)",
              paddingTop: 14,
              gap: 8,
            }}
          >
            {hasVouchers && outcome.voucher_titles.map((t, i) => (
              <View
                key={i}
                style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
              >
                <Gift size={16} color="#FBBF24" strokeWidth={2} />
                <Text
                  style={{
                    fontFamily: "SpaceGrotesk_500Medium",
                    fontSize: 13,
                    color: "rgba(255,255,255,0.92)",
                  }}
                  numberOfLines={1}
                >
                  {t}
                </Text>
              </View>
            ))}
            {hasBeans && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Sparkles size={16} color="#FBBF24" strokeWidth={2} />
                <Text
                  style={{
                    fontFamily: "SpaceGrotesk_500Medium",
                    fontSize: 13,
                    color: "rgba(255,255,255,0.92)",
                  }}
                >
                  +{outcome.bonus_beans.toLocaleString()} Beans
                </Text>
              </View>
            )}
            {!hasVouchers && !hasBeans && (
              <Text
                style={{
                  fontFamily: "SpaceGrotesk_500Medium",
                  fontSize: 13,
                  color: "rgba(255,255,255,0.65)",
                  textAlign: "center",
                }}
              >
                Achievement added to your trophy shelf.
              </Text>
            )}
          </View>

          {/* Single dismiss action — voucher's already in the wallet,
              tab-flipping on the same screen felt redundant. */}
          <View style={{ alignSelf: "stretch", marginTop: 22 }}>
            <Pressable
              onPress={onClose}
              className="active:opacity-85"
              style={{
                backgroundColor: "#FBBF24",
                borderRadius: 100,
                paddingVertical: 13,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{
                  fontFamily: "Peachi-Bold",
                  fontSize: 14,
                  color: "#1A0200",
                }}
              >
                Got it
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Hero card for "what's next" — tier progression. Espresso panel with
// gold accents matching the membership tier hero language.
function NextTierCard({ tier }: { tier: MemberTier | null }) {
  // No tier API response yet — show a quiet placeholder.
  if (!tier) {
    return (
      <View className="bg-surface rounded-2xl border border-border p-5 items-center">
        <Sparkles size={24} color="#8E8E93" />
        <Text
          className="text-muted-fg text-[13px] mt-2 text-center"
          style={{ fontFamily: "SpaceGrotesk_500Medium" }}
        >
          Sign in to see your tier progress.
        </Text>
      </View>
    );
  }

  const nextTierName     = tier.next_tier_name;
  const qualification    = tier.tier_qualification ?? tier.next_tier_qualification ?? "visits";
  // Already at the top tier — celebrate, don't badger.
  if (!nextTierName) {
    return (
      <View
        className="rounded-2xl p-5"
        style={{
          backgroundColor: "#1A0200",
          shadowColor: "#160800",
          shadowOpacity: 0.18,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
        }}
      >
        <Text
          style={{
            fontFamily: "SpaceGrotesk_700Bold",
            fontSize: 10,
            color: "#FBBF24",
            letterSpacing: 2,
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          Top tier
        </Text>
        <Text
          style={{
            fontFamily: "Peachi-Bold",
            fontSize: 22,
            color: "#FFFFFF",
            letterSpacing: -0.3,
          }}
        >
          You&apos;re already at the top.
        </Text>
        <Text
          style={{
            fontFamily: "SpaceGrotesk_500Medium",
            fontSize: 13,
            color: "rgba(255,255,255,0.7)",
            marginTop: 4,
          }}
        >
          {tier.tier_name ?? "Member"} · {tier.tier_multiplier ?? 1}× Beans on every order
        </Text>
      </View>
    );
  }

  // Distance + denominator based on qualification metric.
  const useSpend = qualification === "spend" || qualification === "spend_lifetime";
  const distance = useSpend
    ? Math.max(0, Math.ceil(tier.spend_to_next_tier))
    : Math.max(0, tier.visits_to_next_tier);
  const denom = useSpend
    ? Math.max(1, tier.next_tier_min_spend ?? 1)
    : Math.max(1, tier.next_tier_min_visits ?? 1);
  const current = useSpend
    ? Math.max(0, tier.spend_this_period)
    : Math.max(0, tier.visits_this_period);
  const progress = Math.max(0, Math.min(1, current / denom));
  const metricLabel = useSpend ? "RM" : "visit";
  const remainingCopy = useSpend
    ? `RM${distance} to ${nextTierName}`
    : `${distance} ${distance === 1 ? "visit" : "visits"} to ${nextTierName}`;
  const periodCopy = useSpend && qualification === "spend_lifetime"
    ? "Lifetime spend"
    : `Last ${tier.period_days ?? 90} days`;

  return (
    <View
      className="rounded-2xl p-5"
      style={{
        backgroundColor: "#1A0200",
        shadowColor: "#160800",
        shadowOpacity: 0.2,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
      }}
    >
      <Text
        style={{
          fontFamily: "SpaceGrotesk_700Bold",
          fontSize: 10,
          color: "#FBBF24",
          letterSpacing: 2,
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        Next tier
      </Text>
      <Text
        style={{
          fontFamily: "Peachi-Bold",
          fontSize: 22,
          color: "#FBBF24",
          letterSpacing: -0.3,
        }}
      >
        {remainingCopy}
      </Text>
      <Text
        style={{
          fontFamily: "SpaceGrotesk_500Medium",
          fontSize: 12,
          color: "rgba(255,255,255,0.6)",
          marginTop: 4,
        }}
      >
        {periodCopy} · {current.toLocaleString()}
        {useSpend ? ` ${metricLabel}` : ` ${metricLabel}${current === 1 ? "" : "s"}`}
        {" "}of {denom.toLocaleString()}{useSpend ? "" : " visits"}
      </Text>

      {/* Progress track — gold fill against a thin amber-shadow rail. */}
      <View
        style={{
          height: 8,
          marginTop: 14,
          borderRadius: 4,
          backgroundColor: "rgba(251,191,36,0.15)",
          overflow: "hidden",
        }}
      >
        <View
          style={{
            height: "100%",
            width: `${Math.round(progress * 100)}%`,
            backgroundColor: "#FBBF24",
            borderRadius: 4,
          }}
        />
      </View>

      {/* Tier multiplier preview — what they UNLOCK at the next tier. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          marginTop: 14,
        }}
      >
        <Sparkles size={13} color="#FBBF24" strokeWidth={2} />
        <Text
          style={{
            fontFamily: "SpaceGrotesk_700Bold",
            fontSize: 12,
            color: "rgba(255,255,255,0.85)",
          }}
        >
          {nextTierName}
        </Text>
        <Text
          style={{
            fontFamily: "SpaceGrotesk_500Medium",
            fontSize: 12,
            color: "rgba(255,255,255,0.55)",
          }}
        >
          unlocks faster Beans + member perks
        </Text>
      </View>
    </View>
  );
}

// One milestone card. Three visual states:
//   locked     → white card, terracotta progress + caption
//   claimable  → espresso card with a pulsing gold "Claim" pill — the
//                most actionable row on the page
//   claimed    → espresso card with a quiet "Earned · date" footer
function MilestoneRow({
  milestone,
  onClaim,
  claiming,
}: {
  milestone: Milestone;
  onClaim?: () => void;
  claiming?: boolean;
}) {
  const state = milestone.state;
  const progress = Math.max(0, Math.min(1, milestone.progress_current / Math.max(1, milestone.trigger_value)));
  const remaining = Math.max(0, milestone.trigger_value - milestone.progress_current);

  // Render-friendly metric units per trigger.
  const unit: { single: string; plural: string } = (() => {
    switch (milestone.trigger_type) {
      case "lifetime_orders":  return { single: "order", plural: "orders" };
      case "lifetime_beans":   return { single: "Bean",  plural: "Beans" };
      case "distinct_outlets": return { single: "outlet", plural: "outlets" };
      case "streak_weeks":     return { single: "week",  plural: "weeks" };
    }
  })();
  const unitLabel = milestone.trigger_value === 1 ? unit.single : unit.plural;

  // Reward summary line under the title.
  const rewardChips: string[] = [];
  if (milestone.reward_voucher_template_ids?.length > 0) {
    const n = milestone.reward_voucher_template_ids.length;
    rewardChips.push(`${n} reward${n === 1 ? "" : "s"}`);
  }
  if ((milestone.reward_bonus_beans ?? 0) > 0) {
    rewardChips.push(`+${milestone.reward_bonus_beans} Beans`);
  }

  // Theme by state. Claimable + claimed both use the espresso theme
  // so the trophy shelf reads consistently; the Claim CTA is the
  // visual differentiator.
  const isEspresso = state !== "locked";
  const bg     = isEspresso ? "#1A0200" : "#FFFFFF";
  const border = isEspresso ? "#1A0200" : "#E5E5E5";
  const fg     = isEspresso ? "#FFFFFF" : "#1A0200";
  const muted  = isEspresso ? "rgba(255,255,255,0.6)" : "#6B6B6B";
  const accent = isEspresso ? "#FBBF24" : "#C05040";

  return (
    <View
      className="rounded-2xl"
      style={{
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
        padding: 14,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View
          style={{
            width: 44, height: 44, borderRadius: 12,
            backgroundColor: isEspresso ? "rgba(251,191,36,0.18)" : "#FBEBE8",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Trophy size={20} color={accent} strokeWidth={1.8} />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontFamily: "Peachi-Bold",
              fontSize: 15,
              color: fg,
            }}
            numberOfLines={1}
          >
            {milestone.title}
          </Text>
          {milestone.description && (
            <Text
              style={{
                fontFamily: "SpaceGrotesk_500Medium",
                fontSize: 12,
                color: muted,
                marginTop: 2,
              }}
              numberOfLines={2}
            >
              {milestone.description}
            </Text>
          )}
          {rewardChips.length > 0 && (
            <Text
              style={{
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 10.5,
                color: accent,
                letterSpacing: 1.2,
                textTransform: "uppercase",
                marginTop: 6,
              }}
              numberOfLines={1}
            >
              {rewardChips.join(" · ")}
            </Text>
          )}
        </View>
      </View>

      {/* State-specific footer */}
      {state === "claimable" && (
        <Pressable
          onPress={() => {
            if (claiming) return;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onClaim?.();
          }}
          disabled={!!claiming}
          className="active:opacity-85"
          style={{
            marginTop: 14,
            backgroundColor: "#FBBF24",
            borderRadius: 100,
            paddingVertical: 11,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            opacity: claiming ? 0.6 : 1,
          }}
        >
          {claiming ? (
            <ActivityIndicator size="small" color="#1A0200" />
          ) : (
            <>
              <Gift size={14} color="#1A0200" strokeWidth={2.4} />
              <Text
                style={{
                  fontFamily: "Peachi-Bold",
                  fontSize: 13.5,
                  color: "#1A0200",
                  letterSpacing: 0.2,
                }}
              >
                Claim reward
              </Text>
            </>
          )}
        </Pressable>
      )}
      {state === "claimed" && (
        <Text
          style={{
            fontFamily: "SpaceGrotesk_700Bold",
            fontSize: 10.5,
            color: accent,
            letterSpacing: 1.2,
            textTransform: "uppercase",
            marginTop: 12,
          }}
        >
          ● Earned{milestone.claimed_at ? ` · ${new Date(milestone.claimed_at).toLocaleDateString()}` : ""}
        </Text>
      )}
      {state === "locked" && (
        <>
          <View
            style={{
              height: 6,
              marginTop: 12,
              borderRadius: 3,
              backgroundColor: "rgba(192,80,64,0.12)",
              overflow: "hidden",
            }}
          >
            <View
              style={{
                height: "100%",
                width: `${Math.round(progress * 100)}%`,
                backgroundColor: accent,
                borderRadius: 3,
              }}
            />
          </View>
          <Text
            style={{
              fontFamily: "SpaceGrotesk_500Medium",
              fontSize: 11,
              color: muted,
              marginTop: 6,
            }}
          >
            {milestone.progress_current.toLocaleString()} / {milestone.trigger_value.toLocaleString()} {unitLabel}
            {remaining > 0 ? ` · ${remaining.toLocaleString()} to go` : ""}
          </Text>
        </>
      )}
    </View>
  );
}

function RewardsTabBody({
  vouchers, claimables, rewards, sortedRewards, balance,
  loadingVouchers, loadingRewards,
}: {
  vouchers: Awaited<ReturnType<typeof fetchMyVouchers>>;
  claimables: Awaited<ReturnType<typeof fetchClaimableVouchers>>;
  rewards: Reward[];
  sortedRewards: Reward[];
  balance: number;
  loadingVouchers: boolean;
  loadingRewards: boolean;
}) {
  const activeVouchers = vouchers.filter((v) => v.status === "active");
  const yoursCount = activeVouchers.length;
  const hasClaimables = claimables.length > 0;
  const hasCatalogue  = sortedRewards.length > 0;
  const isLoadingEverything =
    (loadingVouchers && yoursCount === 0) &&
    (loadingRewards && !hasCatalogue) &&
    !hasClaimables;

  if (isLoadingEverything) {
    return (
      <View className="py-12 items-center">
        <CelsiusLoader size="md" />
      </View>
    );
  }

  // Brand-new account with nothing yet — empty state pointing at how
  // to start (which is the catalogue itself, which always has stuff).
  const trulyEmpty =
    yoursCount === 0 &&
    !hasClaimables &&
    !hasCatalogue &&
    !loadingVouchers &&
    !loadingRewards;
  if (trulyEmpty) {
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
          Earn Beans on every order, complete a weekly challenge, or watch for surprises after each pickup.
        </Text>
      </View>
    );
  }

  return (
    <>
      {/* ─── Yours ──────────────────────────────────────────────────── */}
      {yoursCount > 0 ? (
        <View>
          <SectionLabel label="Yours" count={yoursCount} />
          {/* VoucherWallet renders the brand-themed Use cards. hideViewAll
              + a large maxVisible so the section shows everything without
              a redundant "View all" link. */}
          <VoucherWallet vouchers={activeVouchers} maxVisible={50} hideViewAll />
        </View>
      ) : (
        // No wallet vouchers but the customer might still have things
        // to Claim — soft empty state with a nudge instead of the big
        // gift-icon block, so the rest of the screen (claim now / spend
        // Beans) stays visible above the fold.
        <View
          className="px-1 py-5"
          style={{
            alignItems: "center",
          }}
        >
          <Text
            style={{
              fontFamily: "SpaceGrotesk_500Medium",
              fontSize: 12,
              color: "rgba(26,2,0,0.55)",
              textAlign: "center",
            }}
          >
            No vouchers yet — start by claiming below.
          </Text>
        </View>
      )}

      {/* ─── Get more — header for everything below ─────────────────── */}
      {(hasClaimables || hasCatalogue || loadingRewards) && (
        <View style={{ marginTop: yoursCount > 0 ? 20 : 8 }}>
          <SectionLabel label="Get more" />

          {/* Claim now — admin-pushed offers, one-tap free claim. */}
          {hasClaimables && (
            <View style={{ marginBottom: hasCatalogue ? 14 : 0 }}>
              <ClaimableSection claimables={claimables} />
            </View>
          )}

          {/* Spend Beans — points-shop catalogue. */}
          {hasCatalogue && (
            <View>
              <Text
                style={{
                  color: "rgba(26,2,0,0.55)",
                  fontFamily: "SpaceGrotesk_700Bold",
                  fontSize: 10,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  marginTop: 4,
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

          {loadingRewards && !hasCatalogue && (
            <View className="py-8 items-center">
              <CelsiusLoader size="md" />
            </View>
          )}
        </View>
      )}
    </>
  );
}

/** Big section label — used for "Yours" and "Get more". Optional count
 *  pill on the right (chip styled like the tab badge). */
function SectionLabel({ label, count }: { label: string; count?: number }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginBottom: 10,
        paddingHorizontal: 2,
      }}
    >
      <Text
        style={{
          color: "#1A0200",
          fontFamily: "Peachi-Bold",
          fontSize: 17,
          letterSpacing: -0.2,
        }}
      >
        {label}
      </Text>
      {count !== undefined && count > 0 && (
        <View
          style={{
            minWidth: 22,
            height: 18,
            paddingHorizontal: 7,
            borderRadius: 9,
            backgroundColor: "rgba(192,80,64,0.12)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              color: "#C05040",
              fontFamily: "SpaceGrotesk_700Bold",
              fontSize: 11,
            }}
          >
            {count}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Reward card (Claim tab) ────────────────────────────────────────
// Renders a points-shop catalogue reward using the SAME themed card
// language as the wallet's VoucherRow (espresso+gold for free items,
// terracotta+white for discounts, cream+gold for special, etc.).
//
// One visual deck — the only practical difference is the CTA pill:
//   • Affordable → "Claim · {beans}"
//   • Locked → progress strip + "{N} to go"

/** Map a points-shop reward onto the wallet voucher theme. The
 *  category is derived from discount_type so a "RM5" flat-discount
 *  reward and an "RM5 Off" wallet voucher render with the same
 *  terracotta+white card. */
function themeForReward(reward: Reward): typeof VOUCHER_THEME[Voucher["category"]] {
  const dt = reward.discount_type;
  if (dt === "free_item")                                return VOUCHER_THEME.free_item;
  if (dt === "fixed_amount" || dt === "flat" || dt === "percent" || dt === "percentage") return VOUCHER_THEME.discount;
  if (dt === "bogo")                                     return VOUCHER_THEME.free_item; // BOGO ≈ free item
  // free_upgrade / beans_multiplier aren't expected on a points-shop
  // reward today, but cover them anyway.
  const explicitCat = (reward as { category?: string }).category;
  if (explicitCat === "upgrade")                         return VOUCHER_THEME.upgrade;
  if (explicitCat === "multiplier")                      return VOUCHER_THEME.multiplier;
  return VOUCHER_THEME.special;
}

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

  const theme = themeForReward(reward);
  const categoryLabel = categoryToLabel(reward);
  // Use pill text contrast picker — same logic VoucherWallet uses.
  const useFgIsLight = theme.accent === "#FBBF24" || theme.accent === "#FFFFFF" || theme.accent === "#D99404";
  const pillFg = useFgIsLight ? "#1A0200" : "#FFFFFF";

  return (
    <View
      style={{
        borderRadius: 18,
        overflow: "hidden",
        backgroundColor: theme.bg,
        borderWidth: 1,
        borderColor: theme.border,
        opacity: canClaim ? 1 : 0.78,
        shadowColor: "#000",
        shadowOpacity: 0.12,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
      }}
    >
      {/* Ghost mascot — large translucent brand icon tucked bottom-right,
          mirroring the wallet card layout. */}
      <View style={{ position: "absolute", right: -10, bottom: -16, opacity: 0.12 }}>
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
        {/* Foreground brand icon tile (48×48 — matches wallet voucher row). */}
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
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
              marginBottom: 3,
            }}
          >
            <Text
              style={{
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 9.5,
                letterSpacing: 1.4,
                color: theme.accent,
                textTransform: "uppercase",
              }}
              numberOfLines={1}
            >
              {categoryLabel}
            </Text>
            {urgency && (
              <View
                style={{
                  backgroundColor: theme.accent,
                  paddingHorizontal: 5,
                  paddingVertical: 1,
                  borderRadius: 3,
                }}
              >
                <Text
                  style={{
                    color: pillFg,
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
              fontFamily: "Peachi-Bold",
              fontSize: 17,
              color: theme.fg,
              lineHeight: 21,
            }}
            numberOfLines={1}
          >
            {reward.name}
          </Text>

          <Text
            style={{
              marginTop: 2,
              color: theme.fgDim,
              fontFamily: "SpaceGrotesk_500Medium",
              fontSize: 11,
            }}
            numberOfLines={1}
          >
            {canClaim
              ? formatRewardValue(reward)
              : `${shortBy.toLocaleString()} Beans to go`}
          </Text>

          {/* Locked: thin progress strip — uses the card's accent so the
              colour matches the brand theme rather than always terracotta. */}
          {!canClaim && (
            <View
              style={{
                height: 3,
                borderRadius: 2,
                marginTop: 6,
                backgroundColor: theme.iconBg,
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  height: "100%",
                  width: `${Math.max(progress * 100, 4)}%`,
                  backgroundColor: theme.accent,
                  borderRadius: 2,
                }}
              />
            </View>
          )}
        </View>

        {/* CTA — Claim pill when affordable, BEANS cost when locked. */}
        {canClaim ? (
          <Pressable
            onPress={onClaim}
            disabled={claimMutation.isPending}
            className="active:opacity-85"
            style={{
              backgroundColor: theme.accent,
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 999,
              opacity: claimMutation.isPending ? 0.6 : 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Text
              style={{
                color: pillFg,
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 11,
                letterSpacing: 0.8,
                textTransform: "uppercase",
              }}
            >
              {claimMutation.isPending ? "Claiming…" : `Claim · ${required.toLocaleString()}`}
            </Text>
          </Pressable>
        ) : (
          <View style={{ flexDirection: "column", alignItems: "flex-end" }}>
            <Text
              style={{
                color: theme.fg,
                fontFamily: "Peachi-Bold",
                fontSize: 17,
                lineHeight: 19,
              }}
            >
              {required.toLocaleString()}
            </Text>
            <Text
              style={{
                color: theme.fgDim,
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 9,
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
