import { Platform, View, Text, Pressable, ScrollView, Image } from "react-native";
import { Stack, router } from "expo-router";
import { Trash2, Gift, X, Coffee, ChevronRight } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "@/lib/haptics";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp, cartTotal } from "../lib/store";
import { formatPrice } from "../lib/api";
import { cloudinaryThumb } from "../lib/image";
import {
  calcRewardDiscount,
  fetchTier,
} from "../lib/rewards";
import { useEvaluatePromotions } from "../lib/use-evaluate-promotions";
import { fetchMenu } from "../lib/menu";
import { getSetting } from "../lib/settings";
import { supabase, type Outlet } from "../lib/supabase";
import { EspressoHeader } from "../components/EspressoHeader";
import { ProductImage } from "../components/ProductImage";

/**
 * Cart scroll topology — platform-split, same rationale as Home's hero.
 *
 * NATIVE (the app): the header and the summary / checkout footer are
 * FIXED; only the list of items scrolls between them. Long-standing
 * native cart feel.
 *
 * WEB (the order.celsiuscoffee.com PWA): the whole screen scrolls as one
 * (#155/#156) — a mobile browser's short viewport plus the pinned footer
 * intercepting touches made the cart feel un-scrollable.
 *
 * #155/#156 unified both onto the web behaviour, which leaked the
 * scrolling header + un-pinned footer onto native. Expressed as two
 * wrappers so one markup tree serves both; exactly one is a real
 * ScrollView per platform, the other a transparent passthrough:
 *
 *   web    → CartScrollFrame = ScrollView (header+items+summary) | CartItemsScroll = passthrough
 *   native → CartScrollFrame = passthrough                        | CartItemsScroll = ScrollView (flex-1, items only)
 *
 * On native the flex-1 items ScrollView naturally fills the space between
 * the frozen header and the footer (column layout) — no absolute
 * positioning or height measurement needed. Module-scoped so their
 * identity is stable across renders (no remount / lost scroll position).
 */
function CartScrollFrame({ children }: { children: ReactNode }) {
  if (Platform.OS === "web") return <ScrollView>{children}</ScrollView>;
  return <>{children}</>;
}

function CartItemsScroll({ children }: { children: ReactNode }) {
  if (Platform.OS === "web") return <>{children}</>;
  return (
    <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}

export default function Cart() {
  const insets = useSafeAreaInsets();
  const cart = useApp((s) => s.cart);
  const updateQuantity = useApp((s) => s.updateQuantity);
  const removeFromCart = useApp((s) => s.removeFromCart);
  const outletId = useApp((s) => s.outletId);
  const outletName = useApp((s) => s.outletName);
  const appliedReward = useApp((s) => s.appliedReward);
  const setAppliedReward = useApp((s) => s.setAppliedReward);
  const setReservedVoucher = useApp((s) => s.setReservedVoucher);
  const member = useApp((s) => s.member);

  // Re-poll the chosen outlet's open/busy state every 30s while this
  // screen is mounted. If they flipped to closed mid-cart, we surface
  // a banner so the customer knows BEFORE they hit checkout and get a
  // 422 from the order API. Cheap query — single row by store_id.
  const outletQ = useQuery<Outlet | null>({
    queryKey: ["outlet-status", outletId],
    queryFn: async () => {
      if (!outletId) return null;
      const { data } = await supabase
        .from("outlet_settings")
        .select("store_id,name,address,lat,lng,is_open,is_busy,pickup_time_mins")
        .eq("store_id", outletId)
        .maybeSingle();
      return (data as Outlet | null) ?? null;
    },
    enabled: !!outletId && cart.length > 0,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const outletClosed = outletQ.data && outletQ.data.is_open === false;

  const subtotal = cartTotal(cart);
  // Cap the displayed discount at the subtotal — otherwise an RM5
  // reward applied to a RM3 cart shows a "−RM5.00" line under a
  // RM3.00 subtotal which reads as a bug to the customer. Server
  // already clamps the actual charge.
  const rewardDiscount = Math.min(calcRewardDiscount(appliedReward, cart, subtotal), subtotal);

  // Promotion engine preview. Uses the shared useEvaluatePromotions
  // hook so the cart screen and the checkout screen share one
  // network round-trip via React Query's queryKey dedup. Without
  // this each screen fired its own debounced fetch (~800ms each via
  // the order→loyalty proxy), and the cart→checkout transition felt
  // laggy. Now the second screen is instant when the cart hasn't
  // changed.
  //
  // Tier loads in parallel; eval holds until it's available so
  // tier-perk discounts layer correctly.
  const loyaltyId = useApp((s) => s.loyaltyId);
  const tierQ = useQuery({
    queryKey: ["tier", loyaltyId],
    queryFn: () => (loyaltyId ? fetchTier(loyaltyId) : Promise.resolve(null)),
    enabled: !!loyaltyId,
    staleTime: 60_000,
  });
  const memberTierId = tierQ.data?.tier_id ?? null;
  const promoEvalReady = !loyaltyId || !tierQ.isLoading || !!tierQ.data;
  const { data: promoEval } = useEvaluatePromotions({
    memberTierId,
    enabled: promoEvalReady,
  });

  const promoDiscount = promoEval?.total_discount ?? 0;
  // Customer's reward voucher comes off AFTER promo engine has done
  // its work — same order checkout uses.
  const totalAfterPromo = Math.max(0, subtotal - promoDiscount);
  const discount = Math.min(rewardDiscount, totalAfterPromo);
  const grandTotal = Math.max(0, totalAfterPromo - discount);

  const [minOrder, setMinOrder] = useState(0);
  useEffect(() => {
    getSetting("min_order_value").then((s) => setMinOrder(s.rm));
  }, []);
  const belowMin = minOrder > 0 && subtotal < minOrder;

  // Best sellers used to fill the empty-cart state with concrete tap
  // targets. Only loaded when the cart is actually empty so we don't
  // pay for the menu fetch on every cart visit.
  const menu = useQuery({
    queryKey: ["menu", outletId],
    queryFn: () => fetchMenu(outletId),
    enabled: cart.length === 0,
    staleTime: 5 * 60_000,
  });
  const bestSellers = (menu.data?.products ?? [])
    .filter((p) => p.is_featured && p.is_available)
    .slice()
    .sort((a, b) =>
      (a.featured_position ?? 9999) - (b.featured_position ?? 9999)
      || a.name.localeCompare(b.name)
    )
    .slice(0, 4);

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />

      {cart.length === 0 ? (
        // Empty cart should sell, not just say "empty". Espresso hero
        // mirrors the active-order banner / promo card so visual rhythm
        // is consistent with everywhere else the app pulls customers
        // toward action. A row of best-seller thumbnails below gives
        // them concrete tap targets — most empty-cart customers are
        // first-timers or returning after a flush.
        <ScrollView contentContainerClassName="pb-12">
          <EspressoHeader title="Your cart" subtitle={outletName ? `Pickup from ${outletName}` : undefined} showBack showCart={false} />
          <View
            className="mx-4 mt-4 bg-espresso rounded-2xl overflow-hidden"
            style={{
              shadowColor: "#160800",
              shadowOpacity: 0.18,
              shadowRadius: 14,
              shadowOffset: { width: 0, height: 6 },
            }}
          >
            <View className="px-5 py-6 items-start">
              <View
                className="bg-primary items-center justify-center mb-3"
                style={{ width: 48, height: 48, borderRadius: 24 }}
              >
                <Coffee size={24} color="#FFFFFF" strokeWidth={2} />
              </View>
              <Text
                className="text-amber-400 text-[10px] uppercase tracking-widest"
                style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 2 }}
              >
                Cart's feeling thirsty
              </Text>
              <Text
                className="text-white text-2xl mt-1"
                style={{ fontFamily: "Peachi-Bold" }}
              >
                Let's brew something
              </Text>
              <Text
                className="text-white/70 text-[12px] mt-1.5"
                style={{ fontFamily: "SpaceGrotesk_500Medium" }}
              >
                Tap a favourite below or browse the full menu.
              </Text>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  router.replace("/menu");
                }}
                className="bg-white rounded-full mt-4 px-5 py-2.5 flex-row items-center gap-1.5 active:opacity-80"
              >
                <Text
                  className="text-espresso text-[13px]"
                  style={{ fontFamily: "Peachi-Bold" }}
                >
                  See what's brewing
                </Text>
                <ChevronRight size={14} color="#1A0200" />
              </Pressable>
            </View>
          </View>

          {bestSellers.length > 0 && (
            <View className="mt-6">
              <View className="px-4 mb-2">
                <Text
                  className="text-espresso text-[14px] uppercase"
                  style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 1.5 }}
                >
                  Start with these
                </Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerClassName="gap-3 px-4"
              >
                {bestSellers.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => {
                      Haptics.selectionAsync();
                      router.push({ pathname: "/product/[id]", params: { id: p.id } });
                    }}
                    className="w-40 bg-surface rounded-2xl border border-border overflow-hidden active:opacity-70"
                    style={{
                      shadowColor: "#000",
                      shadowOpacity: 0.06,
                      shadowRadius: 8,
                      shadowOffset: { width: 0, height: 3 },
                    }}
                  >
                    <ProductImage
                      uri={cloudinaryThumb(p.image_url, { size: 160 })}
                      width={160}
                      height={200}
                    />
                    <View className="px-3 py-2.5">
                      <Text
                        className="text-espresso text-[13px]"
                        style={{ fontFamily: "Peachi-Bold" }}
                        numberOfLines={1}
                      >
                        {p.name}
                      </Text>
                      <View className="flex-row items-center justify-between mt-1">
                        <Text
                          className="text-primary text-[14px]"
                          style={{ fontFamily: "Peachi-Bold" }}
                        >
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
          )}
        </ScrollView>
      ) : (
        <>
          <CartScrollFrame>
            <EspressoHeader title="Your cart" subtitle={outletName ? `Pickup from ${outletName}` : undefined} showBack showCart={false} />
            <CartItemsScroll>
            <View className="px-4 py-4" style={{ gap: 12 }}>
            {cart.map((item) => (
              // Whole row tappable → opens the product page in edit
              // mode so customers can change modifiers / notes / qty
              // without removing + re-adding. The qty +/- and trash
              // Pressables below stop the press from bubbling up so
              // tapping them still does just the inline action.
              <Pressable
                key={item.cartId}
                onPress={() => {
                  Haptics.selectionAsync();
                  router.push({
                    pathname: "/product/[id]",
                    params: { id: item.productId, cartId: item.cartId },
                  });
                }}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${item.name}`}
                accessibilityHint="Opens the product page to change modifiers, quantity, or notes"
                className="bg-surface rounded-2xl border border-border p-3 flex-row gap-3 active:opacity-80"
                style={{
                  shadowColor: "#000",
                  shadowOpacity: 0.04,
                  shadowRadius: 6,
                  shadowOffset: { width: 0, height: 2 },
                }}
              >
                <ProductImage
                  uri={cloudinaryThumb(item.image, { size: 72 })}
                  width={72}
                  height={72}
                  borderRadius={14}
                />

                <View className="flex-1 min-w-0">
                  <View className="flex-row justify-between items-start gap-2">
                    <Text
                      className="text-espresso text-[15px] flex-1"
                      style={{ fontFamily: "Peachi-Bold", lineHeight: 19 }}
                      numberOfLines={2}
                    >
                      {item.name}
                    </Text>
                    <Text
                      className="text-[14px]"
                      style={{ fontFamily: "Peachi-Bold", color: "#B91C1C" /* alert red — item price */ }}
                      numberOfLines={1}
                    >
                      {formatPrice(item.totalPrice)}
                    </Text>
                  </View>

                  {item.modifiers.length > 0 && (
                    <Text
                      className="text-muted-fg text-[12px] mt-0.5"
                      style={{ fontFamily: "SpaceGrotesk_400Regular" }}
                      numberOfLines={2}
                    >
                      {item.modifiers.map((m) => m.label).join(" · ")}
                    </Text>
                  )}
                  {item.specialInstructions && (
                    <Text
                      className="text-muted-fg text-[11px] mt-0.5 italic"
                      style={{ fontFamily: "SpaceGrotesk_400Regular" }}
                      numberOfLines={1}
                    >
                      Note: {item.specialInstructions}
                    </Text>
                  )}

                  <View className="flex-row justify-between items-center mt-2">
                    <View className="flex-row items-center gap-2">
                      <Pressable
                        onPress={(e) => {
                          // Stop the press from bubbling to the row
                          // Pressable that wraps this card — otherwise
                          // tapping − would also open the product
                          // editor, which is jarring.
                          e.stopPropagation();
                          Haptics.selectionAsync();
                          updateQuantity(item.cartId, item.quantity - 1);
                        }}
                        // Disabled at qty 1 — used to silently remove the
                        // line, which surprised customers tapping − to
                        // "fix" the count. Removal now goes through the
                        // explicit trash button.
                        disabled={item.quantity <= 1}
                        className="w-7 h-7 rounded-full bg-background border border-border items-center justify-center active:opacity-70"
                        style={{ opacity: item.quantity <= 1 ? 0.4 : 1 }}
                        hitSlop={12}
                        accessibilityRole="button"
                        accessibilityLabel={`Decrease ${item.name}`}
                        accessibilityState={{ disabled: item.quantity <= 1 }}
                      >
                        <Text className="text-espresso">−</Text>
                      </Pressable>
                      <Text
                        className="text-espresso w-5 text-center font-bold"
                        accessibilityLabel={`Quantity ${item.quantity}`}
                      >
                        {item.quantity}
                      </Text>
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          Haptics.selectionAsync();
                          updateQuantity(item.cartId, item.quantity + 1);
                        }}
                        className="w-7 h-7 rounded-full bg-espresso items-center justify-center active:opacity-70"
                        hitSlop={12}
                        accessibilityRole="button"
                        accessibilityLabel={`Increase ${item.name}`}
                      >
                        <Text className="text-white">+</Text>
                      </Pressable>
                    </View>
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation();
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                        removeFromCart(item.cartId);
                      }}
                      className="active:opacity-70 p-1"
                      hitSlop={12}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${item.name} from cart`}
                    >
                      <Trash2 size={16} color="#8E8E93" />
                    </Pressable>
                  </View>
                </View>
              </Pressable>
            ))}
            </View>
            </CartItemsScroll>

          {/* Summary + checkout footer. NATIVE: sits OUTSIDE the items
              ScrollView (see CartItemsScroll) so it's pinned at the
              bottom — the column layout reserves its height and the
              items scroll above it. WEB: rendered inside the single
              CartScrollFrame ScrollView so it flows at the end and the
              whole screen scrolls as one (#156 — a pinned footer
              intercepted touches and made the mobile-browser cart feel
              un-scrollable). */}
          <View
            className="px-4 pt-3 border-t border-border"
            style={{ paddingBottom: insets.bottom + 12 }}
          >
            {appliedReward ? (
              <View
                style={{ backgroundColor: "rgba(185,28,28,0.10)" }}
                className="rounded-2xl px-3 py-2 mb-3 flex-row items-center gap-2"
              >
                <View
                  style={{ backgroundColor: "#B91C1C" }}
                  className="w-8 h-8 rounded-full items-center justify-center"
                >
                  <Gift size={14} color="#FFFFFF" strokeWidth={2} />
                </View>
                <View className="flex-1">
                  <Text
                    className="text-[13px]"
                    style={{ fontFamily: "Peachi-Bold", color: "#B91C1C" }}
                    numberOfLines={1}
                  >
                    {appliedReward.name}
                  </Text>
                  <Text
                    className="text-[11px]"
                    style={{ fontFamily: "SpaceGrotesk_500Medium", color: "rgba(185,28,28,0.80)" }}
                  >
                    {discount > 0
                      ? `Reward applied · −${formatPrice(discount)}`
                      : "Reward applied — discount at checkout"}
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    setAppliedReward(null);
                    setReservedVoucher(null);
                  }}
                  hitSlop={12}
                  className="active:opacity-70"
                >
                  <X size={16} color="#B91C1C" />
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  router.push("/rewards?tab=vouchers" as never);
                }}
                style={{ borderColor: "rgba(185,28,28,0.40)" }}
                className="bg-surface border border-dashed rounded-2xl px-3 py-2 mb-3 flex-row items-center gap-2 active:opacity-70"
              >
                <Gift size={16} color="#B91C1C" strokeWidth={1.75} />
                <Text
                  className="text-[13px] flex-1"
                  style={{ fontFamily: "Peachi-Bold", color: "#B91C1C" }}
                >
                  Apply a reward
                </Text>
              </Pressable>
            )}

            <View className="mb-1 flex-row justify-between items-center">
              <Text className="text-muted-fg text-[13px]">Subtotal</Text>
              <Text
                className="text-espresso text-[14px]"
                style={{ fontFamily: "SpaceGrotesk_500Medium" }}
              >
                {formatPrice(subtotal)}
              </Text>
            </View>
            {/* Auto + tier-perk + combo + sale promotions. Mirrors the
                checkout breakdown so cart preview lines up with the
                final number. */}
            {(promoEval?.discounts ?? []).map((d) => (
              <View
                key={d.promotion_id}
                className="mb-1 flex-row justify-between items-center"
              >
                <Text
                  className="text-[13px] flex-1"
                  numberOfLines={1}
                  style={{ paddingRight: 8, color: "#B91C1C" /* alert red — discount */ }}
                >
                  {d.promotion_name}
                </Text>
                <Text
                  className="text-[14px]"
                  style={{ fontFamily: "SpaceGrotesk_500Medium", color: "#B91C1C" }}
                >
                  −{formatPrice(d.discount_amount)}
                </Text>
              </View>
            ))}
            {discount > 0 && (
              <View className="mb-1 flex-row justify-between items-center">
                <Text className="text-[13px]" style={{ color: "#B91C1C" }}>
                  Reward discount
                </Text>
                <Text
                  className="text-[14px]"
                  style={{ fontFamily: "SpaceGrotesk_500Medium", color: "#B91C1C" }}
                >
                  −{formatPrice(discount)}
                </Text>
              </View>
            )}
            <View className="mb-1 flex-row justify-between items-center">
              <Text className="text-espresso text-[15px]" style={{ fontFamily: "Peachi-Bold" }}>
                Total
              </Text>
              <Text
                className="text-espresso text-lg"
                style={{ fontFamily: "Peachi-Bold" }}
              >
                {formatPrice(grandTotal)}
              </Text>
            </View>
            {/* Points-earned preview — quiet motivator showing what the
                customer will gain on this order. Only renders for signed-
                in members and when the total is non-zero. Server-side
                points calc is the source of truth; this is just an
                estimate (1 pt per RM1, ignores tier multiplier so we
                never overpromise). */}
            {member && grandTotal > 0 && (
              <View className="mb-3 flex-row justify-between items-center">
                <Text
                  className="text-muted-fg text-[11px]"
                  style={{ fontFamily: "SpaceGrotesk_500Medium" }}
                >
                  You'll earn
                </Text>
                <Text
                  className="text-muted-fg text-[11px]"
                  style={{ fontFamily: "SpaceGrotesk_700Bold" }}
                >
                  +{Math.floor(grandTotal)} pts
                </Text>
              </View>
            )}
            {/* Outlet flipped to closed mid-cart — show a banner + block
                checkout. Customers got a 422 from /api/orders before
                without ever knowing the outlet had closed since they
                started shopping. */}
            {outletClosed && (
              <View
                className="rounded-2xl mb-3 px-3 py-3 flex-row items-start gap-2.5"
                style={{ backgroundColor: "rgba(162, 73, 44, 0.10)", borderWidth: 1, borderColor: "rgba(162, 73, 44, 0.25)" }}
              >
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: "#A2492C",
                    marginTop: 6,
                  }}
                />
                <View className="flex-1">
                  <Text
                    className="text-espresso text-[13px]"
                    style={{ fontFamily: "Peachi-Bold" }}
                  >
                    {outletName ?? "This outlet"} just closed
                  </Text>
                  <Text
                    className="text-muted-fg text-[11px] mt-0.5"
                    style={{ fontFamily: "SpaceGrotesk_500Medium" }}
                  >
                    Pick another outlet to continue, or come back when we open.
                  </Text>
                </View>
                <Pressable
                  onPress={() => router.push("/store")}
                  hitSlop={12}
                  accessibilityLabel="Pick another outlet"
                  className="active:opacity-70"
                >
                  <Text
                    className="text-primary text-[12px]"
                    style={{ fontFamily: "SpaceGrotesk_700Bold" }}
                  >
                    Switch
                  </Text>
                </Pressable>
              </View>
            )}
            {belowMin && (
              <Text
                className="text-primary text-[12px] text-center mb-2"
                style={{ fontFamily: "SpaceGrotesk_500Medium" }}
              >
                Add {formatPrice(minOrder - subtotal)} more to checkout (min {formatPrice(minOrder)})
              </Text>
            )}
            <Pressable
              disabled={belowMin || !!outletClosed}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                router.push("/checkout");
              }}
              className={`rounded-full py-4 items-center ${
                belowMin || outletClosed ? "bg-primary/40" : "bg-primary active:opacity-80"
              }`}
            >
              <Text className="text-white font-bold text-base">
                {outletClosed ? "Outlet closed" : "Continue to checkout"}
              </Text>
            </Pressable>
          </View>
          </CartScrollFrame>
        </>
      )}
    </View>
  );
}
