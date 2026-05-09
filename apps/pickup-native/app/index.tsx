import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, Image, RefreshControl, Alert } from "react-native";
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
  fetchTier,
  rewardUrgencyLabel,
  type Reward,
  type OrderHistoryEntry,
  type MemberTier,
} from "../lib/rewards";
import { SafeBoundary } from "../components/SafeBoundary";
import { TierHero } from "../components/TierHero";
import { RewardTicket } from "../components/RewardTicket";
import { tierStyle } from "../lib/tier-styles";
import { getSetting, type Settings } from "../lib/settings";
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
  const addToCart = useApp((s) => s.addToCart);
  const clearCart = useApp((s) => s.clearCart);
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

  // Recently-collected order — drives the "How was it?" prompt on home
  // for 24h after pickup. Client-side detection (no push backend) so the
  // affordance survives app reopens and lets the customer re-order with
  // one tap. Only shown when there's no active order in flight (so the
  // active-order banner takes priority).
  const recentlyCollected = (() => {
    if (activeOrder) return null;
    const list = orders.data ?? [];
    const TWENTY_FOUR_H = 24 * 60 * 60 * 1000;
    const now = Date.now();
    // Walk newest-first looking for a completed/ready that finished in
    // the last 24h. We treat completed_at when present, else fall back
    // to created_at + a fudge (some orders only have created_at on the
    // history shape).
    for (const o of list) {
      const s = (o.status ?? "").toLowerCase();
      if (s !== "completed" && s !== "ready") continue;
      const finishedAt = (o as { completed_at?: string }).completed_at
        ? new Date((o as { completed_at: string }).completed_at).getTime()
        : new Date(o.created_at).getTime();
      if (now - finishedAt < TWENTY_FOUR_H) return o;
    }
    return null;
  })();

  const onReorderRecent = () => {
    if (!recentlyCollected) return;
    // Build a productId → image_url map from the menu so we can
    // backfill images on order_items (which don't store the image).
    // Without this, reordered lines show the broken-image fallback in
    // the cart.
    const imageByProduct = new Map<string, string>();
    for (const p of menu.data?.products ?? []) {
      if (p.image_url) imageByProduct.set(p.id, p.image_url);
    }
    const apply = () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (cart.length > 0) clearCart();
      for (const it of recentlyCollected.order_items) {
        // Server stores order_items.modifiers as {selections:[...]} —
        // older rows may be a flat array. Handle both.
        const rawMods = it.modifiers as
          | { selections?: Array<{ groupName?: string; label?: string; priceDelta?: number }> }
          | Array<{ groupName?: string; label?: string; priceDelta?: number }>
          | null
          | undefined;
        const modList = Array.isArray(rawMods)
          ? rawMods
          : rawMods?.selections ?? [];
        addToCart({
          productId: it.product_id ?? "",
          name: it.product_name ?? "Item",
          image: imageByProduct.get(it.product_id ?? ""),
          basePrice: (it.unit_price ?? 0) / 100,
          quantity: it.quantity ?? 1,
          modifiers: modList.map((m) => ({
            groupId: "",
            groupName: m.groupName ?? "",
            optionId: "",
            label: m.label ?? "",
            priceDelta: (m.priceDelta ?? 0) / 100,
          })),
          specialInstructions: undefined,
          totalPrice: (it.item_total ?? it.unit_price ?? 0) / 100,
        });
      }
      router.push("/cart");
    };

    if (cart.length === 0) {
      apply();
      return;
    }
    // Cart already has items — confirm before clobbering, same pattern
    // the Orders tab uses. Previously this routed to /orders which was
    // surprising; the customer expected the home reorder to either land
    // in /cart or ask first.
    Alert.alert(
      "Replace your cart?",
      `You have ${cart.length} ${cart.length === 1 ? "item" : "items"} in your cart already. Re-ordering will replace them.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Replace", style: "destructive", onPress: apply },
      ],
    );
  };

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

  // onPromoTap removed alongside the in-hero promo strip. The promo
  // setting still drives the empty-state hero copy further down; if we
  // ever bring back an inline promo CTA, restore the cta_target switch
  // from git (commit ffef593 has the last version).

  // Tier-driven palette — gradient + accent. Falls back to the
  // espresso baseline when no tier is loaded (signed out / fetch
  // pending / fetch failed).
  const ts = tierStyle(tier);
  const showTierEyebrow = !!tier?.tier_slug;

  return (
    <View className="flex-1 bg-background">
      {/* Tier-themed hero — gradient + ghosted bean ornament + curved
          bottom edge that drapes into the body. Tier identity carries
          through the eyebrow ("PLATINUM · 2× PTS") rather than via a
          separate card, keeping the header dense and clean. */}
      <TierHero
        style={ts}
        paddingTop={insets.top + 14}
        paddingBottom={32}
        variant="compact"
      >
        {/* Premium hero treatment — single editorial moment ("Hi, Ammar")
            with everything else demoted into one quiet meta line. Brand
            mark gets its own row at full presence; cart sits alone
            top-right. More breathing room (paddings ↑) so the hero
            feels considered rather than packed. */}
        <View className="flex-row items-start">
          <Image
            source={require("../assets/icon.png")}
            style={{ width: 28, height: 28, borderRadius: 6 }}
            resizeMode="cover"
          />
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => router.push("/cart")}
            className="relative p-1 active:opacity-60"
            hitSlop={12}
          >
            <ShoppingCart size={22} color={ts.textColor === "#FFFFFF" ? "rgba(255,255,255,0.85)" : ts.textColor} />
            {cartCount(cart) > 0 && (
              <View
                className="absolute rounded-full items-center justify-center"
                style={{ top: -2, right: -2, width: 16, height: 16, backgroundColor: ts.textColor }}
              >
                <Text
                  className="text-[9px]"
                  style={{ fontFamily: "Peachi-Bold", color: ts.gradient[1] }}
                >
                  {cartCount(cart)}
                </Text>
              </View>
            )}
          </Pressable>
        </View>

        {/* Greeting — the editorial moment. Bigger Peachi, more
            vertical room above and below than the earlier draft. */}
        <Text
          className="mt-5"
          style={{
            color: ts.textColor,
            fontFamily: "Peachi-Bold",
            fontSize: 28,
            lineHeight: 32,
          }}
          numberOfLines={1}
        >
          {firstName
            ? `Hi, ${firstName}`
            : showTierEyebrow
            ? "Welcome"
            : greeting}
        </Text>

        {/* Demoted meta line — tier · multiplier · balance · next-reward
            all in one quiet small-caps row. Tappable into Rewards so
            the loyalty affordance survives the demotion. */}
        {member && (
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              router.push("/rewards");
            }}
            hitSlop={6}
            className="active:opacity-70 self-start"
            style={{ marginTop: 6 }}
          >
            <Text
              style={{
                color: ts.mutedColor,
                fontFamily: "SpaceGrotesk_500Medium",
                fontSize: 11,
                letterSpacing: 1.4,
                textTransform: "uppercase",
              }}
              numberOfLines={1}
            >
              {(() => {
                const parts: string[] = [];
                if (showTierEyebrow) {
                  parts.push(ts.displayName);
                  parts.push(`${tier?.tier_multiplier ?? 1}×`);
                }
                parts.push(`${(member.pointsBalance ?? 0).toLocaleString()} pts`);
                if (nextReward && pointsToNext > 0) {
                  parts.push(`${pointsToNext.toLocaleString()} to ${nextReward.name}`);
                }
                return parts.join(" · ");
              })()}
            </Text>
          </Pressable>
        )}

        {/* Outlet pill — extra breathing room above; ETA dropped per
            redesign so the row is shorter and reads at a glance. */}
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            router.push("/store");
          }}
          className="flex-row items-center gap-1.5 mt-5 self-start active:opacity-70"
        >
          <MapPin size={15} color={ts.mutedColor} />
          <Text
            className="text-[15px]"
            style={{ fontFamily: "Peachi-Bold", color: ts.textColor }}
          >
            {outletName ?? "Select pickup outlet"}
          </Text>
          {currentOutlet && (() => {
            const dot = !currentOutlet.is_open
              ? { bg: "#EF4444", label: "Closed" }
              : currentOutlet.is_busy
              ? { bg: "#F59E0B", label: "Busy" }
              : { bg: "#22C55E", label: null };
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
                    className="text-[11px]"
                    style={{ fontFamily: "SpaceGrotesk_600SemiBold", color: ts.mutedColor }}
                  >
                    {dot.label}
                  </Text>
                )}
              </>
            );
          })()}
          <ChevronRight size={14} color={ts.mutedColor} />
        </Pressable>

        {/* Promo strip removed — the hero now ends at the outlet pill.
            Promo content from backoffice still drives the standalone
            empty-state hero further down (when nothing else fills the
            screen) and the future image-led campaign card if we add
            one. Customers reach offers via Rewards or in-cart prompts. */}
      </TierHero>

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

        {/* "How was it?" — visible for 24h after a pickup is collected.
            Replaces the dead air between collected order and the next
            visit; one-tap reorder repopulates the cart with the same
            items so the customer can re-confirm and place again. Hidden
            when an active order exists (active banner takes priority). */}
        {recentlyCollected && (
          <View
            className="mx-4 mt-4 rounded-2xl"
            style={{
              backgroundColor: "#FBEBE8",
              borderWidth: 1,
              borderColor: "rgba(192, 80, 64, 0.18)",
              paddingHorizontal: 14,
              paddingVertical: 12,
            }}
          >
            <View className="flex-row items-center gap-3">
              <View
                className="w-9 h-9 rounded-full items-center justify-center"
                style={{ backgroundColor: "rgba(192, 80, 64, 0.15)" }}
              >
                <Coffee size={18} color="#C05040" strokeWidth={2} />
              </View>
              <View className="flex-1">
                <Text
                  className="text-[10px] uppercase"
                  style={{
                    fontFamily: "SpaceGrotesk_700Bold",
                    color: "#C05040",
                    letterSpacing: 1.5,
                  }}
                >
                  How was it?
                </Text>
                <Text
                  className="text-espresso text-[14px] mt-0.5"
                  style={{ fontFamily: "Peachi-Bold" }}
                  numberOfLines={1}
                >
                  Reorder · #{recentlyCollected.order_number}
                </Text>
              </View>
              <Pressable
                onPress={onReorderRecent}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={`Reorder #${recentlyCollected.order_number}`}
                className="bg-espresso rounded-full active:opacity-80"
                style={{ paddingHorizontal: 14, paddingVertical: 7 }}
              >
                <Text
                  className="text-white text-[12px]"
                  style={{ fontFamily: "Peachi-Bold" }}
                >
                  Order again
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Rewards lead the fold — what's redeemable right now is the most
            time-sensitive surface (urgency labels, stock countdowns), so it
            beats Usual to the user's eye. Usual still ranks above discovery
            (Best Sellers) since retention beats acquisition.
            (Reverted from the consolidated <ForYouStrip /> after testing
            preferred the separate sections — kept that component in the
            tree as dead code for now in case we revisit.) */}
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
                <RewardTicket
                  key={r.id}
                  reward={r}
                  onPress={() => router.push("/rewards")}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {/* Your usual — surfaces regulars with a one-tap path into the menu's
            "Usual" tab, so customers land on a focused list of their go-tos
            with full modifier flow available. */}
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
                  {/* Matches Best Sellers card geometry exactly — same
                      176w, same 4/5 image aspect, same paddings, same
                      14px name and 16px price. Both product strips on
                      home now share one card system. */}
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
          !recentlyCollected &&
          !(phone && (recent.data?.length ?? 0) > 0) &&
          affordableRewards.length === 0 &&
          !(promo.enabled && promo.headline) &&
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

        {/* Best Sellers (skeleton while menu loads, real cards once data is in) */}
        {menu.isLoading && featured.length === 0 ? (
          <View className="px-4 mt-5">
            <View
              className="bg-surface/60 rounded-md mb-2"
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
                  className="w-44 bg-surface rounded-2xl border border-border overflow-hidden"
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
