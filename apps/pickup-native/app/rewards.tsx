import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { Stack, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Gift, ChevronRight, Flame, Users, Clock, Sparkles as SparklesIcon } from "lucide-react-native";
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
import {
  fetchMyVouchers,
  fetchClaimableVouchers,
  fetchActiveMission,
  fetchMyStreak,
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

export default function RewardsTab() {
  const phone = useApp((s) => s.phone);
  const loyaltyId = useApp((s) => s.loyaltyId);
  const member = useApp((s) => s.member);
  const seenOnboardings = useApp((s) => s.seenOnboardings);
  const markOnboardingSeen = useApp((s) => s.markOnboardingSeen);

  const [activeTab, setActiveTab] = useState<RewardsTabKey>("challenges");
  const [showOnboarding, setShowOnboarding] = useState(false);

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

  // Full tier ladder — used on the Catalog tab.
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

  const voucherCount = vouchers.filter((v) => v.status === "active").length + claimables.length;

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
            <TabButton label="Vouchers"    active={activeTab === "vouchers"}   onPress={() => selectTab("vouchers")}   badge={voucherCount} />
            <TabButton label="Catalog"     active={activeTab === "catalog"}    onPress={() => selectTab("catalog")} />
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
                claimables={claimables}
                loading={myVouchersQ.isLoading || claimableQ.isLoading}
              />
            )}
            {activeTab === "catalog" && (
              <CatalogTab
                tiers={tiers}
                tier={tier}
                member={member}
                balance={balance}
                rewards={rewards}
                sortedRewards={sortedRewards}
                isLoading={isLoading}
                tierDisplayName={ts.displayName}
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
  // Tier badge styling — match the legacy TierCard pattern: tier's own
  // color drives the pill background, the brand-supplied icon emoji
  // anchors it, and the multiplier shows next to the wordmark. Keeps the
  // compact pill size (not a card) so the hero stays tight.
  const tierColor = tier?.tier_color ?? "#1A0200";
  const tierIcon  = tier?.tier_icon  ?? "★";
  const tierMul   = tier?.tier_multiplier ?? 1;
  const tierBg    = hexWithAlpha(tierColor, 0.16);
  const tierFg    = tierColor;

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

        {/* Right — tier badge + streak */}
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              router.push("/tier-benefits" as never);
            }}
            className="flex-row items-center active:opacity-80"
            style={{
              paddingHorizontal: 9,
              paddingVertical: 4,
              borderRadius: 100,
              backgroundColor: tierBg,
              borderWidth: 1,
              borderColor: hexWithAlpha(tierColor, 0.28),
              gap: 5,
            }}
          >
            <Text style={{ fontSize: 11 }}>{tierIcon}</Text>
            <Text
              style={{
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 10,
                color: tierFg,
                letterSpacing: 1.2,
                textTransform: "uppercase",
              }}
            >
              {tierDisplayName}
            </Text>
            {tierMul > 1 && (
              <Text
                style={{
                  fontFamily: "SpaceGrotesk_700Bold",
                  fontSize: 10,
                  color: hexWithAlpha(tierColor, 0.7),
                  marginLeft: -2,
                }}
              >
                · {formatMul(tierMul)}×
              </Text>
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
            fontSize: 13,
            color: active ? "#1A0200" : "#6B6B6B",
          }}
        >
          {label}
        </Text>
        {badge !== undefined && badge > 0 && (
          <View
            style={{
              minWidth: 16,
              height: 14,
              paddingHorizontal: 5,
              borderRadius: 8,
              backgroundColor: "#C05040",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 9,
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

// ─── Tab: Vouchers ──────────────────────────────────────────────────

function VouchersTab({
  vouchers, claimables, loading,
}: {
  vouchers: Awaited<ReturnType<typeof fetchMyVouchers>>;
  claimables: Awaited<ReturnType<typeof fetchClaimableVouchers>>;
  loading: boolean;
}) {
  const hasContent = vouchers.some((v) => v.status === "active") || claimables.length > 0;

  if (loading && !hasContent) {
    return (
      <View className="py-12 items-center">
        <CelsiusLoader size="md" />
      </View>
    );
  }

  if (!hasContent) {
    return (
      <View className="py-12 items-center">
        <Gift size={36} color="#C05040" strokeWidth={1.25} />
        <Text className="text-[15px] mt-3" style={{ color: "#1A0200", fontFamily: "Peachi-Bold" }}>
          No vouchers yet
        </Text>
        <Text
          className="text-[12px] text-center mt-1.5 max-w-xs"
          style={{ color: "#6B6B6B", fontFamily: "SpaceGrotesk_500Medium" }}
        >
          Complete a weekly challenge or watch for surprises after each order.
        </Text>
      </View>
    );
  }

  return (
    <>
      <ClaimableSection claimables={claimables} />
      <VoucherWallet vouchers={vouchers} maxVisible={20} hideViewAll />
    </>
  );
}

// ─── Tab: Catalog ───────────────────────────────────────────────────

function CatalogTab({
  tiers, tier, member, balance, rewards, sortedRewards, isLoading, tierDisplayName,
}: {
  tiers: TierLite[];
  tier: Awaited<ReturnType<typeof fetchTier>>;
  member: { totalVisits: number; totalPointsEarned: number } | null;
  balance: number;
  rewards: Reward[];
  sortedRewards: Reward[];
  isLoading: boolean;
  tierDisplayName: string;
}) {
  return (
    <>
      {/* Tier ladder carousel — kept on Catalog tab so it doesn't crowd
          the Challenges tab. Customers see "what tier am I, what's next"
          while browsing the redemption catalog. */}
      {tiers.length > 0 && (
        <View style={{ marginHorizontal: -16, marginTop: -8, marginBottom: 8 }}>
          <TierCardCarousel
            tiers={tiers}
            currentSlug={tier?.tier_slug ?? null}
            memberVisits={tier?.visits_this_period ?? 0}
            memberSpend={tier?.spend_this_period ?? 0}
            stats={{
              points: balance,
              visits: member?.totalVisits ?? 0,
              earned: member?.totalPointsEarned ?? balance,
            }}
            title="Membership tiers"
            onCardPress={() => {
              Haptics.selectionAsync();
              router.push("/tier-benefits" as never);
            }}
          />
        </View>
      )}

      {/* Tier perks */}
      {tier && tier.tier_benefits && tier.tier_benefits.length > 0 && (
        <View
          style={{
            marginTop: 8,
            marginBottom: 8,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "rgba(26,2,0,0.12)",
            padding: 14,
          }}
        >
          <Text
            style={{
              color: "rgba(26,2,0,0.55)",
              fontFamily: "SpaceGrotesk_700Bold",
              fontSize: 10,
              letterSpacing: 2.5,
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            {`${tierDisplayName} perks`}
          </Text>
          {tier.tier_benefits.map((b, i) => (
            <View
              key={i}
              style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 }}
            >
              <View
                style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: "#C05040" }}
              />
              <Text style={{ color: "#1A0200", fontFamily: "SpaceGrotesk_500Medium", fontSize: 14 }}>
                {b}
              </Text>
            </View>
          ))}
        </View>
      )}

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
              marginBottom: 8,
            }}
          >
            Spend your Beans
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

      {/* Coffee Wrapped — annual recap. Visible year-round but the link
          is most relevant in Dec/Jan when the recap actually has a story
          to tell. Lower placement so it doesn't crowd the main catalog. */}
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          router.push("/wrapped" as never);
        }}
        className="mt-5 active:opacity-80 rounded-2xl"
        style={{
          backgroundColor: "#1A0200",
          padding: 16,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: "rgba(251,191,36,0.18)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <SparklesIcon size={20} color="#FBBF24" strokeWidth={1.8} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: "Peachi-Bold", fontSize: 15, color: "#FBBF24" }}>
            Coffee Wrapped {new Date().getFullYear()}
          </Text>
          <Text
            style={{
              fontFamily: "SpaceGrotesk_500Medium",
              fontSize: 11,
              color: "rgba(255,255,255,0.65)",
              marginTop: 1,
            }}
          >
            Your year in coffee, recapped
          </Text>
        </View>
        <ChevronRight size={16} color="rgba(251,191,36,0.7)" strokeWidth={2} />
      </Pressable>
    </>
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
