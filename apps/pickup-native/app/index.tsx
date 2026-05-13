import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, Image, RefreshControl } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { MapPin, ChevronRight, Coffee, Sparkles, Gift, Clock4, ShoppingCart } from "lucide-react-native";
import * as Haptics from "expo-haptics";
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
  fetchActiveMission,
} from "../lib/rewards-v2";
import { RewardTicket } from "../components/RewardTicket";
import { SafeBoundary } from "../components/SafeBoundary";
import { TierHero } from "../components/TierHero";
import { PosterCarousel } from "../components/PosterCarousel";
import { getHomePosters, type HomePoster } from "../lib/posters";
import { tierStyle } from "../lib/tier-styles";
import { getSetting } from "../lib/settings";
import { BottomNav } from "../components/BottomNav";
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

export default function Home() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const outlets = useQuery({ queryKey: ["outlets"], queryFn: fetchOutlets });
  const outletId = useApp((s) => s.outletId);
  const menu = useQuery({
    queryKey: ["menu", outletId],
    queryFn: () => fetchMenu(outletId),
  });
  const outletName = useApp((s) => s.outletName);
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
  const activeMissionQ = useQuery({
    queryKey: ["active-mission", phone ?? "anon"],
    queryFn: fetchActiveMission,
    enabled: !!phone,
    staleTime: 60_000,
  });

  const walletVouchers = (myVouchersQ.data ?? []).filter((v) => v.status === "active");
  const claimables     = claimableQ.data ?? [];
  const activeMission  = activeMissionQ.data ?? null;
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

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();
  const firstName = member?.name?.split(/\s+/)[0] ?? null;

  const featured = (menu.data?.products ?? [])
    .filter((p) => p.is_featured && p.is_available)
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
    queryKey: ["home-posters"],
    queryFn: getHomePosters,
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const posters: HomePoster[] = postersQ.data ?? [];

  // Redeemable-now count for the hero KPI. Combines two buckets:
  //   1. Gifted / issued vouchers — Birthday Drink, Welcome BOGO,
  //      anything auto-issued. These already carry a voucher_id on
  //      the rewards-API row.
  //   2. Affordable catalog rewards — points-shop entries where the
  //      customer's balance already covers points_required (e.g. RM5
  //      at 100 pts when the customer has 2,314).
  // A row is only counted once even if it sits in both buckets.
  const heroBalance = rewardsQ.data?.pointsBalance ?? 0;
  // Voucher count combines:
  //   1. Legacy points-shop voucher_id rows + affordable catalog rewards
  //      (kept for back-compat with existing rewards API)
  //   2. Real wallet vouchers from rewards-v2 (issued from missions /
  //      mystery / birthday / referral / milestones)
  //   3. Claimable offers waiting for one-tap claim (welcome / promo /
  //      pending mystery / pending milestone)
  // Dedupe legacy voucher_id rows that already appear in the v2 wallet —
  // rows in walletVouchers carry the same id as the legacy voucher_id.
  const legacyVoucherIds = new Set(walletVouchers.map((v) => v.id));
  const legacyCount = (rewardsQ.data?.rewards ?? []).filter((r) => {
    const vId = (r as { voucher_id?: string | null }).voucher_id;
    if (vId && legacyVoucherIds.has(vId)) return false;
    const hasVoucher = !!vId;
    const affordable =
      typeof r.points_required === "number" &&
      r.points_required > 0 &&
      heroBalance >= r.points_required;
    return hasVoucher || affordable;
  }).length;
  const voucherCount = legacyCount + walletVouchers.length + claimables.length;

  return (
    <View className="flex-1 bg-background">
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
              style={{ top: -3, right: -3, width: 16, height: 16, backgroundColor: "#C05040" }}
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
          {showTierEyebrow && tier && (
            <View className="flex-row items-center" style={{ gap: 5 }}>
              <Sparkles size={11} color={ts.accentColor} fill={ts.accentColor} />
              <Text
                style={{
                  fontFamily: "SpaceGrotesk_700Bold",
                  fontSize: 10.5,
                  letterSpacing: 1.4,
                  color: ts.accentColor,
                }}
              >
                {ts.displayName}
              </Text>
            </View>
          )}
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
              // to "Spend your Beans" or "Yours" depending on intent.
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
              Vouchers
            </Text>
          </Pressable>
          <View className="items-end justify-center">
            <ChevronRight size={16} color="rgba(255,255,255,0.55)" />
          </View>
        </View>
      </Pressable>
      </View>

      {/* Outlet row — back below the hero, above Available rewards.
          Plain pressable so customers can swap pickup outlet without
          interfering with the hero card. */}
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          router.push("/store");
        }}
        className="flex-row items-center self-start active:opacity-75"
        style={{ marginLeft: 20, marginTop: 14, marginBottom: 4, gap: 6 }}
      >
        <MapPin size={14} color="#8E8E93" />
        <Text
          style={{
            fontFamily: "Peachi-Bold",
            fontSize: 14,
            color: "#160800",
          }}
          numberOfLines={1}
        >
          {outletName ?? "Select pickup outlet"}
        </Text>
        {currentOutlet && (() => {
          const dot = !currentOutlet.is_open
            ? { bg: "#EF4444", label: "Closed" }
            : currentOutlet.is_busy
            ? { bg: "#F59E0B", label: "Busy" }
            : { bg: "#22C55E", label: currentOutlet.pickup_time_mins ? `~${currentOutlet.pickup_time_mins} min` : "Open" };
          return (
            <>
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: dot.bg,
                  marginLeft: 4,
                }}
              />
              <Text
                style={{
                  fontFamily: "SpaceGrotesk_500Medium",
                  fontSize: 12,
                  color: "#8E8E93",
                }}
              >
                {dot.label}
              </Text>
            </>
          );
        })()}
        <ChevronRight size={13} color="#8E8E93" />
      </Pressable>

      <ScrollView
        contentContainerClassName="pb-40"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#C05040"
            colors={["#C05040"]}
          />
        }
      >
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
            Brand-aligned: terracotta tint on cream-white, espresso text,
            primary chevron. Was emerald — green isn't on the CC palette
            (only terracotta, espresso, white, amber). */}
        {activeOrder && (
          <Pressable
            onPress={() => router.push({ pathname: "/order/[id]", params: { id: activeOrder.id } })}
            className="mx-4 mt-4 rounded-2xl active:opacity-85"
            style={{
              paddingHorizontal: 14,
              paddingVertical: 12,
              backgroundColor: "#FBEBE8",
              borderWidth: 1,
              borderColor: "rgba(192, 80, 64, 0.20)",
            }}
          >
            <View className="flex-row items-center gap-3">
              <View
                className="w-9 h-9 rounded-full items-center justify-center"
                style={{ backgroundColor: "rgba(192, 80, 64, 0.15)" }}
              >
                <Clock4 size={18} color="#C05040" strokeWidth={2} />
              </View>
              <View className="flex-1">
                <Text
                  className="text-[10px] uppercase tracking-widest"
                  style={{ fontFamily: "SpaceGrotesk_700Bold", color: "#C05040", letterSpacing: 1.5 }}
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
              <ChevronRight size={16} color="#C05040" />
            </View>
          </Pressable>
        )}

        {/* "How was it? · Reorder" home block removed — reorder now
            lives only on the Orders tab (where the customer expects to
            see past orders). Home stays focused on what's next. */}

        {/* Claimable peek — one-tap claim cards from rewards-v2.
            Surfaces freshly granted offers (welcome, promo, pending
            mystery / milestone). Drives the home → Rewards screen flow:
            tap → Vouchers tab → claim. Hidden if nothing's claimable. */}
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
              borderColor: "rgba(192,80,64,0.25)",
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
                backgroundColor: "#C05040",
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
                  : `${claimables.length} rewards waiting`}
              </Text>
              <Text
                style={{
                  fontFamily: "SpaceGrotesk_500Medium",
                  fontSize: 11,
                  color: "#5A1F16",
                  marginTop: 1,
                }}
              >
                Tap to view in Rewards · Vouchers
              </Text>
            </View>
            <ChevronRight size={16} color="#5A1F16" strokeWidth={2.2} />
          </Pressable>
        )}

        {/* Active mission peek — visible only if customer has picked a
            mission this week. Mirrors the MissionCard pattern on the
            Rewards screen but compact for home. */}
        {phone && activeMission && (
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              router.push("/rewards");
            }}
            className="mx-4 mt-3 active:opacity-80"
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: 16,
              padding: 14,
              flexDirection: "row",
              alignItems: "center",
              borderWidth: 1,
              borderColor: "rgba(26,2,0,0.10)",
              gap: 12,
              shadowColor: "#000",
              shadowOpacity: 0.04,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 2 },
            }}
            accessibilityRole="button"
            accessibilityLabel={`This week's challenge: ${activeMission.title}, progress ${activeMission.progress_current} of ${activeMission.goal_threshold}`}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: "#FBEBE8",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Sparkles size={20} color="#C05040" strokeWidth={1.8} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={{
                  fontFamily: "SpaceGrotesk_700Bold",
                  fontSize: 10,
                  color: "#C05040",
                  letterSpacing: 1.5,
                  textTransform: "uppercase",
                  marginBottom: 1,
                }}
              >
                This week's challenge
              </Text>
              <Text
                style={{
                  fontFamily: "Peachi-Bold",
                  fontSize: 14,
                  color: "#1A0200",
                }}
                numberOfLines={1}
              >
                {activeMission.title} · {activeMission.progress_current}/{activeMission.goal_threshold}
              </Text>
            </View>
            <ChevronRight size={16} color="#6B6B6B" strokeWidth={2} />
          </Pressable>
        )}

        {/* No active mission CTA — only when signed in + no mission picked
            yet this week. Drives the customer to the picker so they have
            a goal running. */}
        {phone && !activeMission && !activeMissionQ.isLoading && (
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              router.push("/mission-picker" as never);
            }}
            className="mx-4 mt-3 active:opacity-80"
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: 16,
              padding: 14,
              flexDirection: "row",
              alignItems: "center",
              borderWidth: 1,
              borderColor: "#C05040",
              borderStyle: "dashed",
              gap: 12,
            }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: "#FBEBE8",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Sparkles size={20} color="#C05040" strokeWidth={1.8} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: "Peachi-Bold", fontSize: 14, color: "#1A0200" }}>
                Pick this week's challenge
              </Text>
              <Text
                style={{
                  fontFamily: "SpaceGrotesk_500Medium",
                  fontSize: 11,
                  color: "#6B6B6B",
                  marginTop: 1,
                }}
              >
                Earn voucher rewards by Sunday
              </Text>
            </View>
            <ChevronRight size={16} color="#C05040" strokeWidth={2.2} />
          </Pressable>
        )}

        {/* Active challenge — small banner that surfaces the customer's
            current weekly mission with one-tap into the Challenges tab.
            Hidden while no mission is picked / nothing's loaded. */}
        {activeMission && (
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              router.push("/rewards?tab=challenges" as never);
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
                Active challenge · {activeMission.progress_current}/{activeMission.goal_threshold}
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

        {/* Available rewards — points-shop catalogue the customer can
            spend Beans on. Tap any card OR the All link to jump to the
            Rewards tab (Get more / Spend Beans section). */}
        {affordableRewards.length > 0 && (
          <View className="mt-5">
            <View className="flex-row items-center justify-between mb-2 px-4">
              <Text
                className="text-espresso text-[18px]"
                style={{ fontFamily: "Peachi-Bold" }}
              >
                Available rewards
              </Text>
              <Pressable
                onPress={() => router.push("/rewards?tab=rewards" as never)}
                className="flex-row items-center gap-0.5 active:opacity-70"
              >
                <Text className="text-primary text-xs font-bold">All</Text>
                <ChevronRight size={14} color="#C05040" />
              </Pressable>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="gap-3 px-4"
            >
              {affordableRewards.map((r) => (
                <RewardTicket
                  key={r.id}
                  reward={r}
                  onPress={() => router.push("/rewards?tab=rewards" as never)}
                />
              ))}
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
                <ChevronRight size={14} color="#C05040" />
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
                        <Coffee size={32} color="#C05040" strokeWidth={1.5} />
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
                <ChevronRight size={14} color="#C05040" />
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

      </ScrollView>

      {cartCount(cart) > 0 && (
        <View
          className="absolute left-4 right-4"
          style={{ bottom: insets.bottom + 70 }}
        >
          <Pressable
            onPress={() => router.push("/cart")}
            className="bg-primary rounded-full py-3 px-5 flex-row items-center justify-between active:opacity-80"
            style={{
              shadowColor: "#C05040",
              shadowOpacity: 0.3,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 },
            }}
          >
            <View className="flex-row items-center gap-2">
              <View className="bg-white rounded-full w-6 h-6 items-center justify-center">
                <Text className="text-primary text-xs font-bold">{cartCount(cart)}</Text>
              </View>
              <Text className="text-white font-bold">View cart</Text>
            </View>
            <Text className="text-white font-bold">
              {cartCount(cart)} item{cartCount(cart) === 1 ? "" : "s"}
            </Text>
          </Pressable>
        </View>
      )}

      <BottomNav />
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
            <ChevronRight size={13} color="#C05040" />
          </Pressable>
        </View>
        <View className="flex-row gap-5">
          {visibleTabs.map((t) => {
            const isActive = active === t;
            const label = t === "vouchers" ? "Vouchers" : t === "usual" ? "Usual" : "Best sellers";
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
                <View style={{ paddingBottom: 6, borderBottomWidth: 2, borderBottomColor: isActive ? "#C05040" : "transparent" }}>
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
                          color: isActive ? "#C05040" : "#C5C5C8",
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
                    <Gift size={28} color="#C05040" strokeWidth={1.5} />
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
                    <Coffee size={28} color="#C05040" strokeWidth={1.5} />
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

