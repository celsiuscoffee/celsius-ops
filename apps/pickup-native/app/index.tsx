import { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, Pressable, ScrollView, Image } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { MapPin, ChevronRight, Coffee, Navigation, Sparkles, Gift, Clock4 } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { supabase, type Outlet } from "../lib/supabase";
import { useApp, cartCount } from "../lib/store";
import { fetchMenu } from "../lib/menu";
import {
  fetchRecentItems,
  fetchOrderHistory,
  fetchRewards,
  formatRewardValue,
  type Reward,
  type OrderHistoryEntry,
} from "../lib/rewards";
import { getSetting, type Settings } from "../lib/settings";
import { EspressoHeader } from "../components/EspressoHeader";
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
  const outlets = useQuery({ queryKey: ["outlets"], queryFn: fetchOutlets });
  const menu = useQuery({ queryKey: ["menu"], queryFn: fetchMenu });
  const outletId = useApp((s) => s.outletId);
  const outletName = useApp((s) => s.outletName);
  const cart = useApp((s) => s.cart);
  const setOutlet = useApp((s) => s.setOutlet);
  const member = useApp((s) => s.member);
  const phone = useApp((s) => s.phone);
  const addToCart = useApp((s) => s.addToCart);

  // "Your usual" — top 3 most-ordered products. Only fires for signed-in
  // customers; returns empty for first-time users.
  const recent = useQuery({
    queryKey: ["recent-items", phone],
    queryFn: () => (phone ? fetchRecentItems(phone, 3) : Promise.resolve([])),
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
  const affordableRewards = (rewardsQ.data?.rewards ?? [])
    .filter((r: Reward) => r.is_active && r.points_required <= points)
    .slice(0, 6);

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
      <EspressoHeader />

      {/* Greeting + outlet picker */}
      <View className="bg-espresso -mt-5 px-4 pb-5">
        <Text className="text-white/50 text-[10px] mt-0.5 tracking-widest uppercase"
              style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>
          {greeting}
        </Text>
        <Text
          className="text-white text-2xl mt-0.5"
          style={{ fontFamily: "Peachi-Bold" }}
        >
          {firstName ? `Hi, ${firstName}` : "Welcome"}
        </Text>

        {member && (
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              router.push("/rewards");
            }}
            className="flex-row items-center gap-1.5 mt-2 self-start bg-white/10 rounded-full active:opacity-80"
            style={{ paddingHorizontal: 10, paddingVertical: 5 }}
          >
            <Sparkles size={12} color="#FBBF24" strokeWidth={2} fill="#FBBF24" />
            <Text
              className="text-white text-[12px]"
              style={{ fontFamily: "Peachi-Bold" }}
            >
              {(member.pointsBalance ?? 0).toLocaleString()} pts
            </Text>
          </Pressable>
        )}

        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            router.push("/store");
          }}
          className="flex-row items-center gap-1.5 mt-4 active:opacity-70"
        >
          <MapPin size={14} color="rgba(255,255,255,0.7)" />
          <Text className="text-white text-sm font-bold flex-1">
            {outletName ?? "Select pickup outlet"}
          </Text>
          <ChevronRight size={16} color="rgba(255,255,255,0.7)" />
        </Pressable>
      </View>

      <ScrollView contentContainerClassName="pb-40">
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

        {/* Your usual — pulls regulars straight to checkout, retention-led */}
        {phone && (recent.data?.length ?? 0) > 0 && (
          <View className="px-4 mt-5">
            <View className="flex-row items-center justify-between mb-3">
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
            <View className="gap-2">
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
                  className="bg-surface rounded-2xl border border-border p-2.5 flex-row items-center gap-3 active:opacity-70"
                  style={{
                    shadowColor: "#000",
                    shadowOpacity: 0.04,
                    shadowRadius: 6,
                    shadowOffset: { width: 0, height: 2 },
                  }}
                >
                  {item.image_url ? (
                    <Image
                      source={{ uri: item.image_url }}
                      style={{ width: 56, height: 56, borderRadius: 12 }}
                      resizeMode="cover"
                    />
                  ) : (
                    <View
                      className="bg-primary/10 items-center justify-center"
                      style={{ width: 56, height: 56, borderRadius: 12 }}
                    >
                      <Coffee size={20} color="#C05040" strokeWidth={1.5} />
                    </View>
                  )}
                  <View className="flex-1">
                    <Text
                      className="text-espresso text-[14px]"
                      style={{ fontFamily: "Peachi-Bold" }}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    <Text
                      className="text-muted-fg text-[11px] mt-0.5"
                      style={{ fontFamily: "SpaceGrotesk_500Medium" }}
                    >
                      Ordered {item.timesOrdered}× · {formatPrice(item.price)}
                    </Text>
                  </View>
                  <View
                    className="bg-espresso rounded-full items-center justify-center"
                    style={{ width: 32, height: 32 }}
                  >
                    <Text className="text-white text-base">+</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* Rewards available — only show what user can redeem right now */}
        {affordableRewards.length > 0 && (
          <View className="mt-6">
            <View className="flex-row items-center justify-between mb-3 px-4">
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
                  className="w-44 bg-surface rounded-2xl border border-border overflow-hidden active:opacity-70"
                  style={{
                    shadowColor: "#000",
                    shadowOpacity: 0.04,
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
                        <Gift size={28} color="#C05040" strokeWidth={1.5} />
                      </View>
                    )}
                  </View>
                  <View className="p-3">
                    <Text
                      className="text-espresso text-[13px]"
                      style={{ fontFamily: "Peachi-Bold" }}
                      numberOfLines={1}
                    >
                      {r.name}
                    </Text>
                    <Text
                      className="text-muted-fg text-[11px] mt-0.5"
                      numberOfLines={1}
                      style={{ fontFamily: "SpaceGrotesk_500Medium" }}
                    >
                      {formatRewardValue(r)}
                    </Text>
                    <View className="flex-row items-center gap-1 mt-2">
                      <Sparkles size={10} color="#C05040" strokeWidth={2.5} fill="#FBBF24" />
                      <Text
                        className="text-primary text-[11px]"
                        style={{ fontFamily: "Peachi-Bold" }}
                      >
                        {r.points_required.toLocaleString()} pts
                      </Text>
                    </View>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Hero promo — backoffice-driven via promo_banner setting. Trimmed
            from the previous full-bleed hero so retention sections breathe. */}
        {promo.enabled && (promo.headline || promo.image_url) && (
          <Pressable
            onPress={onPromoTap}
            className="mx-4 mt-6 bg-espresso rounded-3xl overflow-hidden active:opacity-90"
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

        {/* Quick Actions */}
        <View className="flex-row gap-3 px-4 mt-4">
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

        {/* Best Sellers */}
        {featured.length > 0 && (
          <View className="px-4 mt-6">
            <View className="flex-row items-center justify-between mb-3">
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
                    <View className="aspect-[3/4] bg-background">
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
                        className="text-espresso font-bold text-[13px]"
                        numberOfLines={2}
                      >
                        {p.name}
                      </Text>
                      <Text
                        className="text-primary font-black text-sm mt-1.5"
                        style={{ fontFamily: "Peachi-Bold" }}
                      >
                        {formatPrice(p.price)}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {(outlets.isLoading || menu.isLoading) && (
          <View className="py-10 items-center">
            <ActivityIndicator color="#C05040" />
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
