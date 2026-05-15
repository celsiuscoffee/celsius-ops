import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, Alert } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, CreditCard } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useStripe } from "@stripe/stripe-react-native";
import { fetchOrder } from "../../lib/menu";
import { formatPrice } from "../../lib/api";
import { useApp } from "../../lib/store";
import { EspressoHeader } from "../../components/EspressoHeader";
import { SwipeToCollect } from "../../components/SwipeToCollect";
import { OrderStepper } from "../../components/OrderStepper";
import { CelsiusLoader } from "../../components/CelsiusLoader";
import { MysteryBean } from "../../components/MysteryBean";
import { fetchPendingMysteryDrop, type MysteryDropRevealed } from "../../lib/rewards-v2";

const STATUS_INDEX: Record<string, number> = {
  pending: -1,
  paid: 0,
  preparing: 1,
  ready: 2,
  completed: 2,
};

export default function OrderStatus() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["order", id],
    queryFn: () => fetchOrder(id!),
    refetchInterval: 5000,
    enabled: !!id,
  });

  // Confirms pickup. Server validates the ready→completed transition,
  // so a stale client (still showing "ready" after staff already moved
  // the order) will get a 422 — surfaced via thrown error so the
  // SwipeToCollect bounces back instead of silently lying.
  const markCollected = async () => {
    if (!id) return;
    const res = await fetch(
      `https://order.celsiuscoffee.com/api/orders/${encodeURIComponent(id)}/status`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://order.celsiuscoffee.com",
          Referer: "https://order.celsiuscoffee.com/",
        },
        body: JSON.stringify({ status: "completed" }),
      }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || `HTTP ${res.status}`);
    }
    await queryClient.invalidateQueries({ queryKey: ["order", id] });
    await queryClient.invalidateQueries({ queryKey: ["order-history-home"] });
  };

  const statusIdx = STATUS_INDEX[data?.status ?? "pending"] ?? -1;
  const clearCart = useApp((s) => s.clearCart);
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  // Mystery Bean — surfaces only when the server has generated a drop
  // for this order (happens server-side on payment success). Polls
  // alongside the order so the scratch card appears within a few
  // seconds of payment landing. Hidden while pending payment.
  //
  // v3 of this flow. The previous attempts split state between the
  // child (local `revealed`) and the parent (a boolean "did we reveal
  // locally?") — which left a race window where the polling query
  // returned revealed:true at the same moment the user tapped, and
  // the section could vanish mid-animation. Now the PARENT owns the
  // reveal payload from the moment it lands. The child becomes a
  // pure presenter: pass prerevealed and it renders the reveal
  // directly. A remount can't lose the reward because the data lives
  // here, not in child local state.
  //
  // Three pieces of local state cooperate:
  //   - mysteryRevealed: the full reveal payload. Null until the
  //     customer taps Reveal and the server returns the outcome.
  //     Drives both "should we show?" and "what to show".
  //   - mysteryDismissed: flips true when the customer taps the post-
  //     reveal CTA (Got it / View in wallet). Only then does the card
  //     leave the screen.
  //   - mysteryFirstSeenId: the drop_id we first showed to the user. We
  //     pin to this so a later server response can't swap the reveal
  //     under the user's feet.
  const [mysteryRevealed, setMysteryRevealed] = useState<MysteryDropRevealed | null>(null);
  const [mysteryDismissed, setMysteryDismissed] = useState(false);
  const [mysteryFirstSeenId, setMysteryFirstSeenId] = useState<string | null>(null);
  const mysteryQ = useQuery({
    queryKey: ["mystery-drop", id],
    queryFn: () => fetchPendingMysteryDrop(id!),
    enabled:
      !!id &&
      data?.status !== "pending" &&
      !mysteryDismissed &&
      !mysteryRevealed,
    // Tight poll — the drop is minted server-side during confirm-stripe
    // and we want the reveal to appear within ~1 cycle of landing on
    // this screen, not the previous 6s gap that made it feel like a
    // late delivery instead of an instant reward.
    refetchInterval: 1500,
    refetchOnMount: "always",
  });
  // Pin to the first drop we saw so the card identity stays stable
  // across refetches. Effect-based — the previous queueMicrotask in
  // render path could miss in strict mode if React aborted the render
  // before the microtask drained.
  useEffect(() => {
    if (mysteryQ.data?.drop_id && !mysteryFirstSeenId) {
      setMysteryFirstSeenId(mysteryQ.data.drop_id);
    }
  }, [mysteryQ.data?.drop_id, mysteryFirstSeenId]);
  const dropId = mysteryFirstSeenId ?? mysteryQ.data?.drop_id ?? null;
  // Show the mystery section if (a) the server has produced a drop and
  // the customer hasn't revealed yet, OR (b) the customer revealed and
  // hasn't dismissed yet. The previous logic unmounted the component
  // as soon as the server confirmed the reveal, erasing the reward
  // animation and leaving the customer staring at empty space.
  const showMystery =
    !mysteryDismissed &&
    !!dropId &&
    (!!mysteryRevealed || (mysteryQ.data && !mysteryQ.data.revealed));
  const [retrying, setRetrying] = useState(false);

  // Re-mints a PaymentIntent for this pending order and re-opens the native
  // Stripe PaymentSheet. Same flow checkout.tsx uses on first place — this
  // is the retry path when the customer cancels the sheet or the first
  // attempt fails.
  const reopenStripe = async () => {
    if (!id) return;
    Haptics.selectionAsync();
    setRetrying(true);
    try {
      const piRes = await fetch(
        `https://order.celsiuscoffee.com/api/checkout/create-payment-intent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://order.celsiuscoffee.com",
            Referer: "https://order.celsiuscoffee.com/",
          },
          body: JSON.stringify({ orderId: id }),
        }
      );
      const piJson = (await piRes.json()) as {
        clientSecret?: string;
        paymentIntentId?: string;
        error?: string;
      };
      if (!piRes.ok || !piJson.clientSecret) {
        throw new Error(piJson.error || "Couldn't start Stripe payment");
      }

      const initRes = await initPaymentSheet({
        merchantDisplayName: "Celsius Coffee",
        paymentIntentClientSecret: piJson.clientSecret,
        applePay: { merchantCountryCode: "MY" },
        googlePay: { merchantCountryCode: "MY", currencyCode: "myr", testEnv: false },
        returnURL: "celsiuscoffee://stripe-redirect",
        allowsDelayedPaymentMethods: false,
      });
      if (initRes.error) throw new Error(initRes.error.message);

      const presentRes = await presentPaymentSheet();
      if (presentRes.error) {
        if (presentRes.error.code !== "Canceled") {
          Alert.alert("Payment failed", presentRes.error.message);
        }
        return;
      }

      // Success — call confirm-stripe so the order moves to preparing
      // before the next 5s React Query poll refetches.
      try {
        await fetch(
          `https://order.celsiuscoffee.com/api/orders/${encodeURIComponent(id)}/confirm-stripe`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: "https://order.celsiuscoffee.com",
              Referer: "https://order.celsiuscoffee.com/",
            },
            body: JSON.stringify({
              paymentIntentId:
                piJson.paymentIntentId ?? piJson.clientSecret.split("_secret_")[0],
            }),
          }
        );
      } catch {
        // Webhook is the backstop.
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      clearCart();
    } catch (e: any) {
      Alert.alert("Couldn't retry payment", e?.message ?? String(e));
    } finally {
      setRetrying(false);
    }
  };

  const isPendingPayment =
    data?.status === "pending" &&
    ["card", "ewallet", "fpx"].includes(String(data?.payment_method));

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <EspressoHeader
        title={data ? `Order #${data.order_number}` : "Order"}
        showCart={false}
        rightSlot={
          <Pressable
            onPress={() => router.replace("/")}
            className="p-1 active:opacity-60"
            hitSlop={12}
          >
            <Text className="text-white text-2xl">×</Text>
          </Pressable>
        }
      />

      {isLoading && (
        <View className="flex-1 items-center justify-center">
          <CelsiusLoader size="md" />
        </View>
      )}

      {error && (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-muted-fg text-center">Couldn't load order.</Text>
        </View>
      )}

      {data && (
        <ScrollView contentContainerClassName="px-4 py-4 pb-12 gap-4">
          {/* Status timeline */}
          <View
            className="bg-surface rounded-2xl border border-border p-5"
            style={{
              shadowColor: "#000",
              shadowOpacity: 0.04,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 2 },
            }}
          >
            {data.status === "pending" ? (
              <View className="items-center py-2">
                <Clock size={28} color="#C05040" />
                <Text
                  className="text-espresso text-lg mt-2"
                  style={{ fontFamily: "Peachi-Bold" }}
                >
                  Awaiting payment
                </Text>
                <Text className="text-muted-fg text-sm mt-1 text-center">
                  Complete payment to start preparing
                </Text>
                {isPendingPayment && (
                  <Pressable
                    onPress={reopenStripe}
                    disabled={retrying}
                    className="mt-4 bg-primary rounded-full flex-row items-center gap-2 active:opacity-80"
                    style={{
                      paddingHorizontal: 18,
                      paddingVertical: 12,
                      opacity: retrying ? 0.5 : 1,
                    }}
                  >
                    {retrying ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <CreditCard size={16} color="#FFFFFF" strokeWidth={2} />
                    )}
                    <Text
                      className="text-white text-[14px]"
                      style={{ fontFamily: "Peachi-Bold" }}
                    >
                      {retrying ? "Opening Stripe…" : "Complete payment"}
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : (
              // Horizontal pipeline: ●━━●━━○ with the active node pulsing.
              // Communicates "we're working on it" without forcing the
              // customer to watch the screen for changes.
              <OrderStepper currentIndex={Math.max(0, statusIdx)} />
            )}
          </View>

          {/* Mystery Bean — appears once the server has generated a drop
              for this order (typically within seconds of payment). Tap
              reveals the bonus and credits any multiplier / voucher.
              Stays mounted until the customer dismisses, even after the
              server query refreshes — see the showMystery / dismissed
              flags above for why. */}
          {showMystery && dropId && (
            <MysteryBean
              dropId={dropId}
              baseBeansEarned={data.loyalty_points_earned ?? 0}
              prerevealed={mysteryRevealed}
              onRevealed={(payload) => {
                // Parent now owns the reveal payload — passing it back
                // in via prerevealed makes the child a pure presenter
                // and removes the unmount risk entirely.
                setMysteryRevealed(payload);
                // Refresh the order so newly-credited Beans show up in
                // the summary, and the voucher wallet so a voucher win
                // is already in the list when the customer opens it.
                // NOT invalidating ["mystery-drop", id] — that refetch
                // returns revealed:true and used to race the reveal
                // animation off the page.
                queryClient.invalidateQueries({ queryKey: ["order", id] });
                queryClient.invalidateQueries({ queryKey: ["my-vouchers"] });
              }}
              onDismiss={() => setMysteryDismissed(true)}
            />
          )}

          {/* Order summary. Previously showed only line items + a bare
              total — which read as a broken math bug when there were
              applied discounts (e.g. RM 8.90 line item, RM 4.72 total,
              no explanation). Now mirrors the checkout summary:
              subtotal, each non-zero discount as its own line, SST,
              then the grand total. */}
          <View className="bg-surface rounded-2xl border border-border p-4">
            <Text className="text-muted-fg text-[10px] font-bold uppercase tracking-widest">
              Items
            </Text>
            <View className="mt-2 gap-1.5">
              {(data.order_items ?? []).map((i, idx) => {
                // order_items.modifiers is jsonb on the server. The
                // shape is { selections: [{label,...}], specialInstructions }
                // — see apps/order/.../orders/route.ts where it's
                // persisted. Defensively destructure so an older row
                // shape doesn't crash the receipt.
                const mods = (i.modifiers ?? null) as
                  | { selections?: Array<{ label?: string }>; specialInstructions?: string }
                  | null;
                const labels = (mods?.selections ?? [])
                  .map((s) => s?.label)
                  .filter((l): l is string => !!l);
                const note = mods?.specialInstructions?.trim() || null;
                return (
                  <View key={idx} style={{ gap: 2 }}>
                    <View className="flex-row justify-between">
                      <Text className="text-espresso flex-1">
                        {i.quantity}× {i.product_name}
                      </Text>
                      <Text className="text-espresso">{formatPrice((i.item_total ?? 0) / 100)}</Text>
                    </View>
                    {labels.length > 0 && (
                      <Text
                        className="text-muted-fg text-[12px]"
                        numberOfLines={2}
                        style={{ paddingRight: 60 }}
                      >
                        {labels.join(" · ")}
                      </Text>
                    )}
                    {note ? (
                      <Text
                        className="text-muted-fg text-[12px] italic"
                        numberOfLines={2}
                        style={{ paddingRight: 60 }}
                      >
                        “{note}”
                      </Text>
                    ) : null}
                  </View>
                );
              })}

              <View className="flex-row justify-between mt-3 pt-3 border-t border-border">
                <Text className="text-muted-fg">Subtotal</Text>
                <Text className="text-espresso">
                  {formatPrice((data.subtotal ?? 0) / 100)}
                </Text>
              </View>

              {data.reward_discount_amount > 0 && (
                <View className="flex-row justify-between">
                  <Text className="text-primary text-[13px]" numberOfLines={1}>
                    Reward{data.reward_name ? ` · ${data.reward_name}` : ""}
                  </Text>
                  <Text className="text-primary">
                    −{formatPrice(data.reward_discount_amount / 100)}
                  </Text>
                </View>
              )}

              {data.discount_amount > 0 && (
                <View className="flex-row justify-between">
                  <Text className="text-primary text-[13px]" numberOfLines={1}>
                    Voucher{data.voucher_code ? ` · ${data.voucher_code}` : ""}
                  </Text>
                  <Text className="text-primary">
                    −{formatPrice(data.discount_amount / 100)}
                  </Text>
                </View>
              )}

              {data.first_order_discount_amount > 0 && (
                <View className="flex-row justify-between">
                  <Text className="text-primary text-[13px]">First order discount</Text>
                  <Text className="text-primary">
                    −{formatPrice(data.first_order_discount_amount / 100)}
                  </Text>
                </View>
              )}

              {data.promo_discount > 0 && (
                <View className="flex-row justify-between">
                  <Text className="text-primary text-[13px]">Promotion</Text>
                  <Text className="text-primary">
                    −{formatPrice(data.promo_discount / 100)}
                  </Text>
                </View>
              )}

              {data.sst_amount > 0 && (
                <View className="flex-row justify-between">
                  <Text className="text-muted-fg text-[13px]">SST (6%)</Text>
                  <Text className="text-muted-fg text-[13px]">
                    {formatPrice(data.sst_amount / 100)}
                  </Text>
                </View>
              )}

              <View className="flex-row justify-between mt-2 pt-2 border-t border-border">
                <Text className="text-espresso font-bold">Total</Text>
                <Text
                  className="text-primary"
                  style={{ fontFamily: "Peachi-Bold" }}
                >
                  {formatPrice((data.total ?? 0) / 100)}
                </Text>
              </View>
            </View>
          </View>

          {data.status === "ready" && (
            <View className="gap-3">
              <View className="bg-primary/10 border border-primary/30 rounded-2xl p-4">
                <Text className="text-primary text-sm font-bold">Show this to the barista</Text>
                <Text className="text-primary/80 text-xs mt-1">
                  Order #{data.order_number} — slide below once you've picked it up.
                </Text>
              </View>
              <SwipeToCollect
                label="Slide to confirm pickup"
                doneLabel="Enjoy your drink ☕"
                onComplete={markCollected}
              />
            </View>
          )}

          {data.status === "completed" && (
            // Terracotta-tinted "collected" card — was emerald which isn't
            // on the brand palette. Same family as the active-order banner
            // on home, so the order lifecycle reads as a single colour
            // story (terracotta moves from "your order" → "collected").
            <View
              className="rounded-2xl p-4"
              style={{
                backgroundColor: "#FBEBE8",
                borderWidth: 1,
                borderColor: "rgba(192, 80, 64, 0.25)",
              }}
            >
              <Text
                className="text-sm"
                style={{ fontFamily: "Peachi-Bold", color: "#C05040" }}
              >
                Order collected
              </Text>
              <Text
                className="text-xs mt-1"
                style={{
                  fontFamily: "SpaceGrotesk_500Medium",
                  color: "rgba(26, 2, 0, 0.65)",
                }}
              >
                Thanks for stopping by — see you soon.
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}
