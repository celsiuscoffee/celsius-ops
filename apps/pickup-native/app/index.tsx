import { useCallback, useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { Platform, View, Text, Pressable, ScrollView, Image, RefreshControl } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { ChevronRight, Coffee, Sparkles, Gift, Clock4, ShoppingCart } from "lucide-react-native";
import * as Haptics from "@/lib/haptics";
import { supabase, type Outlet } from "../lib/supabase";
import { useApp, cartCount } from "../lib/store";
import { fetchMenu } from "../lib/menu";
import {
  fetchRecentItems,
  fetchOrderHistory,
  fetchRewards,
  // legacy points/tier helpers below; new wallet + missions come from
  // rewards-v2 (see import block below).
  fetchTier,
  rewardUrgencyLabel,
  type Reward,
  type OrderHistoryEntry,
  type MemberTier,
} from "../lib/rewards";
import {
  fetchMyVouchers,
  fetchClaimableVouchers,
  fetchActiveMissions,
  voucherUrgencyLabel,
  countRewardsWaiting,
  countAffordableRewards,
  type Voucher,
} from "../lib/rewards-v2";
import { CelsiusCup } from "../components/brand/CelsiusCup";
import { CelsiusGift } from "../components/brand/CelsiusGift";
import { CelsiusTag } from "../components/brand/CelsiusTag";
import { themeForVoucher, THEME_BEAN, type VoucherTheme } from "../components/VoucherWallet";
import { SafeBoundary } from "../components/SafeBoundary";
import { TierHero } from "../components/TierHero";
import { PosterCarousel } from "../components/PosterCarousel";
import { getHomePosters, type HomePoster } from "../lib/posters";
import { tierStyle } from "../lib/tier-styles";
import { getSetting } from "../lib/settings";
import { AddToHomeHint } from "../components/AddToHomeHint";
import { HomeOrderMode } from "../components/HomeOrderMode";
import { formatPrice } from "../lib/api";
import { useSafeAreaInsets } from "react-native-safe-area-context";

async function fetchOutlets(): Promise<Outlet[]> {
  const { data, error } = await supabase
    .from("outlet_settings")
    .select("store_id,name,address,lat,lng,is_open,is_busy,pickup_time_mins")
    .eq("is_active", true)
    .order("store_id", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Home's scroll topology differs by platform — and deliberately so.
 *
 * NATIVE (the iOS/Android app): the hero poster + outlet picker are
 * FROZEN. They sit OUTSIDE the scroll view and never move; only the
 * content beneath them scrolls. This is the long-standing native feel.
 *
 * WEB (the order.celsiuscoffee.com PWA): the whole page scrolls as one,
 * hero included. A mobile browser's viewport is shorter (iOS Safari's
 * URL bar eats ~120px) and a frozen hero left too little scrollable
 * strip — the page felt un-scrollable (#152).
 *
 * #152 unified both onto the web behaviour, which leaked the scrolling
 * hero onto native. To keep both behaviours from ONE markup tree without
 * duplicating ~840 lines, the scroll boundary is expressed as two
 * wrappers. Exactly one is a real ScrollView per platform; the other is
 * a transparent passthrough:
 *
 *   web    → HomeScrollFrame = ScrollView (hero + body) | HomeBodyScroll = passthrough
 *   native → HomeScrollFrame = passthrough             | HomeBodyScroll = ScrollView (body only)
 *
 * Both receive the same `scrollProps` (refreshControl + bottom padding);
 * the passthrough ignores them. Defined at module scope so their identity
 * is stable across renders (no remount / lost scroll position).
 */
type HomeScrollProps = {
  scrollProps: ComponentProps<typeof ScrollView>;
  children: ReactNode;
};

/** Outer frame — ScrollView on web (hero scrolls with the page), a
 *  passthrough on native (hero stays frozen above the scroll). */
function HomeScrollFrame({ scrollProps, children }: HomeScrollProps) {
  if (Platform.OS === "web") return <ScrollView {...scrollProps}>{children}</ScrollView>;
  return <>{children}</>;
}

/** Body scroller — a passthrough on web (the outer frame already scrolls),
 *  a ScrollView on native (only the content below the frozen hero moves). */
function HomeBodyScroll({ scrollProps, children }: HomeScrollProps) {
  if (Platform.OS === "web") return <>{children}</>;
  return <ScrollView {...scrollProps}>{children}</ScrollView>;
}

export default function Home() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const outlets = useQuery({ queryKey: ["outlets"], queryFn: fetchOutlets });
  const outletId = useApp((s) => s.outletId);
  const outletName = useApp((s) => s.outletName);
  const menu = useQuery({
    queryKey: ["menu", outletId],
    queryFn: () => fetchMenu(outletId),
  });
  const cart = useApp((s) => s.cart);
  const setOutlet = useApp((s) => s.setOutlet);
  const member = useApp((s) => s.member);
  const phone = useApp((s) => s.phone);
  const loyaltyId = useApp((s) => s.loyaltyId);
  // addToCart/clearCart used to live here for the home reorder
  // affordance; now that lives only on the Orders tab.
  const [refreshing, setRefreshing] = useState(false);
  const [tier, setTier] = useState<MemberTier | null>(null);

  useEffect(() => {
    if (!loyaltyId) {
      setTier(null);
      return;
    }
    fetchTier(loyaltyId)
      .then((t) => {
        try {
          console.warn("[home] tier payload", JSON.stringify(t));
        } catch {}
        setTier(t);
      })
      .catch((e) => {
        console.warn("[home] tier fetch failed", e?.message ?? String(e));
        setTier(null);
      });
  }, [loyaltyId]);

  // "Your usual" — top 3 most-ordered products. Only fires for signed-in
  // customers; returns empty for first-time users.
  const recent = useQuery({
    queryKey: ["recent-items", phone],
    queryFn: () => (phone ? fetchRecentItems(phone, 8) : Promise.resolve([])),
    enabled: !!phone,
    staleTime: 60_000,
  });

  // Active orders — pulled from full order history, filtered to in-progress
  // statuses. Polled every 30s while the screen is mounted so the banner
  // updates without manual refresh.
  const orders = useQuery({
    queryKey: ["order-history-home", phone],
    queryFn: () => (phone ? fetchOrderHistory(phone, 5) : Promise.resolve([])),
    enabled: !!phone,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const activeOrder = (() => {
    const list = orders.data ?? [];
    const ACTIVE = new Set(["pending", "paid", "preparing", "ready"]);
    const STALE_PENDING_MS = 10 * 60 * 1000;
    return list.find((o: OrderHistoryEntry) => {
      const s = (o.status ?? "").toLowerCase();
      if (!ACTIVE.has(s)) return false;
      if (s === "pending") {
        const age = Date.now() - new Date(o.created_at).getTime();
        if (age > STALE_PENDING_MS) return false;
      }
      return true;
    });
  })();

  // Note: the "How was it? · Reorder #C-xxxx" home block was removed
  // alongside the For-you consolidation. Reorder still exists from the
  // Orders tab, so customers haven't lost the affordance — just no
  // longer surfaced on home where it competed with rewards / usual.

  // Rewards the customer can redeem right now with current points balance.
  const rewardsQ = useQuery({
    queryKey: ["rewards-home", phone],
    queryFn: () => fetchRewards(phone ?? null),
    staleTime: 60_000,
  });

  // New rewards-v2 wallet — earned vouchers + claimables. Gated on phone
  // so anonymous users skip the round-trip. Short staleTime so the home
  // hero stays in sync with the Rewards screen.
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

  // Home voucher rail — only WALLET-source vouchers (mystery-bag / manual /
  // birthday grants), matching the /rewards "Yours" wallet and the count.
  // Bean-shop (points_redemption) + referral are NOT wallet items. Keep in
  // lockstep with rewards.tsx WALLET_SOURCES + @celsius/shared.
  const walletVouchers = (myVouchersQ.data ?? []).filter(
    (v) =>
      v.status === "active" &&
      ["mystery", "manual", "birthday", "campaign"].includes(v.source_type ?? ""),
  );
  const claimables     = claimableQ.data ?? [];
  // Home rail surfaces only IN-PROGRESS missions (status === 'active').
  // Completed challenges already issue their voucher to the wallet,
  // so the home teaser focuses on what the customer still has to do.
  const activeMissions = activeMissionsQ.data ?? [];
  const inProgressMissions = activeMissions.filter((m) => m.status === "active");
  const activeMission = inProgressMissions[0] ?? null;
  // Prefer the LIVE rewards-query balance over the cached member.points
  // Balance — `member` is set once at sign-in and never refreshed, so on
  // a customer who's earned + redeemed since signing in it shows a stale
  // figure (e.g. 430 home / 4130 rewards mismatch shipped in earlier
  // screenshots). The store-cached value remains a soft fallback for the
  // brief window before the rewards query lands.
  const points = rewardsQ.data?.pointsBalance ?? member?.pointsBalance ?? 0;
  // Eligibility — active + affordable + valid date window + has stock +
  // pickup-capable + member hasn't hit max redemption. The server attaches
  // redemption_count, so this stays cheap on the client.
  const affordableRewards = (rewardsQ.data?.rewards ?? [])
    .filter((r: Reward) => {
      if (!r.is_active) return false;
      if (r.points_required > points) return false;
      const now = Date.now();
      if (r.valid_from && new Date(r.valid_from).getTime() > now) return false;
      if (r.valid_until && new Date(r.valid_until).getTime() < now) return false;
      if (r.stock != null && r.stock <= 0) return false;
      if (
        r.max_redemptions_per_member != null &&
        (r.redemption_count ?? 0) >= r.max_redemptions_per_member
      ) {
        return false;
      }
      const ft = r.fulfillment_type;
      if (Array.isArray(ft) && ft.length > 0 && !ft.includes("pickup")) return false;
      return true;
    })
    .slice(0, 6);

  // Use the shared util — also consumed by the rewards screen so the
  // urgency rules ("Ends in 2d", "Last one!") stay consistent.
  const urgencyLabel = rewardUrgencyLabel;

  // Cheapest reward they can't yet afford — used to show "X pts to <name>"
  // under the points pill so the loyalty loop has visible forward momentum.
  const nextReward = (() => {
    const unaffordable = (rewardsQ.data?.rewards ?? [])
      .filter((r: Reward) => r.is_active && r.points_required > points)
      .sort((a, b) => a.points_required - b.points_required);
    return unaffordable[0];
  })();
  const pointsToNext = nextReward ? Math.max(0, nextReward.points_required - points) : 0;
  const progressPct = nextReward
    ? Math.min(1, points / nextReward.points_required)
    : 0;

  // Resolve the live outlet record so the picker can show its open/busy
  // state and ETA (data we already pulled in fetchOutlets).
  const currentOutlet = (outlets.data ?? []).find((o) => o.store_id === outletId) ?? null;

  // Keep the displayed outlet name truthful to outletId — what the ORDER is
  // actually tagged with. The two can drift (e.g. a past table-QR scan left
  // outletId on another cafe while the stored name lagged), and the home is the
  // first place we have the outlets list to reconcile. Without this the app
  // could show "Putrajaya" while every order routed to Shah Alam.
  useEffect(() => {
    if (currentOutlet && currentOutlet.name && currentOutlet.name !== outletName) {
      useApp.getState().setOutletName(currentOutlet.name);
    }
  }, [currentOutlet, outletName]);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();
  const firstName = member?.name?.split(/\s+/)[0] ?? null;

  const featured = (menu.data?.products ?? [])
    .filter((p) => p.is_featured && p.is_available)
    .slice()
    .sort((a, b) =>
      (a.featured_position ?? 9999) - (b.featured_position ?? 9999)
      || a.name.localeCompare(b.name)
    )
    .slice(0, 6);

  const onOrderNow = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (cartCount(cart) > 0) router.push("/cart");
    else if (outletId) router.push("/menu");
    else router.push("/store");
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    Haptics.selectionAsync();
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["outlets"] }),
        queryClient.invalidateQueries({ queryKey: ["menu"] }),
        queryClient.invalidateQueries({ queryKey: ["recent-items", phone] }),
        queryClient.invalidateQueries({ queryKey: ["order-history-home", phone] }),
        queryClient.invalidateQueries({ queryKey: ["rewards-home", phone] }),
        queryClient.invalidateQueries({ queryKey: ["home-posters"] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient, phone]);

  // onPromoTap removed alongside the in-hero promo strip. The promo
  // setting still drives the empty-state hero copy further down; if we
  // ever bring back an inline promo CTA, restore the cta_target switch
  // from git (commit ffef593 has the last version).

  // Tier-driven palette — accents (chip color, dots, etc). Gradient
  // hero is gone; the poster carousel is now the visual anchor.
  const ts = tierStyle(tier);
  const showTierEyebrow = !!tier?.tier_slug;

  // Auto-rotating posters (Chagee-style). Short staleTime so a
  // poster change in backoffice surfaces in the app within ~30s
  // instead of waiting out a 5-min cache. AsyncStorage cache via
  // getHomePosters() still provides instant first paint on cold
  // launch; this just makes refresh aggressive.
  const postersQ = useQuery({
    queryKey: ["home-posters", loyaltyId],
    queryFn: () => getHomePosters(loyaltyId),
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const posters: HomePoster[] = postersQ.data ?? [];

  const heroBalance = rewardsQ.data?.pointsBalance ?? 0;
  // Rewards KPI on the home hero — counts everything waiting on the
  // /rewards screen: every active wallet voucher (incl bean-shop purchases)
  // PLUS claimables (unrevealed mystery / admin pushes). Uses the shared
  // tally (countRewardsWaiting, hand-synced from @celsius/shared) so the
  // hero, the nav badge, and the web PWA all agree. The /rewards screen
  // lists owned + claimable in one continuous list, so the hero sums both —
  // owned-only read LOWER than the list. Passes the RAW voucher list (not
  // the rail's bean-shop-filtered `walletVouchers`) so those count too.
  // Home "Rewards" KPI = wallet vouchers (mystery/manual/birthday) + claimables
  // + affordable redeemable catalogue items (points-shop rewards they can claim
  // right now). The unaffordable catalogue stays out — see countAffordableRewards.
  const voucherCount =
    countRewardsWaiting(myVouchersQ.data, claimables) +
    countAffordableRewards(rewardsQ.data?.rewards, points);

  // Shared scroll config handed to whichever wrapper owns the real
  // ScrollView on this platform (see HomeScrollFrame / HomeBodyScroll).
  // Native keeps the spacious pb-40; web trims to pb-32 (shorter
  // browser viewport — the floating cart bar + bottom nav clear 128px).
  const isWeb = Platform.OS === "web";
  const scrollProps: ComponentProps<typeof ScrollView> = {
    contentContainerClassName: isWeb ? "pb-32" : "pb-40",
    refreshControl: (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={onRefresh}
        tintColor="#A2492C"
        colors={["#A2492C"]}
      />
    ),
  };

  return (
    <View className="flex-1 bg-background">
      {/* One scrollable container for the whole home screen — hero,
          outlet row, and the rest below all scroll together. Previously
          only the bottom half (the section list inside an inner
          ScrollView) scrolled; the hero stayed frozen, which made the
          page feel uncscrollable in a mobile browser. The top-bar logo
          + cart icon is `position: absolute` and now scrolls with the
          page content (its containing block moved from this outer View
          to the ScrollView's content). */}
      <HomeScrollFrame scrollProps={scrollProps}>
      {/* Top bar — small wordmark + cart, sits over the poster top edge.
          Espresso ink against the cream backdrop on the carousel
          (posters generally have darker bottoms; the top is fine).
          Absolute-positioned over the carousel so the photo runs
          full-bleed to the status bar. */}
      <View
        style={{
          position: "absolute",
          top: insets.top + 8,
          left: 16,
          right: 16,
          zIndex: 5,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <Image
          source={require("../assets/icon.png")}
          style={{ width: 28, height: 28, borderRadius: 6 }}
          resizeMode="cover"
        />
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => router.push("/cart")}
          className="relative active:opacity-60"
          hitSlop={12}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: "rgba(255,255,255,0.92)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ShoppingCart size={18} color="#160800" />
          {cartCount(cart) > 0 && (
            <View
              className="absolute rounded-full items-center justify-center"
              style={{ top: -3, right: -3, width: 16, height: 16, backgroundColor: "#A2492C" }}
            >
              <Text
                className="text-[9px]"
                style={{ fontFamily: "Peachi-Bold", color: "#FFFFFF" }}
              >
                {cartCount(cart)}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* Hero — slightly portrait poster (~70% of a 3:4 box) with the
          info card overlaid at the bottom via absolute positioning.
          The photo fills the entire hero area; the card sits on top
          of the lower portion with mx-4 + rounded-2xl, and the photo
          continues behind it. No negative margins. Aspect (3/4)/0.7
          = ~1.07 — wider than 3:4 was, narrower than 4:3.
          Tweak this number to scale the hero up/down without touching
          card geometry. */}
      <View style={{ position: "relative" }}>
        {posters.length > 0 ? (
          <PosterCarousel posters={posters} aspect={(3 / 4) / 0.7} />
        ) : (
          <View style={{ height: insets.top + 320, backgroundColor: "#160800" }} />
        )}

        {/* Info card pinned to the bottom of the hero area. mx-4 from
            screen edges, ~16px from poster bottom. Tappable into
            Rewards. The photo extends behind it on left, right, and
            below thanks to the carousel's full-bleed coverage. */}
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            // Tier card on home is anchored on the voucher stat (gold
            // count when > 0), and the voucher rail below it is the
            // next visual unit — making the whole card land on the
            // Vouchers tab keeps that visual chain intact regardless of
            // where on the card the customer taps. Inner Points / Vouchers
            // stat Pressables still override for their specific tabs.
            router.push("/rewards?tab=vouchers" as never);
          }}
          style={{
            position: "absolute",
            left: 16,
            right: 16,
            bottom: 0,
            backgroundColor: "#160800",
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            paddingHorizontal: 16,
            paddingVertical: 11,
            shadowColor: "#000",
            shadowOpacity: 0.28,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 8 },
            elevation: 8,
          }}
        >
        <View className="flex-row items-center">
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              fontFamily: "Peachi-Bold",
              fontSize: 17,
              color: "#FFFFFF",
            }}
          >
            {firstName ? `Hi, ${firstName}.` : showTierEyebrow ? "Welcome." : `${greeting}.`}
          </Text>
          {/* Tier eyebrow removed — member detail (tier name, % off,
              quarterly progress, lock) lives on the Account tab now,
              consolidated into the MembershipCard there. Home stays
              focused on actionable rewards. */}
        </View>

        {/* KPI strip — Points and Vouchers split into their own pressables
            so each stat acts as a quick-jump into the matching tab on
            the rewards screen. Voucher count uses the gold accent
            (#FBBF24) when > 0 so a customer with a live voucher sees it
            pop. Tightened mt/pt for a thinner card. */}
        <View
          className="flex-row mt-2 pt-2"
          style={{ borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.10)" }}
        >
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              // Single Rewards tab now hosts everything — Points and
              // Vouchers stats both land there; the customer scrolls
              // to "Spend your Points" or "Yours" depending on intent.
              router.push("/rewards?tab=rewards" as never);
            }}
            hitSlop={6}
            className="flex-1 active:opacity-70"
          >
            <Text
              style={{
                fontFamily: "Peachi-Bold",
                fontSize: 18,
                color: "#FFFFFF",
              }}
            >
              {points.toLocaleString()}
            </Text>
            <Text
              style={{
                fontFamily: "SpaceGrotesk_500Medium",
                fontSize: 10,
                letterSpacing: 1.2,
                color: "rgba(255,255,255,0.55)",
                marginTop: 2,
                textTransform: "uppercase",
              }}
            >
              Points
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              router.push("/rewards?tab=vouchers" as never);
            }}
            hitSlop={6}
            className="flex-1 pl-4 active:opacity-70"
            style={{ borderLeftWidth: 1, borderLeftColor: "rgba(255,255,255,0.10)" }}
          >
            <Text
              style={{
                fontFamily: "Peachi-Bold",
                fontSize: 18,
                color: voucherCount > 0 ? "#FBBF24" : "#FFFFFF",
              }}
            >
              {voucherCount}
            </Text>
            <Text
              style={{
                fontFamily: "SpaceGrotesk_500Medium",
                fontSize: 10,
                letterSpacing: 1.2,
                color: "rgba(255,255,255,0.55)",
                marginTop: 2,
                textTransform: "uppercase",
              }}
            >
              Rewards
            </Text>
          </Pressable>
          <View className="items-end justify-center">
            <ChevronRight size={16} color="rgba(255,255,255,0.55)" />
          </View>
        </View>
      </Pressable>
      </View>

      {/* iOS Safari PWA install nudge. Renders only on iOS browsers
          that haven't already saved this to the home screen, and only
          once per browser profile (X dismisses it permanently). Sits
          between the hero and the outlet picker so it doesn't compete
          with the carousel but is high enough that customers actually
          see it. See components/AddToHomeHint.tsx for the why. */}
      <AddToHomeHint />

      {/* Order mode — the single Dine-In | Pickup entry. Replaces the old
          stray outlet row + "scan your table" button that pointed at
          different outlets and confused customers. Scanning a table flips the
          whole card to dine-in; only one context shows at a time. */}
      <HomeOrderMode
        outletStatus={
          currentOutlet
            ? !currentOutlet.is_open
              ? { color: "#EF4444", label: "Closed" }
              : currentOutlet.is_busy
                ? { color: "#F59E0B", label: "Busy" }
                : {
                    color: "#22C55E",
                    label: currentOutlet.pickup_time_mins
                      ? `~${currentOutlet.pickup_time_mins} min`
                      : "Open",
                  }
            : null
        }
      />

      {/* Everything below the frozen hero + outlet row. On native this
          is the ONLY scrolling region (hero stays put); on web it's a
          passthrough — the outer frame already scrolls. */}
      <HomeBodyScroll scrollProps={scrollProps}>
        {/* Guest sign-in CTA — surfaces FIRST for logged-out users so the
            membership ask lands the moment the app opens. Espresso panel
            with terracotta gift icon mirrors brand promo styling, so it
            visually outweighs everything below it without feeling foreign.
            Hidden once signed in. */}
        {!phone && (
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push("/account");
            }}
            className="mx-4 mt-4 bg-espresso rounded-2xl overflow-hidden active:opacity-90"
            style={{
              shadowColor: "#160800",
              shadowOpacity: 0.18,
              shadowRadius: 14,
              shadowOffset: { width: 0, height: 6 },
            }}
          >
            <View className="px-5 py-4 flex-row items-center gap-3">
              <View
                className="bg-primary items-center justify-center"
                style={{ width: 48, height: 48, borderRadius: 24 }}
              >
                <Gift size={24} color="#FFFFFF" strokeWidth={2} />
              </View>
              <View className="flex-1">
                <Text
                  className="text-amber-400 text-[10px] uppercase tracking-widest"
                  style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 2 }}
                >
                  Free to join
                </Text>
                <Text
                  className="text-white text-[17px] mt-0.5"
                  style={{ fontFamily: "Peachi-Bold" }}
                >
                  Become a member
                </Text>
                <Text
                  className="text-white/70 text-[12px] mt-0.5"
                  style={{ fontFamily: "SpaceGrotesk_500Medium" }}
                  numberOfLines={1}
                >
                  Earn points · unlock free drinks · members-only deals
                </Text>
              </View>
              <View className="bg-white rounded-full px-3.5 py-2 flex-row items-center gap-1">
                <Text
                  className="text-espresso text-[12px]"
                  style={{ fontFamily: "Peachi-Bold" }}
                >
                  Sign in
                </Text>
                <ChevronRight size={13} color="#1A0200" />
              </View>
            </View>
          </Pressable>
        )}

        {/* Active order tracker — sits above everything else when present.
            Tone follows the order status:
              ready/completed → green (success)
              pending/failed  → red (danger)
              everything else (paid, preparing) → yellow (warning, in-flight)
            so the customer's eye reads the meaning before the label.
            Order number stays espresso for high-contrast headline. */}
        {activeOrder && (() => {
          const s = (activeOrder.status ?? "").toLowerCase();
          const tone =
            s === "ready" || s === "completed"
              ? { fg: "#2E7D32", tint: "rgba(46,125,50,0.10)", border: "rgba(46,125,50,0.25)", chip: "rgba(46,125,50,0.15)" }
              : s === "pending" || s === "failed" || s === "cancelled"
                ? { fg: "#B91C1C", tint: "rgba(185,28,28,0.10)", border: "rgba(185,28,28,0.25)", chip: "rgba(185,28,28,0.15)" }
                : { fg: "#B45309", tint: "rgba(180,83,9,0.10)", border: "rgba(180,83,9,0.25)", chip: "rgba(180,83,9,0.15)" };
          return (
            <Pressable
              onPress={() => router.push({ pathname: "/order/[id]", params: { id: activeOrder.id } })}
              className="mx-4 mt-4 rounded-2xl active:opacity-85"
              style={{
                paddingHorizontal: 14,
                paddingVertical: 12,
                backgroundColor: tone.tint,
                borderWidth: 1,
                borderColor: tone.border,
              }}
            >
              <View className="flex-row items-center gap-3">
                <View
                  className="w-9 h-9 rounded-full items-center justify-center"
                  style={{ backgroundColor: tone.chip }}
                >
                  <Clock4 size={18} color={tone.fg} strokeWidth={2} />
                </View>
                <View className="flex-1">
                  <Text
                    className="text-[10px] uppercase tracking-widest"
                    style={{ fontFamily: "SpaceGrotesk_700Bold", color: tone.fg, letterSpacing: 1.5 }}
                  >
                    {statusLabel(activeOrder.status)}
                  </Text>
                  <Text
                    className="text-espresso text-[14px] mt-0.5"
                    style={{ fontFamily: "Peachi-Bold" }}
                    numberOfLines={1}
                  >
                    Order #{activeOrder.order_number}
                  </Text>
                </View>
                <ChevronRight size={16} color={tone.fg} />
              </View>
            </Pressable>
          );
        })()}

        {/* "How was it? · Reorder" home block removed — reorder now
            lives only on the Orders tab (where the customer expects to
            see past orders). Home stays focused on what's next. */}

        {/* Claimable peek — one-tap claim cards from rewards-v2.
            Surfaces freshly granted offers (welcome, promo, pending
            mystery). Drives the home → Rewards screen flow:
            tap → claim. Hidden if nothing's claimable. */}
        {phone && claimables.length > 0 && (
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              router.push("/rewards");
            }}
            className="mx-4 mt-5 active:opacity-80"
            style={{
              backgroundColor: "#FBEBE8",
              borderRadius: 16,
              padding: 14,
              flexDirection: "row",
              alignItems: "center",
              borderWidth: 1,
              borderColor: "rgba(162,73,44,0.25)",
              gap: 12,
            }}
            accessibilityRole="button"
            accessibilityLabel={`${claimables.length} reward${claimables.length === 1 ? "" : "s"} to claim`}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: "#A2492C",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Gift size={20} color="#FFFFFF" strokeWidth={1.8} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{ fontFamily: "Peachi-Bold", fontSize: 15, color: "#1A0200" }}
              >
                {claimables.length === 1
                  ? `${claimables[0].title} ready to claim`
                  : `${claimables.length} ready to claim`}
              </Text>
              <Text
                style={{
                  fontFamily: "SpaceGrotesk_500Medium",
                  fontSize: 11,
                  color: "#5A1F16",
                  marginTop: 1,
                }}
              >
                Tap to view in Rewards
              </Text>
            </View>
            <ChevronRight size={16} color="#5A1F16" strokeWidth={2.2} />
          </Pressable>
        )}

        {/* Active challenge teaser — surfaces ONE of the customer's 3
            weekly missions, preferring the still-in-progress one. The
            Rewards screen is now a single page (no tabs) so the
            deeplink target is just /rewards. The "pick this week's
            challenge" CTA is gone — missions auto-rotate, no picker. */}
        {activeMission && (
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              router.push("/rewards" as never);
            }}
            className="mt-5 mx-4 active:opacity-80 rounded-2xl flex-row items-center"
            style={{
              backgroundColor: "#1A0200",
              padding: 14,
              gap: 12,
              shadowColor: "#160800",
              shadowOpacity: 0.18,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 4 },
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
              <Sparkles size={20} color="#FBBF24" strokeWidth={1.8} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontFamily: "SpaceGrotesk_700Bold",
                  fontSize: 9.5,
                  letterSpacing: 1.4,
                  color: "#FBBF24",
                  textTransform: "uppercase",
                }}
                numberOfLines={1}
              >
                Active challenge · {
                  // `single_order_total_at_least` stores the threshold in
                  // sen (e.g. RM100 → 10000) — render it as Ringgit so
                  // the customer doesn't see a giant "0/10000" instead
                  // of "RM0/RM100". Matches the formatting compactProgressLabel
                  // uses on the rewards tab + the challenge detail page.
                  activeMission.goal_type === "single_order_total_at_least"
                    ? `RM${Math.floor(activeMission.progress_current / 100)}/RM${Math.floor(activeMission.goal_threshold / 100)}`
                    : `${activeMission.progress_current}/${activeMission.goal_threshold}`
                }
              </Text>
              <Text
                style={{
                  fontFamily: "Peachi-Bold",
                  fontSize: 15,
                  color: "#FFFFFF",
                  marginTop: 2,
                }}
                numberOfLines={1}
              >
                {activeMission.title}
              </Text>
              <Text
                style={{
                  fontFamily: "SpaceGrotesk_500Medium",
                  fontSize: 11,
                  color: "rgba(255,255,255,0.65)",
                  marginTop: 1,
                }}
                numberOfLines={1}
              >
                {activeMission.reward_summary}
              </Text>
            </View>
            <ChevronRight size={16} color="rgba(251,191,36,0.7)" strokeWidth={2} />
          </Pressable>
        )}

        {/* Available rewards — anything the customer can use right now,
            mixed into a single rail:
              · wallet vouchers (mystery / birthday / promo / referral)
              · challenge rewards (mission-source wallet vouchers)
              · redeemable Bean Points catalogue items they can afford
            Tickets cycle black / terracotta / yellow tones so the rail
            reads as a deck of distinct rewards. */}
        {(walletVouchers.length > 0 || affordableRewards.length > 0) && (
          <View className="mt-5">
            <View className="flex-row items-center justify-between mb-2 px-4">
              <Text
                className="text-espresso text-[18px]"
                style={{ fontFamily: "Peachi-Bold" }}
              >
                Available rewards
              </Text>
              <Pressable
                onPress={() => router.push("/rewards" as never)}
                className="flex-row items-center gap-0.5 active:opacity-70"
              >
                <Text className="text-primary text-xs font-bold">All</Text>
                <ChevronRight size={14} color="#A2492C" />
              </Pressable>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="gap-3 px-4"
            >
              {(() => {
                // Cap each subgroup independently before merging so the
                // rail doesn't lopside when one bucket is huge. Each
                // ticket pulls its colourway from the same source-bucket
                // theme the Rewards tab uses — Challenge=espresso+gold,
                // Mystery=yellow+espresso, Gift=peach+terracotta,
                // Bean=terracotta+gold — so wallet/home/rewards-tab read
                // as one visual system instead of three palettes.
                const vouchers = walletVouchers.slice(0, 6);
                const catalog  = affordableRewards.slice(0, 6);
                return (
                  <>
                    {vouchers.map((v) => (
                      <HomeVoucherTicket
                        key={`v-${v.id}`}
                        voucher={v}
                        onPress={() => router.push("/rewards" as never)}
                      />
                    ))}
                    {catalog.map((r) => (
                      <HomeCatalogTicket
                        key={`r-${r.id}`}
                        reward={r}
                        onPress={() => router.push("/rewards" as never)}
                      />
                    ))}
                  </>
                );
              })()}
            </ScrollView>
          </View>
        )}

        {/* Your usual — surfaces the customer's regular orders with
            a one-tap path into the menu's Usual tab. */}
        {phone && (recent.data?.length ?? 0) > 0 && (
          <View className="mt-5">
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                if (!outletId) router.push("/store");
                else router.push({ pathname: "/menu", params: { tab: "usual" } });
              }}
              className="flex-row items-center justify-between mb-2 px-4 active:opacity-70"
            >
              <Text
                className="text-espresso text-[18px]"
                style={{ fontFamily: "Peachi-Bold" }}
              >
                Your usual
              </Text>
              <View className="flex-row items-center gap-0.5">
                <Text className="text-primary text-xs font-bold">See all</Text>
                <ChevronRight size={14} color="#A2492C" />
              </View>
            </Pressable>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="gap-3 px-4"
            >
              {recent.data!.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => {
                    Haptics.selectionAsync();
                    if (!outletId) router.push("/store");
                    else router.push({ pathname: "/menu", params: { tab: "usual" } });
                  }}
                  className="w-44 bg-surface rounded-2xl border border-border overflow-hidden active:opacity-70"
                  style={{
                    shadowColor: "#000",
                    shadowOpacity: 0.06,
                    shadowRadius: 8,
                    shadowOffset: { width: 0, height: 3 },
                  }}
                >
                  <View className="aspect-[4/5] bg-primary/5">
                    {item.image_url ? (
                      <Image
                        source={{ uri: item.image_url }}
                        style={{ width: "100%", height: "100%" }}
                        resizeMode="cover"
                      />
                    ) : (
                      <View className="flex-1 items-center justify-center">
                        <Coffee size={32} color="#A2492C" strokeWidth={1.5} />
                      </View>
                    )}
                  </View>
                  <View className="p-3">
                    <Text
                      className="text-espresso text-[14px]"
                      style={{ fontFamily: "Peachi-Bold" }}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    <View className="flex-row items-center justify-between mt-2">
                      <Text
                        className="text-primary text-[16px]"
                        style={{ fontFamily: "Peachi-Bold" }}
                      >
                        {formatPrice(item.price)}
                      </Text>
                      <View
                        className="bg-espresso rounded-full items-center justify-center"
                        style={{ width: 28, height: 28 }}
                      >
                        <Text className="text-white text-base leading-none">+</Text>
                      </View>
                    </View>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {/* First-launch poster — replaces the small empty-state nudge
            when the home would otherwise be sparse (no orders, no
            promos, no rewards, no cart). Full-bleed espresso panel
            with brand poster typography ("Slow down. / Coffee is
            here.") to make a stronger first impression than a 3-line
            card. Same trigger conditions as the prior nudge. */}
        {!activeOrder &&
          !(phone && (recent.data?.length ?? 0) > 0) &&
          affordableRewards.length === 0 &&
          featured.length === 0 &&
          cartCount(cart) === 0 && (
            <Pressable
              onPress={onOrderNow}
              className="mx-4 mt-5 bg-espresso rounded-2xl overflow-hidden active:opacity-90"
              style={{
                shadowColor: "#160800",
                shadowOpacity: 0.18,
                shadowRadius: 14,
                shadowOffset: { width: 0, height: 6 },
              }}
              accessibilityRole="button"
              accessibilityLabel="Browse menu"
            >
              <View className="px-6 pt-7 pb-6">
                <View
                  className="bg-primary items-center justify-center mb-4"
                  style={{ width: 52, height: 52, borderRadius: 26 }}
                >
                  <Coffee size={26} color="#FFFFFF" strokeWidth={2} />
                </View>
                <Text
                  className="text-amber-400 text-[10px] uppercase"
                  style={{
                    fontFamily: "SpaceGrotesk_700Bold",
                    letterSpacing: 2,
                  }}
                >
                  Welcome to Celsius
                </Text>
                <Text
                  className="text-white text-[28px] mt-1"
                  style={{ fontFamily: "Peachi-Bold", lineHeight: 32 }}
                >
                  Slow down.{"\n"}Coffee is here.
                </Text>
                <Text
                  className="text-white/70 text-[13px] mt-2"
                  style={{
                    fontFamily: "SpaceGrotesk_500Medium",
                    lineHeight: 18,
                  }}
                >
                  Order ahead, skip the queue. Pick a stool — we'll have it ready.
                </Text>
                <View
                  className="bg-white rounded-full mt-5 self-start flex-row items-center gap-1.5"
                  style={{ paddingHorizontal: 18, paddingVertical: 10 }}
                >
                  <Text
                    className="text-espresso text-[13px]"
                    style={{ fontFamily: "Peachi-Bold" }}
                  >
                    See what's brewing
                  </Text>
                  <ChevronRight size={14} color="#1A0200" />
                </View>
              </View>
            </Pressable>
          )}

        {/* Best Sellers — discovery surface. Skeleton while menu
            loads, real cards once the data lands. */}
        {menu.isLoading && featured.length === 0 ? (
          <View className="px-4 mt-5">
            <View className="bg-surface/60 rounded-md mb-2" style={{ height: 16, width: 110 }} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3">
              {[0, 1, 2, 3].map((i) => (
                <View
                  key={i}
                  className="w-44 bg-surface rounded-2xl border border-border overflow-hidden"
                >
                  <View className="aspect-[4/5] bg-background" />
                  <View className="p-3 gap-2">
                    <View className="bg-background rounded-md" style={{ height: 12, width: "80%" }} />
                    <View className="bg-background rounded-md" style={{ height: 14, width: "40%" }} />
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}
        {featured.length > 0 && (
          <View className="px-4 mt-5">
            <View className="flex-row items-center justify-between mb-2">
              <Text
                className="text-espresso text-[18px]"
                style={{ fontFamily: "Peachi-Bold" }}
              >
                Best Sellers
              </Text>
              <Pressable
                onPress={() => {
                  if (!outletId) router.push("/store");
                  else router.push("/menu");
                }}
                className="flex-row items-center gap-0.5 active:opacity-70"
              >
                <Text className="text-primary text-xs font-bold">More</Text>
                <ChevronRight size={14} color="#A2492C" />
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3">
              {featured.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    if (!outletId) router.push("/store");
                    else router.push({ pathname: "/product/[id]", params: { id: p.id } });
                  }}
                  className="w-44 active:opacity-70"
                >
                  <View
                    className="bg-surface rounded-2xl overflow-hidden border border-border"
                    style={{
                      shadowColor: "#000",
                      shadowOpacity: 0.06,
                      shadowRadius: 8,
                      shadowOffset: { width: 0, height: 3 },
                    }}
                  >
                    <View className="aspect-[4/5] bg-background">
                      {p.image_url && (
                        <Image
                          source={{ uri: p.image_url }}
                          className="w-full h-full"
                          resizeMode="cover"
                        />
                      )}
                    </View>
                    <View className="p-3">
                      <Text
                        className="text-espresso text-[14px]"
                        style={{ fontFamily: "Peachi-Bold" }}
                        numberOfLines={1}
                      >
                        {p.name}
                      </Text>
                      <View className="flex-row items-center justify-between mt-2">
                        <Text
                          className="text-primary text-[16px]"
                          style={{ fontFamily: "Peachi-Bold" }}
                        >
                          {formatPrice(p.price)}
                        </Text>
                        <View
                          className="bg-espresso rounded-full items-center justify-center"
                          style={{ width: 28, height: 28 }}
                        >
                          <ChevronRight size={16} color="#FFFFFF" />
                        </View>
                      </View>
                    </View>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

      </HomeBodyScroll>
      </HomeScrollFrame>

      {/* The "View cart" pill that used to render here moved to
          _layout.tsx as <GlobalCartPill /> so it can react to path
          changes correctly — background-mounted screens on web don't
          refresh their usePathname() subscriptions, so leaving it here
          made it leak onto /cart / /checkout. */}

    </View>
  );
}


function statusLabel(status: string | null | undefined): string {
  switch ((status ?? "").toLowerCase()) {
    case "pending":
      return "Awaiting payment";
    case "paid":
      return "Payment confirmed";
    case "preparing":
      return "Being prepared";
    case "ready":
      return "Ready for pickup";
    default:
      return "In progress";
  }
}

/**
 * Consolidated personalisation strip on the home screen.
 *
 * One section header + tabbed sub-strip — replaces three previously-stacked
 * sections (Available rewards, Your usual, Best Sellers). Tabs visible
 * depend on data availability:
 *   - Logged out → only "Best Sellers"
 *   - Logged in, no usual yet → "Vouchers" (if any) + "Best Sellers"
 *   - Logged in regular → "Vouchers" + "Usual" + "Best Sellers"
 *
 * Default tab picks the most personal data the user has — vouchers first
 * (time-sensitive), then usual (retention), then best sellers (discovery).
 *
 * Tabs use a small-caps Space Grotesk eyebrow with a 2px terracotta
 * underline on active — matches the brand book's typographic-tab style
 * over UI-furniture buttons. Cards are unified to 160w × 4:5 across all
 * tabs so the strip's vertical rhythm doesn't jump on tab switch.
 */
type ForYouStripProps = {
  phone: string | null | undefined;
  outletId: string | null | undefined;
  rewards: Reward[];
  usual: Array<{ id: string; name: string; image_url: string | null; price: number; timesOrdered: number }>;
  featured: Array<{ id: string; name: string; image_url?: string | null; price: number }>;
  urgencyLabel: (r: Reward) => string | null;
  onRewardTap: (r: Reward) => void;
  onUsualTap: () => void;
  onFeaturedTap: (p: { id: string }) => void;
  onUsualSeeAll: () => void;
  onRewardsSeeAll: () => void;
  onFeaturedSeeAll: () => void;
};

type ForYouTab = "vouchers" | "usual" | "featured";

function ForYouStrip({
  phone,
  rewards,
  usual,
  featured,
  urgencyLabel,
  onRewardTap,
  onUsualTap,
  onFeaturedTap,
  onUsualSeeAll,
  onRewardsSeeAll,
  onFeaturedSeeAll,
}: ForYouStripProps) {
  const hasVouchers = rewards.length > 0;
  const hasUsual = !!phone && usual.length > 0;
  const hasFeatured = featured.length > 0;

  const visibleTabs: ForYouTab[] = [
    ...(hasVouchers ? (["vouchers"] as const) : []),
    ...(hasUsual ? (["usual"] as const) : []),
    ...(hasFeatured ? (["featured"] as const) : []),
  ];

  const defaultTab: ForYouTab = hasVouchers ? "vouchers" : hasUsual ? "usual" : "featured";
  const [active, setActive] = useState<ForYouTab>(defaultTab);

  // If the active tab is no longer visible (e.g. last voucher claimed),
  // fall back to the next available one without a flicker.
  useEffect(() => {
    if (!visibleTabs.includes(active) && visibleTabs.length > 0) {
      setActive(visibleTabs[0]);
    }
  }, [active, visibleTabs]);

  if (visibleTabs.length === 0) return null;

  const onSeeAll = () => {
    Haptics.selectionAsync();
    if (active === "vouchers") onRewardsSeeAll();
    else if (active === "usual") onUsualSeeAll();
    else onFeaturedSeeAll();
  };

  return (
    <View className="mt-5">
      {/* Section header — single title + tab pills + see-all */}
      <View className="px-4">
        <View className="flex-row items-baseline justify-between mb-2">
          <Text
            className="text-espresso text-[18px]"
            style={{ fontFamily: "Peachi-Bold" }}
          >
            For you
          </Text>
          <Pressable
            onPress={onSeeAll}
            hitSlop={12}
            className="flex-row items-center gap-0.5 active:opacity-70"
          >
            <Text className="text-primary text-[12px]" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>
              See all
            </Text>
            <ChevronRight size={13} color="#A2492C" />
          </Pressable>
        </View>
        <View className="flex-row gap-5">
          {visibleTabs.map((t) => {
            const isActive = active === t;
            const label = t === "vouchers" ? "Rewards" : t === "usual" ? "Usual" : "Best sellers";
            const badge = t === "vouchers" ? rewards.length : t === "usual" ? usual.length : null;
            return (
              <Pressable
                key={t}
                onPress={() => {
                  Haptics.selectionAsync();
                  setActive(t);
                }}
                hitSlop={12}
                className="active:opacity-70"
              >
                <View style={{ paddingBottom: 6, borderBottomWidth: 2, borderBottomColor: isActive ? "#A2492C" : "transparent" }}>
                  <View className="flex-row items-center gap-1.5">
                    <Text
                      className="text-[11px] uppercase"
                      style={{
                        fontFamily: "SpaceGrotesk_700Bold",
                        letterSpacing: 1.5,
                        color: isActive ? "#1A0200" : "#8E8E93",
                      }}
                    >
                      {label}
                    </Text>
                    {badge != null && badge > 0 && (
                      <Text
                        className="text-[10px]"
                        style={{
                          fontFamily: "SpaceGrotesk_700Bold",
                          color: isActive ? "#A2492C" : "#C5C5C8",
                        }}
                      >
                        {badge}
                      </Text>
                    )}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Card track — content swaps based on active tab. Card width and
          aspect ratio are kept identical so the strip height stays stable
          when switching, no layout jitter. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-3 px-4"
        style={{ marginTop: 12 }}
      >
        {active === "vouchers" &&
          rewards.map((r) => (
            <Pressable
              key={r.id}
              onPress={() => onRewardTap(r)}
              className="w-40 bg-surface rounded-2xl border border-border overflow-hidden active:opacity-70"
              style={{
                shadowColor: "#000",
                shadowOpacity: 0.05,
                shadowRadius: 6,
                shadowOffset: { width: 0, height: 2 },
              }}
            >
              <View className="aspect-[4/5] bg-primary/5">
                {r.image_url ? (
                  <Image source={{ uri: r.image_url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                ) : (
                  <View className="flex-1 items-center justify-center">
                    <Gift size={28} color="#A2492C" strokeWidth={1.5} />
                  </View>
                )}
                {(() => {
                  const label = urgencyLabel(r);
                  if (!label) return null;
                  return (
                    <View
                      className="absolute bg-primary rounded-full"
                      style={{ top: 8, left: 8, paddingHorizontal: 7, paddingVertical: 2 }}
                    >
                      <Text className="text-white text-[10px]" style={{ fontFamily: "Peachi-Bold" }}>
                        {label}
                      </Text>
                    </View>
                  );
                })()}
              </View>
              <View className="px-3 py-2.5">
                <Text className="text-espresso text-[13px]" style={{ fontFamily: "Peachi-Bold" }} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text
                  className="text-muted-fg text-[10px] mt-0.5"
                  style={{ fontFamily: "SpaceGrotesk_500Medium" }}
                  numberOfLines={1}
                >
                  {r.points_required > 0 ? `${r.points_required} pts` : "Free to claim"}
                </Text>
              </View>
            </Pressable>
          ))}

        {active === "usual" &&
          usual.map((item) => (
            <Pressable
              key={item.id}
              onPress={onUsualTap}
              className="w-40 bg-surface rounded-2xl border border-border overflow-hidden active:opacity-70"
              style={{
                shadowColor: "#000",
                shadowOpacity: 0.06,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 3 },
              }}
            >
              <View className="aspect-[4/5] bg-primary/5">
                {item.image_url ? (
                  <Image source={{ uri: item.image_url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                ) : (
                  <View className="flex-1 items-center justify-center">
                    <Coffee size={28} color="#A2492C" strokeWidth={1.5} />
                  </View>
                )}
              </View>
              <View className="px-3 py-2.5">
                <Text className="text-espresso text-[13px]" style={{ fontFamily: "Peachi-Bold" }} numberOfLines={1}>
                  {item.name}
                </Text>
                <View className="flex-row items-center justify-between mt-1">
                  <Text className="text-primary text-[14px]" style={{ fontFamily: "Peachi-Bold" }}>
                    {formatPrice(item.price)}
                  </Text>
                  <Text
                    className="text-muted-fg text-[10px]"
                    style={{ fontFamily: "SpaceGrotesk_500Medium" }}
                  >
                    {item.timesOrdered}×
                  </Text>
                </View>
              </View>
            </Pressable>
          ))}

        {active === "featured" &&
          featured.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => onFeaturedTap(p)}
              className="w-40 bg-surface rounded-2xl border border-border overflow-hidden active:opacity-70"
              style={{
                shadowColor: "#000",
                shadowOpacity: 0.06,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 3 },
              }}
            >
              <View className="aspect-[4/5] bg-background">
                {p.image_url && (
                  <Image source={{ uri: p.image_url }} className="w-full h-full" resizeMode="cover" />
                )}
              </View>
              <View className="px-3 py-2.5">
                <Text className="text-espresso text-[13px]" style={{ fontFamily: "Peachi-Bold" }} numberOfLines={1}>
                  {p.name}
                </Text>
                <View className="flex-row items-center justify-between mt-1">
                  <Text className="text-primary text-[14px]" style={{ fontFamily: "Peachi-Bold" }}>
                    {formatPrice(p.price)}
                  </Text>
                  <View
                    className="bg-espresso rounded-full items-center justify-center"
                    style={{ width: 24, height: 24 }}
                  >
                    <ChevronRight size={14} color="#FFFFFF" />
                  </View>
                </View>
              </View>
            </Pressable>
          ))}
      </ScrollView>
    </View>
  );
}

// ─── Home voucher ticket ────────────────────────────────────────────
// Compact 144×~150 ticket-stub for the home "Available rewards" rail.
// Mirrors RewardTicket's silhouette (themed top half with eyebrow +
// headline + brand mascot, perforated tear-line, white bottom stub
// with voucher name + sub) but the sub line shows expiry instead of a
// PTS cost — wallet vouchers are already owned, no points to spend.

type TicketDescriptor = {
  eyebrow: string;
  headline: string;
  topBg: string;
  topAccent: string;
  topMuted: string;
  BrandIcon: React.ComponentType<{ size: number; color: string; knockout?: string }>;
};

// Colours come from the same source-bucket theme the Rewards tab
// uses (Challenge / Mystery / Gift / Bean) — keeps wallet / home
// rail / rewards-tab reading as one visual system. Mapping mirrors
// the rectangular VoucherRow / CatalogCard on the Rewards tab:
//   bg ............ theme.bg
//   icon + headline theme.accent  (brand-pop on the bg)
//   eyebrow ....... theme.fgDim   (quieter secondary tone)
function ticketColorsFromTheme(theme: VoucherTheme): {
  topBg: string; topAccent: string; topMuted: string;
} {
  return {
    topBg:     theme.bg,
    topAccent: theme.accent,
    topMuted:  theme.fgDim,
  };
}

function describeVoucherTicket(v: Voucher): TicketDescriptor {
  const theme = themeForVoucher(v);
  const { topBg, topAccent, topMuted } = ticketColorsFromTheme(theme);

  // Headline mirrors RewardTicket's value-led copy: customers read
  // "RM 5 off" / "Free drink" off the card without scanning the
  // smaller name line.
  let eyebrow = "Reward";
  let headline = v.title;

  if (v.source_type === "birthday")           { eyebrow = "Birthday gift"; }
  else if (v.source_type === "mission")       { eyebrow = "Challenge reward"; }
  else if (v.source_type === "mystery")       { eyebrow = "Mystery bonus"; }
  else if (v.source_type === "referral")      { eyebrow = "Referral gift"; }
  else if (v.source_type === "campaign")      { eyebrow = "Welcome back"; }

  const dv = Number(v.discount_value ?? 0);
  if (v.discount_type === "flat" && dv > 0) {
    eyebrow = "Discount";
    headline = `RM${(dv / 100).toFixed(dv % 100 === 0 ? 0 : 2)} off`;
  } else if ((v.discount_type === "percent") && dv > 0) {
    eyebrow = "Discount";
    headline = `${dv}% off`;
  } else if (v.discount_type === "free_item") {
    if (v.source_type === "birthday") headline = "Free drink";
    else if (v.category === "free_item") headline = "Free drink";
  } else if (v.discount_type === "beans_multiplier") {
    // "2× Points" rather than "2× Points Boost" — the second word wraps
    // a 144-wide top stub at 19pt Peachi and tips the card taller than
    // its neighbours. Multiplier source is voucher.multiplier_value
    // when present, falling back to whatever the title looks like.
    eyebrow = "Boost";
    const mul = Number((v as { multiplier_value?: number | string | null }).multiplier_value ?? 0);
    if (mul > 1) {
      const pretty = mul % 1 === 0 ? `${mul}` : mul.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
      headline = `${pretty}× Points`;
    } else {
      headline = v.title;
    }
  }

  // Brand mark per category — mirrors RewardTicket's family of three
  // (gift / cup / tag).
  let BrandIcon: TicketDescriptor["BrandIcon"] = CelsiusGift;
  if (v.discount_type === "free_item" || v.category === "free_item") BrandIcon = CelsiusCup;
  else if (v.discount_type === "flat" || v.discount_type === "percent" || v.category === "discount") BrandIcon = CelsiusTag;
  else if (v.source_type === "birthday" || v.category === "special") BrandIcon = CelsiusGift;

  return { eyebrow, headline, topBg, topAccent, topMuted, BrandIcon };
}

// Mirror of HomeVoucherTicket for points-shop catalogue entries. Same
// ticket-stub silhouette + tone rotation; bottom stub shows the reward
// name + Bean cost instead of an expiry line.
function HomeCatalogTicket({
  reward,
  onPress,
}: {
  reward: Reward;
  onPress?: () => void;
}) {
  // Catalog rewards (Spend Points) all land in the BEAN bucket — same
  // mapping the Rewards tab's CatalogCard uses.
  const { topBg, topAccent, topMuted } = ticketColorsFromTheme(THEME_BEAN);
  // Pick a friendly headline based on what the reward actually does.
  let headline = reward.name;
  const dv = Number(reward.discount_value ?? 0);
  if ((reward.discount_type === "flat" || reward.discount_type === "fixed_amount") && dv > 0) {
    const rm = reward.discount_type === "flat" ? dv / 100 : dv;
    headline = `RM${rm.toFixed(rm % 1 === 0 ? 0 : 2)} off`;
  } else if ((reward.discount_type === "percent" || reward.discount_type === "percentage") && dv > 0) {
    headline = `${dv}% off`;
  } else if (reward.discount_type === "free_item") {
    headline = reward.name;
  }
  const eyebrow = "Points";
  // Brand icon per discount type (mirrors RewardTicket's family).
  let BrandIcon: typeof CelsiusGift = CelsiusGift;
  if (reward.discount_type === "free_item")                                                    BrandIcon = CelsiusCup;
  else if (reward.discount_type === "flat" || reward.discount_type === "percent" ||
           reward.discount_type === "fixed_amount" || reward.discount_type === "percentage")   BrandIcon = CelsiusTag;

  return (
    <Pressable
      onPress={() => {
        if (!onPress) return;
        Haptics.selectionAsync();
        onPress();
      }}
      className="active:opacity-80"
      style={{
        width: 144,
        borderRadius: 14,
        overflow: "hidden",
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      }}
      accessibilityRole="button"
      accessibilityLabel={`${headline}. ${reward.name}. ${reward.points_required} Points.`}
    >
      <View style={{ backgroundColor: topBg, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 14, minHeight: 92 }}>
        <View style={{ position: "absolute", right: 6, bottom: 6, opacity: 0.85 }} pointerEvents="none">
          <BrandIcon size={36} color={topAccent} knockout={topBg} />
        </View>
        <Text
          style={{
            color: topMuted,
            fontFamily: "SpaceGrotesk_700Bold",
            fontSize: 9,
            letterSpacing: 1.6,
            textTransform: "uppercase",
          }}
        >
          {eyebrow}
        </Text>
        <Text
          style={{
            color: topAccent,
            fontFamily: "Peachi-Bold",
            fontSize: 19,
            lineHeight: 21,
            marginTop: 5,
            paddingRight: 36,
          }}
          numberOfLines={2}
        >
          {headline}
        </Text>
      </View>
      <View style={{ position: "relative", height: 0 }}>
        <View style={{ position: "absolute", left: -7, top: -7, width: 14, height: 14, borderRadius: 7, backgroundColor: "#FFFFFF" }} />
        <View style={{ position: "absolute", right: -7, top: -7, width: 14, height: 14, borderRadius: 7, backgroundColor: "#FFFFFF" }} />
        <View style={{ position: "absolute", left: 12, right: 12, top: -1, height: 2, borderTopWidth: 1, borderTopColor: "rgba(26, 2, 0, 0.18)", borderStyle: "dashed" }} />
      </View>
      <View
        style={{
          backgroundColor: "#FFFFFF",
          paddingHorizontal: 12,
          paddingTop: 13,
          paddingBottom: 10,
          borderWidth: 1,
          borderTopWidth: 0,
          borderColor: "rgba(26, 2, 0, 0.10)",
        }}
      >
        <Text
          style={{ color: "#1A0200", fontFamily: "Peachi-Bold", fontSize: 12 }}
          numberOfLines={1}
        >
          {reward.name}
        </Text>
        <Text
          style={{
            color: "rgba(26, 2, 0, 0.55)",
            fontFamily: "SpaceGrotesk_700Bold",
            fontSize: 10,
            letterSpacing: 1.2,
            textTransform: "uppercase",
            marginTop: 4,
          }}
          numberOfLines={1}
        >
          {reward.points_required.toLocaleString()} Points
        </Text>
      </View>
    </Pressable>
  );
}

function HomeVoucherTicket({
  voucher,
  onPress,
}: {
  voucher: Voucher;
  onPress?: () => void;
}) {
  const { eyebrow, headline, topBg, topAccent, topMuted, BrandIcon } = describeVoucherTicket(voucher);
  const urgency = voucherUrgencyLabel(voucher);

  return (
    <Pressable
      onPress={() => {
        if (!onPress) return;
        Haptics.selectionAsync();
        onPress();
      }}
      className="active:opacity-80"
      style={{
        width: 144,
        borderRadius: 14,
        overflow: "hidden",
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      }}
      accessibilityRole="button"
      accessibilityLabel={`${headline}. ${voucher.title}. ${urgency.label}`}
    >
      {/* Top stub */}
      <View style={{ backgroundColor: topBg, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 14, minHeight: 92 }}>
        <View
          style={{ position: "absolute", right: 6, bottom: 6, opacity: 0.85 }}
          pointerEvents="none"
        >
          <BrandIcon size={36} color={topAccent} knockout={topBg} />
        </View>
        <Text
          style={{
            color: topMuted,
            fontFamily: "SpaceGrotesk_700Bold",
            fontSize: 9,
            letterSpacing: 1.6,
            textTransform: "uppercase",
          }}
        >
          {eyebrow}
        </Text>
        <Text
          style={{
            color: topAccent,
            fontFamily: "Peachi-Bold",
            fontSize: 19,
            lineHeight: 21,
            marginTop: 5,
            paddingRight: 36,
          }}
          numberOfLines={2}
        >
          {headline}
        </Text>
        {urgency.warning && (
          <View
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              backgroundColor: topAccent,
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 999,
            }}
          >
            <Text
              style={{
                color: topBg,
                fontFamily: "Peachi-Bold",
                fontSize: 9,
              }}
            >
              {urgency.label.toUpperCase()}
            </Text>
          </View>
        )}
      </View>

      {/* Perforated separator */}
      <View style={{ position: "relative", height: 0 }}>
        <View
          style={{
            position: "absolute",
            left: -7, top: -7,
            width: 14, height: 14, borderRadius: 7,
            backgroundColor: "#FFFFFF",
          }}
        />
        <View
          style={{
            position: "absolute",
            right: -7, top: -7,
            width: 14, height: 14, borderRadius: 7,
            backgroundColor: "#FFFFFF",
          }}
        />
        <View
          style={{
            position: "absolute",
            left: 12, right: 12, top: -1,
            height: 2,
            borderTopWidth: 1,
            borderTopColor: "rgba(26, 2, 0, 0.18)",
            borderStyle: "dashed",
          }}
        />
      </View>

      {/* Bottom stub — voucher name + expiry */}
      <View
        style={{
          backgroundColor: "#FFFFFF",
          paddingHorizontal: 12,
          paddingTop: 13,
          paddingBottom: 10,
          borderWidth: 1,
          borderTopWidth: 0,
          borderColor: "rgba(26, 2, 0, 0.10)",
        }}
      >
        <Text
          style={{ color: "#1A0200", fontFamily: "Peachi-Bold", fontSize: 12 }}
          numberOfLines={1}
        >
          {voucher.title}
        </Text>
        <Text
          style={{
            color: urgency.warning ? "#A2492C" : "rgba(26, 2, 0, 0.55)",
            fontFamily: "SpaceGrotesk_700Bold",
            fontSize: 10,
            letterSpacing: 1.2,
            textTransform: "uppercase",
            marginTop: 4,
          }}
          numberOfLines={1}
        >
          {urgency.label}
        </Text>
      </View>
    </Pressable>
  );
}

