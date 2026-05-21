import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, Platform } from "react-native";
import { Alert } from "@/lib/alert";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clock,
  CreditCard,
  XCircle,
  ChevronDown,
  Check,
} from "lucide-react-native";
import * as Haptics from "@/lib/haptics";
import * as WebBrowser from "expo-web-browser";
import { useStripe } from "@/lib/stripe-shim";

// Same customer-facing labels checkout uses, no provider names.
const METHOD_LABELS: Record<string, string> = {
  card:       "Card",
  apple_pay:  "Apple Pay",
  google_pay: "Google Pay",
  fpx:        "FPX online banking",
  grabpay:    "GrabPay",
  tng:        "Touch ’n Go eWallet",
  boost:      "Boost",
  shopeepay:  "ShopeePay",
};

type GatewayMethod = {
  method_id: string;
  enabled: boolean;
  provider: "stripe" | "revenue_monster";
};
import { fetchOrder } from "../../lib/menu";
import { formatPrice } from "../../lib/api";
import { useApp } from "../../lib/store";
import { EspressoHeader } from "../../components/EspressoHeader";
import { SwipeToCollect } from "../../components/SwipeToCollect";
import { OrderStepper } from "../../components/OrderStepper";
import { CelsiusLoader } from "../../components/CelsiusLoader";
import { MysteryBean } from "../../components/MysteryBean";
import { fetchPendingMysteryDrop, type MysteryDropRevealed } from "../../lib/rewards-v2";
import { FpxBankPicker } from "../../components/FpxBankPicker";
import { PaymentBrandIcon } from "../../components/PaymentBrandIcon";

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

  // Backstop for RM Direct mode: webhooks are best-effort, and our sig
  // validation has been bouncing valid callbacks. Whenever we're sitting
  // on a pending RM-routed order, hit /api/payments/poll so the server
  // asks RM directly and reconciles. The /api/orders/[id] poll above
  // then sees the new status on the next 5s tick.
  useEffect(() => {
    if (!id || !data || data.status !== "pending") return;
    const rmMethods = new Set(["fpx", "tng", "boost", "shopeepay"]);
    if (!data.payment_method || !rmMethods.has(data.payment_method)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(
          `https://order.celsiuscoffee.com/api/payments/poll`,
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
        if (cancelled) return;
        const json = (await res.json().catch(() => null)) as
          | { status?: string; source?: string }
          | null;
        if (json && (json.status === "preparing" || json.status === "failed")) {
          queryClient.invalidateQueries({ queryKey: ["order", id] });
        }
      } catch {
        // Network blip — next tick will retry.
      }
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id, data, queryClient]);

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

  // Available payment methods for the "Change payment method" picker.
  // Fetched once on mount from the same gateway-config the checkout uses,
  // so retries can route through whatever the customer picks instead of
  // being locked to the method that already failed. Platform-irrelevant
  // methods are filtered out (Apple Pay on Android, Google Pay on iOS)
  // because they can't actually be fulfilled by the device.
  const [gatewayMethods, setGatewayMethods] = useState<GatewayMethod[]>([]);
  const [methodPickerOpen, setMethodPickerOpen] = useState(false);
  // FPX needs the customer to pre-pick a bank — we surface the picker
  // when they tap the FPX retry option, then fire the actual retry call
  // once they choose a bank. Toggled off when they switch to a different
  // method so a stale picker doesn't linger.
  const [showFpxPicker, setShowFpxPicker] = useState(false);
  useEffect(() => {
    fetch("https://order.celsiuscoffee.com/api/payments/gateway-config")
      .then((r) => r.json())
      .then((cfg: { methods: GatewayMethod[] }) => {
        const platformOk = (mid: string) => {
          if (mid === "apple_pay") return Platform.OS === "ios";
          if (mid === "google_pay") return Platform.OS === "android";
          return true;
        };
        setGatewayMethods(cfg.methods.filter((m) => m.enabled && platformOk(m.method_id)));
      })
      .catch(() => {
        // If the fetch fails, the "Change payment method" button hides
        // itself (gated on gatewayMethods.length > 0) so the customer can
        // still complete payment with the original method.
      });
  }, []);

  // Single entry point for "complete this pending order with method X".
  // Routes to Stripe PaymentSheet for stripe-provider methods or to RM's
  // hosted page (in-app browser, dismissed by celsiuscoffee:// scheme)
  // for revenue_monster-provider methods. Used by both the primary
  // "Complete payment" button (which passes the order's current method)
  // and the "Change payment method" picker rows.
  const retryWithMethod = async (methodId: string, fpxBankCode?: string) => {
    if (!id) return;
    Haptics.selectionAsync();
    // FPX without a bank → don't fire the API yet, just surface the
    // picker. The picker rows call back into retryWithMethod with the
    // chosen bankCode.
    if (methodId === "fpx" && !fpxBankCode) {
      setMethodPickerOpen(false);
      setShowFpxPicker(true);
      return;
    }
    const provider =
      gatewayMethods.find((m) => m.method_id === methodId)?.provider ?? "stripe";
    setMethodPickerOpen(false);
    setShowFpxPicker(false);
    setRetrying(true);
    try {
      if (provider === "revenue_monster") {
        const rmRes = await fetch(
          `https://order.celsiuscoffee.com/api/payments/create`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin:  "https://order.celsiuscoffee.com",
              Referer: "https://order.celsiuscoffee.com/",
            },
            body: JSON.stringify({
              orderId: id,
              paymentMethod: methodId,
              redirectUrl: "celsiuscoffee://rm-return",
              ...(fpxBankCode ? { fpxBankCode } : {}),
            }),
          },
        );
        const rmJson = (await rmRes.json()) as { paymentUrl?: string; error?: string };
        if (!rmRes.ok || !rmJson.paymentUrl) {
          throw new Error(rmJson.error || "Couldn't start payment");
        }
        await WebBrowser.openAuthSessionAsync(
          rmJson.paymentUrl,
          "celsiuscoffee://rm-return",
          {
            presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
            dismissButtonStyle: "close",
            controlsColor: "#C05040",
            toolbarColor: "#3D1F1A",
          },
        );
        // Webhook is authoritative for status — we don't mutate locally.
        // The 5s React Query poll will pick up the new status.
      } else {
        await reopenStripeInner(methodId);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: unknown) {
      Alert.alert(
        "Couldn't retry payment",
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setRetrying(false);
    }
  };

  // Stripe-only retry, kept as a helper so retryWithMethod can route to
  // it. Throws on failure so the outer try/catch in retryWithMethod is
  // the single place that shows the alert and clears `retrying`.
  const reopenStripeInner = async (methodId?: string) => {
    if (!id) return;
    const piRes = await fetch(
      `https://order.celsiuscoffee.com/api/checkout/create-payment-intent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://order.celsiuscoffee.com",
          Referer: "https://order.celsiuscoffee.com/",
        },
        body: JSON.stringify({ orderId: id, paymentMethod: methodId }),
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
      // Customer cancelled — not an error, just return without throwing
      // so the outer catch doesn't show "Couldn't retry payment".
      if (presentRes.error.code === "Canceled") return;
      throw new Error(presentRes.error.message);
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
    clearCart();
  };

  // A retry sheet makes sense for two states: the customer landed back
  // here mid-checkout (status === "pending") OR the first attempt got
  // rejected (status === "failed"). The server enforces actual state
  // transitions. "cancelled" is terminal; no retry there.
  //
  // The previous payment_method allowlist ("card" | "ewallet" | "fpx")
  // was stale — modern orders carry method ids like "tng", "boost",
  // "shopeepay", "apple_pay" that weren't in the list, so retry was
  // silently hidden. Any non-terminal pending/failed order is retryable.
  const isRetryable = data?.status === "pending" || data?.status === "failed";
  // Old name kept for any downstream references — points at the same
  // boolean so the retry button shows in both pending and failed.
  const isPendingPayment = isRetryable;

  // The method id we'll retry with by default — whatever the order
  // currently stores. If gateway-config hasn't loaded yet (network), fall
  // back to "card" so the button still labels itself sensibly.
  const currentMethodId = (data?.payment_method as string | undefined) ?? "card";
  const currentMethodLabel = METHOD_LABELS[currentMethodId] ?? "the original method";

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
            {data.status === "pending" || data.status === "failed" ? (
              <View className="items-center py-2">
                <Clock size={28} color={data.status === "failed" ? "#B0413E" : "#C05040"} />
                <Text
                  className="text-espresso text-lg mt-2"
                  style={{ fontFamily: "Peachi-Bold" }}
                >
                  {data.status === "failed" ? "Payment failed" : "Awaiting payment"}
                </Text>
                <Text className="text-muted-fg text-sm mt-1 text-center">
                  {data.status === "failed"
                    ? "Your card was declined or the sheet was closed before payment finished. Try again to start preparing your order."
                    : "Complete payment to start preparing"}
                </Text>
                {isRetryable && (
                  <>
                    {/* Primary: retry with whatever method the order
                        already has. Most "I closed the sheet by accident"
                        customers want this. Label name includes the
                        method so the customer sees what they're about to
                        re-attempt (e.g. "Complete payment with Boost"). */}
                    <Pressable
                      onPress={() => retryWithMethod(currentMethodId)}
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
                        {retrying
                          ? "Opening payment…"
                          : data.status === "failed"
                          ? `Try ${currentMethodLabel} again`
                          : `Complete payment with ${currentMethodLabel}`}
                      </Text>
                    </Pressable>

                    {/* Secondary: change payment method. Hidden if the
                        gateway-config fetch failed (length === 0) so the
                        customer isn't stuck staring at an empty picker. */}
                    {gatewayMethods.length > 1 && (
                      <Pressable
                        onPress={() => {
                          Haptics.selectionAsync();
                          setMethodPickerOpen((s) => !s);
                        }}
                        disabled={retrying}
                        className="mt-3 flex-row items-center gap-1 active:opacity-60"
                      >
                        <Text className="text-primary text-[13px] underline">
                          {methodPickerOpen ? "Hide methods" : "Change payment method"}
                        </Text>
                        <ChevronDown
                          size={14}
                          color="#C05040"
                          style={{
                            transform: [
                              { rotate: methodPickerOpen ? "180deg" : "0deg" },
                            ],
                          }}
                        />
                      </Pressable>
                    )}

                    {/* Inline method picker. Filters out the order's
                        existing method (already on the primary button)
                        so the picker only offers alternatives. Tapping a
                        row routes through retryWithMethod which handles
                        the Stripe-vs-RM branch. */}
                    {methodPickerOpen && gatewayMethods.length > 1 && (
                      <View className="mt-3 w-full gap-2">
                        {gatewayMethods
                          .filter((m) => m.method_id !== currentMethodId)
                          .map((m) => (
                            <Pressable
                              key={m.method_id}
                              onPress={() => retryWithMethod(m.method_id)}
                              disabled={retrying}
                              className="bg-surface rounded-2xl border border-border px-4 py-3 flex-row items-center gap-3 active:opacity-80"
                            >
                              <PaymentBrandIcon methodId={m.method_id} size={36} />
                              <Text className="flex-1 text-espresso font-bold">
                                {METHOD_LABELS[m.method_id] ?? m.method_id}
                              </Text>
                              <Check size={16} color="transparent" />
                            </Pressable>
                          ))}
                      </View>
                    )}

                    {/* FPX bank picker — shown when the customer picked
                        FPX from the retry options. Tapping a bank fires
                        retryWithMethod("fpx", bankCode) directly. */}
                    {showFpxPicker && (
                      <View className="mt-3 w-full">
                        <FpxBankPicker
                          selectedCode={null}
                          onSelect={(code) => retryWithMethod("fpx", code)}
                        />
                      </View>
                    )}
                  </>
                )}
              </View>
            ) : data.status === "cancelled" ? (
              // Terminal — staff cancelled the order. No retry path; the
              // customer needs to start a new order if they still want the
              // drink. Mirrors the cancelled empty-state on the Orders tab.
              <View className="items-center py-2">
                <XCircle size={28} color="#B0413E" />
                <Text
                  className="text-espresso text-lg mt-2"
                  style={{ fontFamily: "Peachi-Bold" }}
                >
                  Order cancelled
                </Text>
                <Text className="text-muted-fg text-sm mt-1 text-center">
                  This order was cancelled. Any payment will be refunded automatically.
                </Text>
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
