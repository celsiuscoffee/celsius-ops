import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, Image, RefreshControl } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { MapPin, ChevronRight, Coffee, Navigation, Sparkles, Gift, Clock4, ShoppingCart } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { supabase, type Outlet } from "../lib/supabase";
import { useApp, cartCount } from "../lib/store";
import { fetchMenu } from "../lib/menu";
import {
  fetchRecentItems,
  fetchOrderHistory,
  fetchRewards,
  type Reward,
  type OrderHistoryEntry,
} from "../lib/rewards";
import { getSetting, type Settings } from "../lib/settings";
import { Card } from "../components/Card";
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
  const menu = useQuery({ queryKey: ["menu"], queryFn: fetchMenu });
  const outletId = useApp((s) => s.outletId);
  const outletName = useApp((s) => s.outletName);
  const cart = useApp((s) => s.cart);
  const setOutlet = useApp((s) => s.setOutlet);
  const member = useApp((s) => s.member);
  const phone = useApp((s) => s.phone);
  const addToCart = useApp((s) => s.addToCart);
  const [refreshing, setRefreshing] = useState(false);

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

  // Rewards the customer can redeem right now with current points balance.
  const rewardsQ = useQuery({
    queryKey: ["rewards-home", phone],
    queryFn: () => fetchRewards(phone ?? null),
    staleTime: 60_000,
  });
  const points = member?.pointsBalance ?? rewardsQ.data?.pointsBalance ?? 0;
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

  // Urgency label for a reward: "Ends today" / "Ends in N days" if it
  // expires within a week, "Last 1 left" if stock is the last unit. Returns
  // null when nothing is urgent so we don't visually clutter healthy cards.
  const urgencyLabel = (r: Reward): string | null => {
    if (r.stock != null && r.stock > 0 && r.stock <= 3) {
      return r.stock === 1 ? "Last one!" : `Only ${r.stock} left`;
    }
    if (r.valid_until) {
      const ms = new Date(r.valid_until).getTime() - Date.now();
      if (ms <= 0) return null;
      const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
      if (days <= 1) return "Ends today";
      if (days <= 7) return `Ends in ${days}d`;
    }
    return null;
  };

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

  // Hero promo content driven by backoffice setting; falls back to a baked-in
  // launch promo if the setting hasn't been configured yet.
  const [promo, setPromo] = useState<Settings["promo_banner"]>({
    enabled: true,
    label: "New App Promo",
    headline: "Buy 1",
    highlight: "Free 1",
    description: "First app order · Any drink · Any size",
  });
  useEffect(() => {
    getSetting("promo_banner").then((v) => {
      if (v && v.enabled) setPromo(v);
      else setPromo((p) => ({ ...p, enabled: false }));
    });
  }, []);

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
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient, phone]);

  const onPromoTap = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    switch (promo.cta_target) {
      case "store":
        router.push("/store");
        return;
      case "rewards":
        router.push("/rewards");
        return;
      case "url":
        // External URLs handled by deep linking the user out of the app —
        // not implemented yet, fall back to menu so taps still feel responsive.
        if (outletId) router.push("/menu");
        else router.push("/store");
        return;
      case "menu":
      default:
        if (cartCount(cart) > 0) router.push("/cart");
        else if (outletId) router.push("/menu");
        else router.push("/store");
    }
  };

  return (
    <View className="flex-1 bg-background">
      {/* Compact home header — greeting / points / cart on row 1, outlet
          picker on row 2. Replaces the old EspressoHeader + tall greeting
          block which together ate ~220px before any content rendered. */}
      <View
        className="bg-espresso px-4 pb-3"
        style={{ paddingTop: insets.top + 10 }}
      >
        <View className="flex-row items-center gap-3">
          <View className="flex-1">
            <Text
              className="text-white/45 text-[10px] tracking-widest uppercase"
              style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}
            >
              {greeting}
            </Text>
            <Text
              className="text-white text-[18px] mt-0.5"
              style={{ fontFamily: "Peachi-Bold" }}
              numberOfLines={1}
            >
              {firstName ? `Hi, ${firstName}` : "Welcome"}
            </Text>
          </View>
          {member && (
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                router.push("/rewards");
              }}
              className="bg-white/10 rounded-2xl active:opacity-80"
              style={{ paddingHorizontal: 10, paddingVertical: 5, minWidth: 88 }}
            >
              <View className="flex-row items-center gap-1">
                <Sparkles size={11} color="#FBBF24" strokeWidth={2} fill="#FBBF24" />
                <Text
                  className="text-white text-[12px]"
                  style={{ fontFamily: "Peachi-Bold" }}
                >
                  {(member.pointsBalance ?? 0).toLocaleString()}
                </Text>
              </View>
              {nextReward && pointsToNext > 0 && (
                <>
                  <View
                    className="bg-white/15 rounded-full mt-1 overflow-hidden"
                    style={{ height: 3 }}
                  >
                    <View
                      className="bg-amber-400 rounded-full"
                      style={{ height: 3, width: `${progressPct * 100}%` }}
                    />
                  </View>
                  <Text
                    className="text-white/60 text-[9px] mt-0.5"
                    style={{ fontFamily: "SpaceGrotesk_500Medium" }}
                    numberOfLines={1}
                  >
                    {pointsToNext} to next
                  </Text>
                </>
              )}
            </Pressable>
          )}
          <Pressable
            onPress={() => router.push("/cart")}
            className="relative p-1 active:opacity-60"
            hitSlop={12}
          >
            <ShoppingCart size={22} color="rgba(255,255,255,0.85)" />
            {cartCount(cart) > 0 && (
              <View
                className="absolute bg-white rounded-full items-center justify-center"
                style={{ top: -2, right: -2, width: 16, height: 16 }}
              >
                <Text
                  className="text-primary text-[9px]"
                  style={{ fontFamily: "Peachi-Bold" }}
                >
                  {cartCount(cart)}
                </Text>
              </View>
            )}
          </Pressable>
        </View>

        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            router.push("/store");
          }}
          className="flex-row items-center gap-1.5 mt-2.5 self-start active:opacity-70"
        >
          <MapPin size={13} color="rgba(255,255,255,0.7)" />
          <Text
            className="text-white text-[13px]"
            style={{ fontFamily: "Peachi-Bold" }}
          >
            {outletName ?? "Select pickup outlet"}
          </Text>
          {currentOutlet && (
            <>
              {(() => {
                // Open + idle  → green, Open + busy → amber, Closed → red.
                const dot = !currentOutlet.is_open
                  ? { bg: "#EF4444", label: "Closed" }
                  : currentOutlet.is_busy
                  ? { bg: "#F59E0B", label: "Busy" }
                  : { bg: "#22C55E", label: null };
                const eta =
                  currentOutlet.is_open && currentOutlet.pickup_time_mins
                    ? `~${currentOutlet.pickup_time_mins} min`
                    : null;
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
                    {dot.label && (
                      <Text
                        className="text-white/70 text-[11px]"
                        style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}
                      >
                        {dot.label}
                      </Text>
                    )}
                    {eta && (
                      <Text
                        className="text-white/70 text-[11px]"
                        style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}
                      >
                        · {eta}
                      </Text>
                    )}
                  </>
                );
              })()}
            </>
          )}
          <ChevronRight size={14} color="rgba(255,255,255,0.55)" />
        </Pressable>
      </View>

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
        {/* Active order tracker — sits above everything else when present */}
        {activeOrder && (
          <Pressable
            onPress={() => router.push({ pathname: "/order/[id]", params: { id: activeOrder.id } })}
            className="mx-4 mt-4 bg-emerald-50 border border-emerald-200 rounded-2xl active:opacity-80"
            style={{ paddingHorizontal: 14, paddingVertical: 12 }}
          >
            <View className="flex-row items-center gap-3">
              <View className="w-9 h-9 rounded-full bg-emerald-500/15 items-center justify-center">
                <Clock4 size={18} color="#16A34A" strokeWidth={2} />
              </View>
              <View className="flex-1">
                <Text
                  className="text-emerald-900 text-[10px] uppercase tracking-widest"
                  style={{ fontFamily: "SpaceGrotesk_700Bold" }}
                >
                  {statusLabel(activeOrder.status)}
                </Text>
                <Text
                  className="text-emerald-950 text-[14px] mt-0.5"
                  style={{ fontFamily: "Peachi-Bold" }}
                  numberOfLines={1}
                >
                  Order #{activeOrder.order_number} · tap to track
                </Text>
              </View>
              <ChevronRight size={16} color="#15803D" />
            </View>
          </Pressable>
        )}

        {/* Hero promo — moved above Your Usual so it lands within the first
            viewport. Backoffice-driven via promo_banner setting. */}
        {promo.enabled && (promo.headline || promo.image_url) && (
          <Pressable
            onPress={onPromoTap}
            className="mx-4 mt-4 bg-espresso rounded-3xl overflow-hidden active:opacity-90"
            style={{
              shadowColor: "#160800",
              shadowOpacity: 0.12,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 },
            }}
          >
            {promo.image_url ? (
              <View>
                <Image
                  source={{ uri: promo.image_url }}
                  style={{ width: "100%", aspectRatio: 16 / 9 }}
                  resizeMode="cover"
                />
                <View className="px-4 py-3 flex-row items-center justify-between">
                  <View className="flex-1 pr-3">
                    {promo.label && (
                      <Text
                        className="text-amber-400 text-[10px] uppercase tracking-widest"
                        style={{ fontFamily: "SpaceGrotesk_700Bold" }}
                      >
                        {promo.label}
                      </Text>
                    )}
                    <Text
                      className="text-white text-[16px] mt-0.5"
                      style={{ fontFamily: "Peachi-Bold" }}
                      numberOfLines={1}
                    >
                      {promo.headline} {promo.highlight && (
                        <Text className="text-amber-400">{promo.highlight}</Text>
                      )}
                    </Text>
                  </View>
                  <View className="bg-white rounded-full px-4 py-2 flex-row items-center gap-1">
                    <Text className="text-primary text-[13px] font-bold">
                      {promo.cta_text || "Order"}
                    </Text>
                    <ChevronRight size={14} color="#C05040" />
                  </View>
                </View>
              </View>
            ) : (
              <View className="px-5 py-5">
                {promo.label && (
                  <Text
                    className="text-amber-400 text-[10px] uppercase tracking-widest"
                    style={{ fontFamily: "SpaceGrotesk_700Bold" }}
                  >
                    {promo.label}
                  </Text>
                )}
                <View className="flex-row items-end justify-between mt-1">
                  <View className="flex-1 pr-3">
                    <Text
                      className="text-white text-3xl leading-tight"
                      style={{ fontFamily: "Peachi-Bold" }}
                    >
                      {promo.headline}
                      {promo.highlight && (
                        <>
                          {" "}
                          <Text className="text-amber-400">{promo.highlight}</Text>
                        </>
                      )}
                    </Text>
                    {promo.description && (
                      <Text className="text-white/60 text-[12px] mt-1.5">
                        {promo.description}
                      </Text>
                    )}
                  </View>
                  <View className="bg-white rounded-full px-4 py-2 flex-row items-center gap-1">
                    <Text className="text-primary text-[13px] font-bold">
                      {promo.cta_text || "Order"}
                    </Text>
                    <ChevronRight size={14} color="#C05040" />
                  </View>
                </View>
              </View>
            )}
          </Pressable>
        )}

        {/* Your usual — pulls regulars straight to checkout, retention-led.
            Horizontal scroll with big imagery so multiple products fit on the
            fold without each tile feeling cramped. */}
        {phone && (recent.data?.length ?? 0) > 0 && (
          <View className="mt-5">
            <View className="flex-row items-center justify-between mb-2 px-4">
              <Text
                className="text-espresso text-base"
                style={{ fontFamily: "Peachi-Bold" }}
              >
                Your usual
              </Text>
              <Text
                className="text-muted-fg text-[11px]"
                style={{ fontFamily: "SpaceGrotesk_500Medium" }}
              >
                Tap to add again
              </Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="gap-3 px-4"
            >
              {recent.data!.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => {
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    if (!outletId) {
                      router.push("/store");
                      return;
                    }
                    addToCart({
                      productId: item.id,
                      name: item.name,
                      image: item.image_url ?? undefined,
                      basePrice: item.price,
                      quantity: 1,
                      modifiers: [],
                      specialInstructions: undefined,
                      totalPrice: item.price,
                    });
                  }}
                  className="w-40 bg-surface rounded-3xl border border-border overflow-hidden active:opacity-70"
                  style={{
                    shadowColor: "#000",
                    shadowOpacity: 0.05,
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
                        <Coffee size={28} color="#C05040" strokeWidth={1.5} />
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
                    <Text
                      className="text-muted-fg text-[10px] mt-0.5"
                      style={{ fontFamily: "SpaceGrotesk_500Medium" }}
                    >
                      Ordered {item.timesOrdered}×
                    </Text>
                    <View className="flex-row items-center justify-between mt-2">
                      <Text
                        className="text-primary text-[14px]"
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

        {/* Rewards available — only show what user can redeem right now */}
        {affordableRewards.length > 0 && (
          <View className="mt-5">
            <View className="flex-row items-center justify-between mb-2 px-4">
              <View className="flex-row items-center gap-2">
                <Gift size={16} color="#C05040" strokeWidth={2} />
                <Text
                  className="text-espresso text-base"
                  style={{ fontFamily: "Peachi-Bold" }}
                >
                  Available rewards
                </Text>
              </View>
              <Pressable
                onPress={() => router.push("/rewards")}
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
                <Pressable
                  key={r.id}
                  onPress={() => {
                    Haptics.selectionAsync();
                    router.push("/rewards");
                  }}
                  className="w-36 bg-surface rounded-2xl border border-border overflow-hidden active:opacity-70"
                  style={{
                    shadowColor: "#000",
                    shadowOpacity: 0.05,
                    shadowRadius: 6,
                    shadowOffset: { width: 0, height: 2 },
                  }}
                >
                  <View className="aspect-[4/3] bg-primary/5">
                    {r.image_url ? (
                      <Image
                        source={{ uri: r.image_url }}
                        style={{ width: "100%", height: "100%" }}
                        resizeMode="cover"
                      />
                    ) : (
                      <View className="flex-1 items-center justify-center">
                        <Gift size={26} color="#C05040" strokeWidth={1.5} />
                      </View>
                    )}
                    {(() => {
                      const label = urgencyLabel(r);
                      if (!label) return null;
                      return (
                        <View
                          className="absolute bg-primary rounded-full"
                          style={{
                            top: 8,
                            left: 8,
                            paddingHorizontal: 7,
                            paddingVertical: 2,
                          }}
                        >
                          <Text
                            className="text-white text-[10px]"
                            style={{ fontFamily: "Peachi-Bold" }}
                          >
                            {label}
                          </Text>
                        </View>
                      );
                    })()}
                  </View>
                  <View className="px-3 py-2.5">
                    <Text
                      className="text-espresso text-[13px]"
                      style={{ fontFamily: "Peachi-Bold" }}
                      numberOfLines={1}
                    >
                      {r.name}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Empty-state nudge — only when no personalized sections fired and
            user hasn't yet got a cart going. Keeps first-time users from
            staring at a sparse home. */}
        {!activeOrder &&
          !(phone && (recent.data?.length ?? 0) > 0) &&
          affordableRewards.length === 0 &&
          !(promo.enabled && (promo.headline || promo.image_url)) &&
          cartCount(cart) === 0 && (
            <View className="mx-4 mt-5 bg-surface border border-border rounded-2xl p-5 items-center">
              <View className="w-12 h-12 rounded-2xl bg-primary/10 items-center justify-center">
                <Coffee size={24} color="#C05040" strokeWidth={1.5} />
              </View>
              <Text
                className="text-espresso text-[16px] mt-3"
                style={{ fontFamily: "Peachi-Bold" }}
              >
                Ready for your first cup?
              </Text>
              <Text
                className="text-muted-fg text-[12px] text-center mt-1"
                style={{ fontFamily: "SpaceGrotesk_400Regular" }}
              >
                Browse the menu and we'll have it waiting at pickup.
              </Text>
              <Pressable
                onPress={onOrderNow}
                className="bg-espresso rounded-full mt-4 active:opacity-80"
                style={{ paddingHorizontal: 22, paddingVertical: 10 }}
              >
                <Text
                  className="text-white text-[13px]"
                  style={{ fontFamily: "Peachi-Bold" }}
                >
                  Browse menu
                </Text>
              </Pressable>
            </View>
          )}

        {/* Best Sellers (skeleton while menu loads, real cards once data is in) */}
        {menu.isLoading && featured.length === 0 ? (
          <View className="px-4 mt-5">
            <View
              className="bg-surface/60 rounded-md mb-3"
              style={{ height: 16, width: 110 }}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="gap-3"
            >
              {[0, 1, 2, 3].map((i) => (
                <View
                  key={i}
                  className="w-40 bg-surface rounded-3xl border border-border overflow-hidden"
                >
                  <View className="aspect-[4/5] bg-background" />
                  <View className="p-3 gap-2">
                    <View
                      className="bg-background rounded-md"
                      style={{ height: 12, width: "80%" }}
                    />
                    <View
                      className="bg-background rounded-md"
                      style={{ height: 14, width: "40%" }}
                    />
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
                className="text-espresso text-base"
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
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="gap-3"
            >
              {featured.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    if (!outletId) router.push("/store");
                    else router.push({ pathname: "/product/[id]", params: { id: p.id } });
                  }}
                  className="w-40 active:opacity-70"
                >
                  <View
                    className="bg-surface rounded-3xl overflow-hidden border border-border"
                    style={{
                      shadowColor: "#000",
                      shadowOpacity: 0.04,
                      shadowRadius: 6,
                      shadowOffset: { width: 0, height: 2 },
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
                          className="text-primary text-[14px]"
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

        {/* Quick actions — demoted to lowest priority. Sticky cart pill +
            header outlet picker cover the same intents above the fold for
            most sessions; this row is a fallback for menu/outlet entry. */}
        <View className="flex-row gap-3 px-4 mt-5">
          <View className="flex-1">
            <Card onPress={onOrderNow}>
              <View className="w-10 h-10 rounded-xl bg-primary/10 items-center justify-center">
                <Coffee size={20} color="#C05040" strokeWidth={1.5} />
              </View>
              <Text className="text-espresso font-bold text-sm mt-2.5">
                {cartCount(cart) > 0 ? "Review Cart" : "Order Now"}
              </Text>
              <Text className="text-muted-fg text-xs mt-0.5">
                {cartCount(cart) > 0
                  ? `${cartCount(cart)} item${cartCount(cart) === 1 ? "" : "s"} waiting`
                  : "Browse full menu"}
              </Text>
            </Card>
          </View>
          <View className="flex-1">
            <Card onPress={() => router.push("/store")}>
              <View className="w-10 h-10 rounded-xl bg-primary/10 items-center justify-center">
                <Navigation size={20} color="#C05040" strokeWidth={1.5} />
              </View>
              <Text className="text-espresso font-bold text-sm mt-2.5">Our Outlets</Text>
              <Text className="text-muted-fg text-xs mt-0.5" numberOfLines={1}>
                Shah Alam · Conezion · Tamarind
              </Text>
            </Card>
          </View>
        </View>

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
              {cartCount(cart)} item{cartCount(cart) > 1 ? "s" : ""}
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
