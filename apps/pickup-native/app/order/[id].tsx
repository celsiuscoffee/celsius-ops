import { useState } from "react";
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
              {(data.order_items ?? []).map((i, idx) => (
                <View key={idx} className="flex-row justify-between">
                  <Text className="text-espresso flex-1">
                    {i.quantity}× {i.product_name}
                  </Text>
                  <Text className="text-espresso">{formatPrice((i.item_total ?? 0) / 100)}</Text>
                </View>
              ))}

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
