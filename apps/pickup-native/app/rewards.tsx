import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, Alert, ActivityIndicator } from "react-native";
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
  fetchMyMilestones,
  redeemPointsReward,
  type Milestone,
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

  const vouchers = myVouchersQ.data ?? [];
  const claimables = claimableQ.data ?? [];
  const activeMission = activeMissionQ.data ?? null;
  const streakWeeks = streakQ.data?.current_streak_weeks ?? 0;
  const milestones = milestonesQ.data ?? [];

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
              <ChallengesTab activeMission={activeMission} streakWeeks={streakWeeks} />
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
  // Sort: not-yet-earned first (sorted by trigger_value asc), earned
  // last (sorted by earned_at desc). The API already sorts by
  // trigger_value; we just partition here.
  const unearned = milestones.filter((m) => !m.earned);
  const earned   = milestones.filter((m) => m.earned).sort((a, b) => {
    const ta = a.earned_at ? new Date(a.earned_at).getTime() : 0;
    const tb = b.earned_at ? new Date(b.earned_at).getTime() : 0;
    return tb - ta;
  });

  return (
    <View style={{ gap: 20 }}>
      {/* ── 1. Next tier ─────────────────────────────────────────── */}
      <NextTierCard tier={tier} />

      {/* ── 2. Lifetime milestones ──────────────────────────────── */}
      <View>
        <SectionLabel label="Achievements" count={unearned.length + earned.length} />
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
            {unearned.map((m) => (
              <MilestoneRow key={m.id} milestone={m} />
            ))}
          </View>
        )}
      </View>

      {/* ── 3. Earned trophy shelf ──────────────────────────────── */}
      {earned.length > 0 && (
        <View>
          <SectionLabel label="Earned" count={earned.length} />
          <View style={{ gap: 10, marginTop: 6 }}>
            {earned.map((m) => (
              <MilestoneRow key={m.id} milestone={m} />
            ))}
          </View>
        </View>
      )}
    </View>
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

// One milestone card. Cream/espresso when locked, espresso/gold when
// earned (mirrors the wallet's "auto-issued" theme so earned achievements
// read as the same family of "good things").
function MilestoneRow({ milestone }: { milestone: Milestone }) {
  const earned = milestone.earned;
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
    rewardChips.push(`${n} voucher${n === 1 ? "" : "s"}`);
  }
  if ((milestone.reward_bonus_beans ?? 0) > 0) {
    rewardChips.push(`+${milestone.reward_bonus_beans} Beans`);
  }

  const bg     = earned ? "#1A0200" : "#FFFFFF";
  const border = earned ? "#1A0200" : "#E5E5E5";
  const fg     = earned ? "#FFFFFF" : "#1A0200";
  const muted  = earned ? "rgba(255,255,255,0.6)" : "#6B6B6B";
  const accent = earned ? "#FBBF24" : "#C05040";

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
            backgroundColor: earned ? "rgba(251,191,36,0.18)" : "#FBEBE8",
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

      {/* Progress or earned-date footer */}
      {earned ? (
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
          ● Earned{milestone.earned_at ? ` · ${new Date(milestone.earned_at).toLocaleDateString()}` : ""}
        </Text>
      ) : (
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
