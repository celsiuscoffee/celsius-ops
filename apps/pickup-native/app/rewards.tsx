import { useCallback, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, Image, Dimensions, RefreshControl } from "react-native";
import { Alert } from "@/lib/alert";
import { Stack, router } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Gift, ChevronRight, Clock, Lock } from "lucide-react-native";
import * as Haptics from "@/lib/haptics";
import { EspressoHeader } from "../components/EspressoHeader";
import { CelsiusLoader } from "../components/CelsiusLoader";
import { RewardsListSkeleton } from "../components/RewardsListSkeleton";
import { useApp, type AppliedReward } from "../lib/store";
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
  fetchActiveMissions,
  claimVoucher,
  voucherUrgencyLabel,
  type ActiveMission,
  type Voucher,
  type ClaimableVoucher,
} from "../lib/rewards-v2";
import {
  VoucherRow,
  pickRewardIcon,
  THEME_CHALLENGE,
  THEME_MYSTERY,
  THEME_GIFT,
  THEME_BEAN,
  type VoucherTheme,
} from "../components/VoucherWallet";
import {
  themeForTier,
  CardBackground,
  CelsiusWordmark,
  type TierLite,
} from "../components/TierCardCarousel";
import { CelsiusGift } from "../components/brand/CelsiusGift";

// Source filter for the "Yours" wallet. ONLY mystery-bag wins, manual admin
// grants, and birthday grants are wallet items. Mission vouchers live on their
// challenge card; bean-shop (points_redemption) and referral vouchers are NOT
// wallet items — points are a balance you spend, not a stored voucher. Keep in
// lockstep with the home rail (index.tsx), the count (lib/rewards-v2.ts), and
// @celsius/shared rewards-count.ts.
const WALLET_SOURCES: ReadonlyArray<Voucher["source_type"]> = [
  "mystery",
  "manual",
  "birthday",
];

function mapDiscountTypeForApply(
  t: NonNullable<Voucher["discount_type"]>,
): AppliedReward["discount_type"] {
  switch (t) {
    case "free_item":          return "free_item";
    case "flat":               return "flat";
    case "percent":            return "percent";
    case "beans_multiplier":   return "none";
    default:                    return "none";
  }
}

function catalogToVoucherCategory(r: Reward): Voucher["category"] {
  const dt = r.discount_type;
  if (dt === "free_item" || dt === "bogo") return "free_item";
  if (dt === "flat" || dt === "percent" || dt === "fixed_amount" || dt === "percentage") return "discount";
  const cat = (r as { category?: string }).category;
  if (cat === "upgrade") return "upgrade";
  if (cat === "multiplier") return "multiplier";
  return "special";
}

// Catalogue rewards (Spend Points) all live in the BEAN bucket — they
// share a single colourway so the customer reads "this is the bean-shop
// rail" at a glance. Different from the source-bucket logic of wallet
// vouchers / mystery / gift, which are typed by where they CAME FROM;
// catalogue items are typed by what they ARE (something you buy with
// beans). The unused suppress: marker keeps the type Reward import live
// for future kind-id overrides.
function themeForReward(_r: Reward): VoucherTheme {
  return THEME_BEAN;
}

function rewardCategoryLabel(r: Reward): string {
  const cat = (r as { category?: string }).category;
  if (cat === "free_item" || cat === "free_drink") return "Free Item";
  if (cat === "upgrade") return "Add-on";
  if (cat === "discount") return "Discount";
  if (cat === "multiplier") return "Boost";
  const dt = r.discount_type;
  if (dt === "free_item") return "Free Item";
  if (dt === "flat" || dt === "fixed_amount" || dt === "percent" || dt === "percentage") return "Discount";
  if (dt === "bogo") return "B1G1";
  return "Reward";
}

// Human-readable expiry for a mission's week_end_at. Cards reset every
// Monday so this almost always reads "Ends in 3d" / "Ends today" — the
// helper short-circuits anything past the boundary to a flat "Ended".
/** Days from now to an ISO timestamp. Rounds UP so today is "1 day"
 *  not "0 days" for the customer-facing copy. Returns null when the
 *  input is missing/unparseable or already past — caller drops the
 *  "in X days" clause in those cases. */
function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  const ms = t - Date.now();
  if (ms <= 0) return null;
  return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function formatMissionExpiry(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Ended";
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  if (days <= 1) return "Ends today";
  return `Ends in ${days}d`;
}

function compactProgressLabel(m: ActiveMission): string {
  const cur = m.progress_current;
  const tgt = m.goal_threshold;
  if (m.goal_type === "single_order_total_at_least") {
    return `RM${Math.floor(cur / 100)}/${Math.floor(tgt / 100)}`;
  }
  return `${cur}/${tgt}`;
}

// ─── Main screen ───────────────────────────────────────────────────────

export default function RewardsTab() {
  const phone = useApp((s) => s.phone);
  const loyaltyId = useApp((s) => s.loyaltyId);
  const setReservedVoucher = useApp((s) => s.setReservedVoucher);
  const setAppliedReward = useApp((s) => s.setAppliedReward);
  const qc = useQueryClient();
  const [claimedClaimableIds, setClaimedClaimableIds] = useState<Set<string>>(new Set());

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    Haptics.selectionAsync();
    try {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["rewards"] }),
        qc.invalidateQueries({ queryKey: ["tier"] }),
        qc.invalidateQueries({ queryKey: ["my-vouchers"] }),
        qc.invalidateQueries({ queryKey: ["claimable-vouchers"] }),
        qc.invalidateQueries({ queryKey: ["active-missions"] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [qc]);

  const rewardsQ = useQuery({
    queryKey: ["rewards", phone ?? "anonymous"],
    queryFn: () => fetchRewards(phone),
    staleTime: 5 * 60_000,
  });
  // Tier feeds the subtle progress line on the hero card — "Spend RM30
  // more to unlock Gold" / "Platinum · RM150 this quarter". Lazy fetch
  // so anonymous users get a plain beans-only hero.
  const tierQ = useQuery({
    // Same key as _layout.tsx prefetch + account.tsx + checkout.tsx
    // so the rewards screen reads from the prewarmed cache on tab
    // entry — no theme flash from the bronze fallback before the
    // real tier lands.
    queryKey: ["tier", loyaltyId],
    queryFn: () => (loyaltyId ? fetchTier(loyaltyId) : Promise.resolve(null)),
    enabled: !!loyaltyId,
    staleTime: 60_000,
  });
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
  const activeMissionsQ = useQuery({
    queryKey: ["active-missions", phone ?? "anon"],
    queryFn: fetchActiveMissions,
    enabled: !!phone,
    staleTime: 60_000,
  });

  const balance = rewardsQ.data?.pointsBalance ?? 0;
  const rewards = rewardsQ.data?.rewards ?? [];
  const vouchers = myVouchersQ.data ?? [];
  const claimables = claimableQ.data ?? [];
  const missions = activeMissionsQ.data ?? [];

  const walletVouchers = useMemo(
    () =>
      vouchers.filter(
        (v) =>
          v.status === "active" &&
          v.source_type !== "mission" &&
          WALLET_SOURCES.includes(v.source_type as Voucher["source_type"]),
      ),
    [vouchers],
  );

  const missionVoucherByAssignment = useMemo(() => {
    const m = new Map<string, Voucher>();
    for (const v of vouchers) {
      if (
        v.status === "active" &&
        v.source_type === "mission" &&
        v.source_ref_id
      ) {
        m.set(v.source_ref_id, v);
      }
    }
    return m;
  }, [vouchers]);

  const sortedRewards = useMemo(
    () =>
      [...rewards]
        .filter((r) => {
          const t = (r as { reward_type?: string | null }).reward_type;
          return t !== "birthday" && t !== "new_member";
        })
        .sort((a, b) => {
          const aAff = balance >= a.points_required ? 0 : 1;
          const bAff = balance >= b.points_required ? 0 : 1;
          if (aAff !== bAff) return aAff - bAff;
          return a.points_required - b.points_required;
        }),
    [rewards, balance],
  );

  // Challenge ordering — ACTIVE first (in-progress work the customer
  // can act on), then COMPLETED (ready to claim, but the customer
  // already saw the win), then EXPIRED (lowest priority — informational).
  // Previously completed missions were surfaced first which buried
  // active progress below "Done" cards the customer had already
  // consumed psychologically.
  const sortedMissions = useMemo(() => {
    const tier = (m: ActiveMission) =>
      m.status === "active" ? 0 : m.status === "completed" ? 1 : 2;
    return [...missions].sort((a, b) => tier(a) - tier(b));
  }, [missions]);

  const claimMutation = useMutation({
    mutationFn: (id: string) => claimVoucher(id),
    onSuccess: (_data, claimableId) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setClaimedClaimableIds((prev) => {
        const next = new Set(prev);
        next.add(claimableId);
        return next;
      });
      qc.invalidateQueries({ queryKey: ["my-vouchers"] });
      qc.invalidateQueries({ queryKey: ["claimable-vouchers"] });
    },
    onError: (e: unknown) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const message = e instanceof Error ? e.message : "Could not claim — try again in a moment.";
      Alert.alert("Couldn’t claim", message);
    },
  });

  function useWalletVoucher(v: Voucher) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setReservedVoucher({
      id: v.id,
      title: v.title,
      category: v.category,
      icon: v.icon,
      expires_at: v.expires_at,
    });
    setAppliedReward({
      id: v.id,
      name: v.title,
      points_required: 0,
      discount_type: v.discount_type ? mapDiscountTypeForApply(v.discount_type) : null,
      discount_value: v.discount_value ?? null,
      applicable_categories: v.applicable_categories ?? null,
      applicable_products: v.applicable_products ?? null,
      free_product_name: v.free_product_name ?? null,
      min_order_value: v.min_order_value ?? null,
      voucher_id: v.id,
    });
    router.push("/menu" as never);
  }

  function useCompletedChallenge(m: ActiveMission, linked: Voucher | null) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    trackEvent("challenge_use_tapped", {
      missionId: m.id,
      assignmentId: m.assignment_id,
      title: m.title,
      hasLinkedVoucher: !!linked,
    });
    if (!linked) {
      Alert.alert(
        "Reward not ready",
        "Your reward will land in your wallet shortly. Try again in a moment.",
        [{ text: "OK", style: "default" }],
      );
      return;
    }
    useWalletVoucher(linked);
  }

  function useCatalog(r: Reward) {
    Haptics.selectionAsync();
    Alert.alert(
      "Apply this reward?",
      `Use on your next order — ${r.points_required.toLocaleString()} Points deducted only when you check out.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Apply",
          style: "default",
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            trackEvent("reward_reserved", {
              rewardId: r.id,
              rewardName: r.name,
              pointsRequired: r.points_required,
            });
            setReservedVoucher({
              id: r.id,
              title: r.name,
              category: catalogToVoucherCategory(r),
              icon: "ticket",
              expires_at: null,
            });
            setAppliedReward({
              id: r.id,
              name: r.name,
              points_required: r.points_required,
              discount_type: r.discount_type,
              discount_value: r.discount_value,
              applicable_categories: r.applicable_categories ?? null,
              applicable_products: r.applicable_products ?? null,
              free_product_ids: r.free_product_ids ?? null,
              free_product_name: r.free_product_name ?? null,
              combo_price_sen: r.combo_price_sen ?? null,
              override_price_sen: r.override_price_sen ?? null,
              min_order_value: r.min_order_value ?? null,
              bogo_buy_qty: r.bogo_buy_qty,
              bogo_free_qty: r.bogo_free_qty,
            });
            router.push("/menu" as never);
          },
        },
      ],
    );
  }

  if (!phone) {
    return (
      <View className="flex-1 bg-background">
        <Stack.Screen options={{ headerShown: false }} />
        <EspressoHeader title="Rewards" showCart={false} />
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 160 }}
        >
          <SignInPrompt />
        </ScrollView>
      </View>
    );
  }

  const everythingLoading =
    rewardsQ.isLoading &&
    myVouchersQ.isLoading &&
    claimableQ.isLoading &&
    activeMissionsQ.isLoading;

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <EspressoHeader title="Rewards" showCart={false} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 160, gap: 22 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#A2492C"
            colors={["#A2492C"]}
          />
        }
      >
        <BeansHero
          balance={balance}
          tier={tierQ.data ?? null}
          tierLoading={!!loyaltyId && tierQ.isLoading && !tierQ.data}
        />

        {everythingLoading ? (
          // Skeleton list mirrors the real card anatomy so the user
          // sees "rewards are loading" instead of a centred spinner
          // that could mean anything. Eye lands on structure → faster
          // perceived load.
          <RewardsListSkeleton count={4} />
        ) : (
          // One continuous list, no section headers. Order: challenges
          // first (the active "work-for-it" bucket — most engagement),
          // then claim-now urgencies, then earned wallet vouchers, then
          // Spend Points catalog. Customer reads every card as the same
          // kind of thing — a reward they can use at checkout.
          <View style={{ gap: 8 }}>
            {sortedMissions.map((m) => (
              <ChallengeCard
                key={`mission-${m.assignment_id}`}
                mission={m}
                linkedVoucher={missionVoucherByAssignment.get(m.assignment_id) ?? null}
                onUse={() =>
                  useCompletedChallenge(
                    m,
                    missionVoucherByAssignment.get(m.assignment_id) ?? null,
                  )
                }
              />
            ))}

            {claimables.map((c) => (
              <ClaimableCard
                key={`claim-${c.id}`}
                claimable={c}
                claimed={claimedClaimableIds.has(c.id)}
                pending={claimMutation.isPending}
                onClaim={() => claimMutation.mutate(c.id)}
              />
            ))}

            {walletVouchers.map((v) => (
              <VoucherRow key={`voucher-${v.id}`} voucher={v} />
            ))}

            {sortedRewards.map((r) => (
              <CatalogCard
                key={`catalog-${r.id}`}
                reward={r}
                balance={balance}
                onUse={() => useCatalog(r)}
              />
            ))}
          </View>
        )}
      </ScrollView>

    </View>
  );
}

// ─── Points hero ────────────────────────────────────────────────────────

function BeansHero({
  balance,
  tier,
  tierLoading,
}: {
  balance: number;
  tier: MemberTier | null;
  /** True while the customer is signed in but the tier query hasn't
   *  returned yet AND we have no cached data. Drives the neutral
   *  placeholder card below — prevents the bronze fallback theme
   *  from flashing on tab entry. Anonymous users (no loyaltyId) stay
   *  on the bronze theme since they don't have a tier yet. */
  tierLoading?: boolean;
}) {
  // Neutral loading placeholder — same dimensions as the final card
  // so layout doesn't shift, plain espresso bg so we don't claim a
  // tier visually until we actually know which tier the customer is
  // on. Renders only on the rare cache-miss path (e.g. first ever
  // launch); _layout.tsx prefetches the tier so most navigations
  // skip this branch and render the themed card on first paint.
  if (tierLoading) {
    return (
      <View
        style={{
          height: 110,
          borderRadius: 18,
          backgroundColor: "#1A0200",
          paddingHorizontal: 14,
          paddingVertical: 14,
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
          shadowColor: "#000",
          shadowOpacity: 0.12,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 3,
        }}
      >
        <View>
          <Text
            style={{
              fontFamily: "SpaceGrotesk_700Bold",
              fontSize: 9.5,
              color: "rgba(255,245,225,0.55)",
              letterSpacing: 1.4,
              textTransform: "uppercase",
            }}
          >
            Points
          </Text>
          <Text
            style={{
              fontFamily: "Peachi-Bold",
              fontSize: 28,
              color: "#FBBF24",
              letterSpacing: -0.6,
              lineHeight: 32,
              marginTop: 2,
            }}
          >
            {balance.toLocaleString()}
          </Text>
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <CelsiusLoader size="sm" />
        </View>
      </View>
    );
  }
  // Tier-themed hero — same gradient + brand wordmark + pattern as the
  // membership tier cards on the Account screen, but stripped down to
  // the POINTS AVAILABLE number + progress line. Size unchanged from
  // the previous flat espresso card so this slots in without affecting
  // surrounding layout. Falls back to the Member (bronze) theme when
  // there's no tier yet so the card never renders bare.
  const tierLite: TierLite = {
    id:                   tier?.tier_id ?? "fallback-bronze",
    slug:                 tier?.tier_slug ?? "bronze",
    name:                 tier?.tier_name ?? "Member",
    min_visits:           0,
    min_spend:            0,
    multiplier:           tier?.tier_multiplier ?? 1,
    color:                tier?.tier_color ?? null,
    icon:                 tier?.tier_icon ?? null,
    benefits:             null,
    benefit_rules:        null,
    qualification_metric: null,
    sort_order:           null,
    discount_percent:     tier?.tier_discount_percent ?? 0,
    invitation_only:      tier?.tier_invitation_only ?? false,
  };
  const theme = themeForTier(tierLite);
  // All three dark-bg tiers need the gold accent ink for the beans
  // number — earlier code only flagged Platinum (elite), so Black
  // Card and Staff customers saw the espresso fallback ink (#1A0200)
  // on their already-dark card and the number disappeared into the
  // background. Catching all three slugs here.
  const isDark =
    tierLite.slug === "elite" ||
    tierLite.slug === "black-card" ||
    tierLite.slug === "arba-staff";

  const nextName = tier?.next_tier_name ?? null;
  const spendToNext = Math.max(0, tier?.spend_to_next_tier ?? 0);
  const nextMin = Math.max(0, tier?.next_tier_min_spend ?? 0);
  const spent = Math.max(0, tier?.spend_this_period ?? 0);
  const daysLeft = daysUntil(tier?.quarter_end ?? null);

  let progressLine: { text: string; ratio: number | null } | null = null;
  if (nextName && spendToNext > 0 && nextMin > 0) {
    const ratio = Math.max(0, Math.min(1, spent / nextMin));
    const window =
      daysLeft != null && daysLeft > 0
        ? ` in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`
        : "";
    progressLine = {
      text: `Spend RM${Math.round(spendToNext)}${window} to unlock ${nextName}`,
      ratio,
    };
  }

  // Card width matches the rewards screen padding (16px on each side)
  // so the wordmark + pattern SVG sizes correctly. Height matches the
  // ChallengeCard's typical render so the hero reads as the same
  // card family stacked above the challenge list — no visual
  // outlier. ChallengeCard is content-sized (padding 14/14 + 5 text
  // rows ≈ 110), so this picks 110 explicitly.
  const cardW = Dimensions.get("window").width - 32;
  const cardH = 110;

  return (
    <View
      style={{
        height: cardH,
        borderRadius: 18,
        overflow: "hidden",
        shadowColor: "#000",
        shadowOpacity: 0.12,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
      }}
    >
      <CardBackground theme={theme} width={cardW} height={cardH} />
      <CelsiusWordmark theme={theme} cardHeight={cardH} />

      <View
        style={{
          paddingHorizontal: 14,
          paddingVertical: 14,
          height: "100%",
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
        }}
      >
        {/* Left: eyebrow + big balance — vertically stacked so the
            number is the protagonist. Sized to mirror ChallengeCard's
            title weight without crowding the smaller card. */}
        <View style={{ flexShrink: 0 }}>
          <Text
            style={{
              fontFamily: "SpaceGrotesk_700Bold",
              fontSize: 9.5,
              color: theme.subtle,
              letterSpacing: 1.4,
              textTransform: "uppercase",
            }}
          >
            Points
          </Text>
          <Text
            style={{
              fontFamily: "Peachi-Bold",
              fontSize: 28,
              // High-contrast espresso ink on every light tier theme
              // (Member / Silver / Gold) so the number reads cleanly
              // against the gradient + wordmark watermark behind it.
              // Dark themes flip to the gold accent for the same
              // reason. Earlier draft used theme.accentDeep which was
              // close-enough in hue to the wordmark to read as
              // "smudged out" against the cream bronze gradient.
              color: isDark ? theme.accent : "#1A0200",
              letterSpacing: -0.6,
              lineHeight: 32,
              marginTop: 2,
            }}
          >
            {balance.toLocaleString()}
          </Text>
        </View>

        {/* Right: tier-progress + thin bar. Hidden when there's no
            next earned tier (i.e. customer already at top). */}
        {progressLine ? (
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontFamily: "SpaceGrotesk_500Medium",
                fontSize: 12,
                color: theme.subtle,
                lineHeight: 16,
              }}
              numberOfLines={2}
            >
              {progressLine.text}
            </Text>
            {progressLine.ratio != null ? (
              <View
                style={{
                  marginTop: 6,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: isDark ? "rgba(232,199,102,0.22)" : "rgba(0,0,0,0.10)",
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    width: `${Math.round(progressLine.ratio * 100)}%`,
                    height: "100%",
                    backgroundColor: theme.accent,
                    borderRadius: 2,
                  }}
                />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ─── Compact challenge card ────────────────────────────────────────────
// Same single-row anatomy as the wallet VoucherRow / catalogue card:
//   [ icon ]  EYEBROW
//              Title
//              Subline
//                                            [ Use ] or progress text
// Espresso bg with gold accent so it reads as the same card family as
// a Free Drink / Free Pastry voucher.

function ChallengeCard({
  mission,
  linkedVoucher,
  onUse,
}: {
  mission: ActiveMission;
  linkedVoucher: Voucher | null;
  onUse: () => void;
}) {
  const isCompleted = mission.status === "completed";
  const isExpired = mission.status === "expired";
  const isActive = mission.status === "active";
  const displayedReward = linkedVoucher?.title ?? mission.reward_summary;
  // Challenges always render in the CHALLENGE bucket regardless of what
  // reward they'll pay out — the card answers "what work is in front of
  // me?" not "what kind of reward will I get?". Reward kind is conveyed
  // via the icon + the reward callout text inside the card.
  const theme = THEME_CHALLENGE;
  const Icon = pickRewardIcon(displayedReward);

  // Card-level Pressable routes to the challenge detail screen for
  // every state. Lets a customer tap the card to read the rules,
  // see full progress and the reward callout — even after they've
  // missed it. The inner USE pill keeps its own onPress and stops
  // propagation so completed-state taps fall through to checkout
  // rather than the detail page.
  const handleOpenDetail = () => {
    // Cast to bypass stale typed-routes — expo-router regenerates the
    // router.d.ts union on the next `expo start`, after which the cast
    // becomes a no-op. The runtime href format is correct.
    router.push(`/challenge/${mission.assignment_id}` as never);
  };

  return (
    <Pressable
      onPress={handleOpenDetail}
      className="active:opacity-90"
      style={{
        borderRadius: 18,
        overflow: "hidden",
        backgroundColor: theme.bg,
        borderWidth: 1,
        borderColor: isCompleted ? theme.accent : theme.bg,
        opacity: isExpired ? 0.45 : 1,
        shadowColor: "#000",
        shadowOpacity: 0.12,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
      }}
    >
      <View style={{ position: "absolute", right: -10, bottom: -16, opacity: 0.12 }}>
        <CelsiusGift size={120} color={theme.iconColor} />
      </View>

      <View
        style={{
          paddingHorizontal: 14,
          paddingVertical: 14,
          flexDirection: "row",
          alignItems: "flex-start",
          gap: 14,
        }}
      >
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
            numberOfLines={1}
          >
            Challenge
            {isCompleted ? " · Done" : isExpired ? " · Missed" : ""}
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
            {mission.title}
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
            {mission.description}
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              marginTop: 8,
            }}
          >
            <Gift size={15} color={theme.accent} strokeWidth={2.2} />
            <Text
              style={{
                fontFamily: "Peachi-Bold",
                fontSize: 15,
                color: theme.accent,
                letterSpacing: -0.1,
                lineHeight: 19,
              }}
              numberOfLines={1}
            >
              {isCompleted ? `${displayedReward} — ready` : displayedReward}
            </Text>
          </View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              marginTop: 6,
            }}
          >
            <Clock size={11} color="rgba(255,255,255,0.50)" strokeWidth={2} />
            <Text
              style={{
                fontFamily: "SpaceGrotesk_500Medium",
                fontSize: 11,
                color: "rgba(255,255,255,0.50)",
              }}
              numberOfLines={1}
            >
              {formatMissionExpiry(mission.week_end_at)}
            </Text>
          </View>
        </View>

        {isCompleted ? (
          <Pressable
            // RN's gesture responder system gives the inner Pressable the
            // touch by default — the outer card Pressable doesn't fire
            // when this pill is tapped. The `stopPropagation?.()` is
            // defensive in case a future RN version surfaces a real
            // event with bubble semantics.
            onPress={(e) => {
              e.stopPropagation?.();
              onUse();
            }}
            hitSlop={8}
            className="active:opacity-85"
            style={{
              backgroundColor: theme.accent,
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 999,
              flexDirection: "row",
              alignItems: "center",
              gap: 3,
              // Vertically center against the description+reward stack
              // rather than pinning to the top edge — the pill is short
              // enough that flex-start makes it visually disconnected
              // from the rest of the card body.
              alignSelf: "center",
            }}
          >
            <Text
              style={{
                color: "#1A0200",
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 11,
                letterSpacing: 0.8,
                textTransform: "uppercase",
              }}
            >
              Use
            </Text>
            <ChevronRight size={11} color="#1A0200" strokeWidth={2.4} />
          </Pressable>
        ) : isActive ? (
          <View style={{ alignItems: "flex-end", marginTop: 6 }}>
            <Text
              style={{
                color: theme.accent,
                fontFamily: "Peachi-Bold",
                fontSize: 17,
                lineHeight: 19,
              }}
            >
              {compactProgressLabel(mission)}
            </Text>
            <Text
              style={{
                color: "rgba(251,191,36,0.65)",
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 9,
                letterSpacing: 0.8,
                marginTop: 1,
              }}
            >
              PROGRESS
            </Text>
            {/* Locked equivalent of the USE pill — same shape + size so
                the two states sit on the same visual grid, but blurred
                back to ~40% opacity and stripped of the chevron so the
                customer reads "this is the Use slot, just gated". */}
            <View
              style={{
                marginTop: 8,
                backgroundColor: theme.accent,
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 999,
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                opacity: 0.35,
              }}
            >
              <Lock size={10} color="#1A0200" strokeWidth={2.6} />
              <Text
                style={{
                  color: "#1A0200",
                  fontFamily: "SpaceGrotesk_700Bold",
                  fontSize: 10,
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                }}
              >
                Locked
              </Text>
            </View>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

// ─── Catalogue card (Spend Points) ──────────────────────────────────────
// Mirror image of VoucherRow but for points-shop catalogue entries.
// Same single-row shape, themed colours per discount type — RM5/RM10
// (terracotta) read as the same card family as a wallet RM5 voucher,
// Free Drink (espresso + gold) matches a Free Drink wallet voucher.

function CatalogCard({
  reward,
  balance,
  onUse,
}: {
  reward: Reward;
  balance: number;
  onUse: () => void;
}) {
  const required = reward.points_required;
  const canUse = balance >= required;
  const theme = themeForReward(reward);
  const categoryLabel = rewardCategoryLabel(reward);
  const urgency = canUse ? rewardUrgencyLabel(reward) : null;
  const Icon = pickRewardIcon(reward.name);

  const useFgIsLight =
    theme.accent === "#FBBF24" ||
    theme.accent === "#FFFFFF" ||
    theme.accent === "#D99404";
  const pillFg = useFgIsLight ? "#1A0200" : "#FFFFFF";
  const pillBg = canUse ? theme.accent : "rgba(255,255,255,0.18)";

  return (
    <Pressable
      onPress={canUse ? onUse : undefined}
      disabled={!canUse}
      // Whole card pressable — mirrors VoucherRow so customers can tap
      // anywhere on the row to redeem, not just the small pill. When
      // the customer hasn't earned enough Points yet the card is inert
      // (disabled) so a stray tap doesn't trigger a haptic / nothing.
      className={canUse ? "active:opacity-90" : ""}
      style={{
        borderRadius: 18,
        overflow: "hidden",
        backgroundColor: theme.bg,
        borderWidth: 1,
        borderColor: theme.border,
        opacity: canUse ? 1 : 0.78,
        shadowColor: "#000",
        shadowOpacity: 0.12,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
      }}
    >
      <View
        style={{
          position: "absolute",
          right: -10,
          bottom: -16,
          opacity: 0.12,
        }}
      >
        {theme.iconKind === "brand" && theme.brandIcon ? (
          <theme.brandIcon size={120} color={theme.iconColor} />
        ) : theme.glyphIcon ? (
          <theme.glyphIcon size={120} color={theme.iconColor} />
        ) : null}
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
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            backgroundColor: theme.iconBg,
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {reward.image_url ? (
            <Image
              source={{ uri: reward.image_url }}
              style={{ width: 40, height: 40 }}
              resizeMode="contain"
            />
          ) : (
            <Icon size={24} color={theme.iconColor} strokeWidth={2} />
          )}
        </View>

        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 3 }}>
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
            {canUse
              ? formatRewardValue(reward)
              : `${(required - balance).toLocaleString()} Points to go`}
          </Text>
        </View>

        <Pressable
          // Inner pill stays a Pressable so it gets its own active-press
          // feedback (slightly different opacity than the outer card) —
          // matches VoucherRow's pattern. Both onPress handlers fire the
          // same onUse; defensive stopPropagation in case RN ever
          // surfaces a real bubble.
          onPress={
            canUse
              ? (e) => {
                  e.stopPropagation?.();
                  onUse();
                }
              : undefined
          }
          disabled={!canUse}
          hitSlop={8}
          className="active:opacity-85"
          style={{
            backgroundColor: pillBg,
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 999,
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
          }}
        >
          <Text
            style={{
              color: canUse ? pillFg : "rgba(255,255,255,0.65)",
              fontFamily: "SpaceGrotesk_700Bold",
              fontSize: 11,
              letterSpacing: 0.8,
              textTransform: "uppercase",
            }}
          >
            {canUse ? `Use · ${required.toLocaleString()}` : `${required.toLocaleString()}`}
          </Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

// ─── Claimable card (Claim now) ────────────────────────────────────────

function ClaimableCard({
  claimable,
  claimed,
  pending,
  onClaim,
}: {
  claimable: ClaimableVoucher;
  claimed: boolean;
  pending: boolean;
  onClaim: () => void;
}) {
  // Map claimable.source_type → source bucket. Mystery pending → mystery
  // bucket (the reveal is the whole point). Welcome / promo → gift
  // bucket (warm peach — these are gifts, not earnings).
  const theme: VoucherTheme =
    claimable.source_type === "mystery_pending" ? THEME_MYSTERY
    : claimable.source_type === "welcome"       ? THEME_GIFT
    : THEME_GIFT;
  const Icon = pickRewardIcon(claimable.title, claimable.icon);
  const useFgIsLight =
    theme.accent === "#FBBF24" ||
    theme.accent === "#FFFFFF" ||
    theme.accent === "#D99404";
  const pillFg = useFgIsLight ? "#1A0200" : "#FFFFFF";

  const sourceLabel =
    claimable.source_type === "mystery_pending" ? "Mystery Bag"
      : claimable.source_type === "welcome" ? "Welcome Gift"
      : "Promo";

  return (
    <View
      style={{
        borderRadius: 18,
        overflow: "hidden",
        backgroundColor: theme.bg,
        borderWidth: 1,
        borderColor: theme.border,
        shadowColor: "#000",
        shadowOpacity: 0.12,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
      }}
    >
      <View style={{ position: "absolute", right: -10, bottom: -16, opacity: 0.12 }}>
        {theme.iconKind === "brand" && theme.brandIcon ? (
          <theme.brandIcon size={120} color={theme.iconColor} />
        ) : theme.glyphIcon ? (
          <theme.glyphIcon size={120} color={theme.iconColor} />
        ) : null}
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
            numberOfLines={1}
          >
            {sourceLabel}
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
            {claimable.title}
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
            {claimable.description}
          </Text>
        </View>

        <Pressable
          onPress={claimed || pending ? undefined : onClaim}
          disabled={claimed || pending}
          hitSlop={8}
          className="active:opacity-85"
          style={{
            backgroundColor: claimed ? "rgba(255,255,255,0.18)" : theme.accent,
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 999,
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
          }}
        >
          <Text
            style={{
              color: claimed ? "rgba(255,255,255,0.65)" : pillFg,
              fontFamily: "SpaceGrotesk_700Bold",
              fontSize: 11,
              letterSpacing: 0.8,
              textTransform: "uppercase",
            }}
          >
            {claimed
              ? "Claimed"
              : pending
                ? "Claiming…"
                : (claimable.cta_label ?? "Claim")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Sign-in prompt ────────────────────────────────────────────────────

function SignInPrompt() {
  return (
    <View className="px-6 pt-12 items-center">
      <View
        className="bg-primary/10 items-center justify-center mb-4"
        style={{ width: 72, height: 72, borderRadius: 36 }}
      >
        <Gift size={32} color="#A2492C" strokeWidth={1.5} />
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
