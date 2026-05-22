import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, Platform, Linking, Animated, Easing } from "react-native";
import { Alert } from "@/lib/alert";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clock,
  Coffee,
  CreditCard,
  XCircle,
  ChevronDown,
  CalendarClock,
  MapPin,
  Check,
} from "lucide-react-native";
import * as Haptics from "@/lib/haptics";
import { RmCheckoutModal } from "../../components/RmCheckoutModal";
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
  duitnow:    "DuitNow QR",
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
import { OrderProgressStrip } from "../../components/OrderProgressStrip";
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

// "9:55 AM" — single absolute clock time.
function fmtClock(d: Date): string {
  const h    = d.getHours();
  const m    = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const h12  = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${ampm}`;
}

// "Today · 10:30 AM" or "Tomorrow · 8:00 AM" — used for scheduled pickup.
function formatScheduledPickup(iso: string): string {
  const at = new Date(iso);
  const today = new Date();
  const sameDay = at.toDateString() === today.toDateString();
  const prefix = sameDay ? "Today" : "Tomorrow";
  return `${prefix} · ${fmtClock(at)}`;
}

// "By ~9:55 AM (±5 min)" — estimated ready window for ASAP orders.
// 10 min after created_at, with the same ±5 hedge the checkout uses.
function formatReadyBy(createdAt: string): string {
  const placed = new Date(createdAt);
  const target = new Date(placed.getTime() + 10 * 60_000);
  const low    = new Date(target.getTime() - 5 * 60_000);
  const high   = new Date(target.getTime() + 5 * 60_000);
  const lowStr  = fmtClock(low);
  const highStr = fmtClock(high);
  // Collapse AM/PM when both halves match.
  if (lowStr.slice(-2) === highStr.slice(-2)) {
    return `${lowStr.slice(0, -3)}-${highStr}`;
  }
  return `${lowStr}-${highStr}`;
}

export default function OrderStatus() {
  // `justPaid` is set by the checkout screen when the customer just
  // returned from a Revenue Monster wallet redirect. It tells us the
  // pending→preparing reconciliation hasn't run yet, so we should show
  // a "Confirming payment…" panel instead of the misleading retry UI.
  const { id, justPaid } = useLocalSearchParams<{
    id: string;
    justPaid?: string;
  }>();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["order", id],
    queryFn: () => fetchOrder(id!),
    refetchInterval: 5000,
    enabled: !!id,
  });

  // Full-screen payment overlay — visually matches the checkout's
  // routeAfterSuccess overlay. Two modes:
  //   - "confirming": amber-tinted backdrop, terracotta circle with
  //     spinner, "Confirming payment" + method label.
  //   - "success":    same backdrop, green circle with checkmark,
  //     "Payment successful" + "We're starting on your order now".
  //
  // The customer returning from RM lands on the order page with
  // confirmingPayment === true → overlay shows in "confirming" mode.
  // When the poll backstop flips status to "preparing", overlay
  // morphs to "success" for 1.4s then fades out, revealing the
  // normal Brewing-now state underneath. If the poll reconciles to
  // "failed" instead, the overlay dismisses without celebrating.
  const prevStatusRef = useRef<string | null>(null);
  const [overlay, setOverlay] = useState<null | "confirming" | "success">(null);
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const overlayScale   = useRef(new Animated.Value(0.7)).current;

  // Drive the overlay in / out based on confirmingPayment + status
  // transitions. Computed inside the effect to keep the dependency
  // list minimal.
  useEffect(() => {
    const cur = data?.status ?? null;
    const prev = prevStatusRef.current;
    const isRmPendingNow =
      cur === "pending" &&
      !!data?.payment_method &&
      new Set(["fpx", "tng", "boost", "shopeepay", "grabpay", "duitnow", "card"]).has(data.payment_method);
    const shouldShowConfirming = isRmPendingNow && justPaid === "1";

    // First mount or pure confirming state → show confirming overlay.
    if (shouldShowConfirming && overlay !== "confirming" && overlay !== "success") {
      setOverlay("confirming");
    }

    // Mount-time success: customer arrived with justPaid=1 and the
    // order is already in preparing/ready (fast webhook beat them
    // back to the app). Show the success overlay briefly anyway —
    // without this, fast RM payments and all Stripe payments would
    // land on Brewing-now with no acknowledgement moment.
    if (
      prev === null &&
      cur &&
      (cur === "preparing" || cur === "ready") &&
      justPaid === "1" &&
      overlay === null
    ) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setOverlay("success");
    }

    // Transition into preparing/ready while the customer is here →
    // morph to success.
    if (prev && cur && prev !== cur) {
      const becamePreparingOrReady =
        (prev === "pending" || prev === "paid") && (cur === "preparing" || cur === "ready");
      if (becamePreparingOrReady) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setOverlay("success");
      }
      // Failed → dismiss overlay so the customer sees the retry UI
      // underneath.
      if (cur === "failed") {
        setOverlay(null);
      }
    }
    prevStatusRef.current = cur;
  }, [data?.status, data?.payment_method, justPaid, overlay]);

  // Fade + scale the circle whenever the overlay mode changes. On
  // "success" we also schedule the auto-dismiss after 1.4s.
  useEffect(() => {
    if (!overlay) {
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      overlayScale.setValue(0.7);
      return;
    }
    Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(overlayScale, {
        toValue: 1,
        friction: 6,
        tension: 90,
        useNativeDriver: true,
      }),
    ]).start();
    if (overlay === "success") {
      const t = setTimeout(() => setOverlay(null), 1400);
      return () => clearTimeout(t);
    }
  }, [overlay, overlayOpacity, overlayScale]);

  // Backstop for RM Direct mode: webhooks are best-effort, and our sig
  // validation has been bouncing valid callbacks. Whenever we're sitting
  // on a pending RM-routed order, hit /api/payments/poll so the server
  // asks RM directly and reconciles. The /api/orders/[id] poll above
  // then sees the new status on the next 5s tick.
  useEffect(() => {
    if (!id || !data || data.status !== "pending") return;
    const rmMethods = new Set(["fpx", "tng", "boost", "shopeepay", "grabpay", "duitnow", "card"]);
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

  // RM checkout modal — same in-app WebView wrapper used by the checkout
  // screen. Replaces expo-web-browser so the retry flow doesn't surface
  // a system URL bar over the RM page.
  const [rmModal, setRmModal] = useState<{ url: string; method: string; amount: string; methodId: string } | null>(null);
  const rmModalResolveRef = useRef<((r: "success" | "cancel") => void) | null>(null);
  const openRmCheckout = (url: string, method: string, amount: string, methodId: string): Promise<"success" | "cancel"> =>
    new Promise((resolve) => {
      rmModalResolveRef.current = resolve;
      setRmModal({ url, method, amount, methodId });
    });
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
        const label  = METHOD_LABELS[methodId] ?? methodId;
        // data.total is sen; the rest of this file divides by 100 before
        // formatPrice (see the order-summary block below). Missed that
        // here originally — produced RM445.00 for a RM4.45 order.
        const amount = typeof data?.total === "number" ? formatPrice(data.total / 100) : "";
        await openRmCheckout(rmJson.paymentUrl, label, amount, methodId);
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

  // "Confirming payment…" window — Revenue Monster wallet/FPX redirects
  // back to the app before the webhook fires, so the order sits in
  // "pending" for a few seconds. Showing the retry UI in that window is
  // wrong: the customer just paid. Trigger via `justPaid=1` (set by
  // checkout on successful return) OR by orders created in the last 90s
  // for someone landing here from history. Past the window we fall
  // through to the existing retry UI so a genuinely stuck order can be
  // recovered.
  const rmConfirmMethods = new Set(["fpx", "tng", "boost", "shopeepay", "grabpay", "duitnow", "card"]);
  const isRmPending =
    data?.status === "pending" &&
    !!data?.payment_method &&
    rmConfirmMethods.has(data.payment_method);
  // Only show "Confirming payment…" when the checkout screen explicitly
  // signals a successful RM return via justPaid=1. The previous 90s
  // creation-time fallback ran for cancelled orders too, making the
  // customer think the payment went through when it didn't.
  const confirmingPayment = isRmPending && justPaid === "1";

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <EspressoHeader
        title={data ? `Order #${data.order_number}` : "Order"}
        showCart={false}
        rightSlot={
          <Pressable
            onPress={() => {
              // Route back to the tab that holds THIS order's status —
              // terminal states (completed/cancelled/failed) live under
              // "Past orders"; everything else stays under "In progress".
              const tab =
                data?.status === "completed" ||
                data?.status === "cancelled" ||
                data?.status === "failed"
                  ? "past"
                  : "active";
              router.replace({ pathname: "/orders", params: { tab } });
            }}
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
        <>
        {/* Sticky top progress strip — only renders for orders that
            actually entered the brew lifecycle. Pending payment,
            failed and cancelled orders skip it (their status card
            below carries the visual). */}
        {(data.status === "paid" ||
          data.status === "preparing" ||
          data.status === "ready" ||
          data.status === "completed") && (
          <OrderProgressStrip
            currentIndex={Math.max(0, statusIdx)}
            tone={
              data.status === "ready" || data.status === "completed"
                ? "success"
                : "warning"
            }
          />
        )}
        <ScrollView contentContainerClassName="px-4 py-4 pb-12 gap-4">
          {/* Status timeline — one card per lifecycle state. */}
          <View
            className="bg-surface rounded-2xl border border-border p-5"
            style={{
              shadowColor: "#000",
              shadowOpacity: 0.04,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 2 },
            }}
          >
            {confirmingPayment ? (
              // Visually a sibling of the Brewing / Ready state cards —
              // same 64px chip, same title/sub layout — just a spinner
              // instead of a static icon. Reads as part of the same
              // "your order's progressing" family.
              <View className="items-center py-2">
                <View
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 32,
                    backgroundColor: "#FEF3C7", // warning tint
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <ActivityIndicator size="large" color="#B45309" /* warning */ />
                </View>
                <Text
                  className="text-espresso text-xl mt-3"
                  style={{ fontFamily: "Peachi-Bold" }}
                  numberOfLines={1}
                >
                  Confirming payment
                </Text>
                <Text className="text-muted-fg text-sm mt-1 text-center">
                  Usually a few seconds via {currentMethodLabel}. We'll start
                  preparing your order as soon as it lands.
                </Text>
              </View>
            ) : data.status === "pending" || data.status === "failed" ? (
              // Both are danger states — payment is the customer's
              // outstanding action. Same red regardless of failed vs
              // awaiting; the title differentiates.
              <View className="items-center py-2">
                <Clock size={28} color="#B91C1C" /* danger */ />
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
                <XCircle size={28} color="#B91C1C" /* danger */ />
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
            ) : data.status === "ready" ? (
              <View className="flex-row items-center py-1 gap-3">
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: "#E8F5E9",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Check size={22} color="#2E7D32" strokeWidth={2.5} />
                </View>
                <View className="flex-1">
                  <Text
                    className="text-espresso text-base"
                    style={{ fontFamily: "Peachi-Bold" }}
                  >
                    Ready for pickup
                  </Text>
                  <Text className="text-muted-fg text-xs mt-0.5">
                    Your order is at the counter.
                  </Text>
                </View>
              </View>
            ) : data.status === "completed" ? (
              <View className="flex-row items-center py-1 gap-3">
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: "#E8F5E9", // success tint
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Check size={20} color="#2E7D32" /* success */ strokeWidth={2.5} />
                </View>
                <View className="flex-1">
                  <Text
                    className="text-espresso text-base"
                    style={{ fontFamily: "Peachi-Bold" }}
                  >
                    Order collected
                  </Text>
                  <Text className="text-muted-fg text-xs mt-0.5">
                    Thanks for stopping by — see you soon.
                  </Text>
                </View>
              </View>
            ) : data.status === "paid" && data.pickup_at ? (
              // Scheduled, paid, held — order is sitting in queue
              // until the brew window opens. promote-scheduled cron
              // flips this to "preparing" when it's time.
              <View className="flex-row items-center py-1 gap-3">
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: "#FEF3C7", // warning tint
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Clock size={20} color="#B45309" /* warning */ strokeWidth={2.2} />
                </View>
                <View className="flex-1">
                  <Text
                    className="text-espresso text-base"
                    style={{ fontFamily: "Peachi-Bold" }}
                  >
                    Scheduled
                  </Text>
                  <Text className="text-muted-fg text-xs mt-0.5">
                    Brewing starts shortly before {new Date(data.pickup_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
                  </Text>
                </View>
              </View>
            ) : (
              // paid (no pickup_at) / preparing — Brewing now.
              // Warning yellow — order is in-flight, not finished.
              <View className="flex-row items-center py-1 gap-3">
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: "#FEF3C7", // warning tint
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Coffee size={20} color="#B45309" /* warning */ strokeWidth={2.2} />
                </View>
                <View className="flex-1">
                  <Text
                    className="text-espresso text-base"
                    style={{ fontFamily: "Peachi-Bold" }}
                  >
                    Brewing now
                  </Text>
                  <Text className="text-muted-fg text-xs mt-0.5">
                    We'll ping you the moment it's ready.
                  </Text>
                </View>
              </View>
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

          {/* Order summary — visible on every lifecycle state so the
              customer can re-verify items + total at any point. */}
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
            <SwipeToCollect
              label="Slide to confirm pickup"
              doneLabel="Enjoy your drink"
              onComplete={markCollected}
            />
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
        </>
      )}

      {/* Full-screen payment overlay — mirrors the checkout's
          routeAfterSuccess animation. Big circle, title, sub. Fades
          in on confirmingPayment, morphs to a green-check "Payment
          successful" when status transitions to preparing/ready,
          then fades out after 1.4s revealing the order page
          underneath. */}
      {overlay && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(255,247,231,0.96)",
            alignItems: "center",
            justifyContent: "center",
            opacity: overlayOpacity,
            zIndex: 100,
            elevation: 20,
          }}
        >
          <Animated.View
            style={{
              width: 88,
              height: 88,
              borderRadius: 44,
              backgroundColor: overlay === "success" ? "#2E7D32" : "#B45309", // success / warning
              alignItems: "center",
              justifyContent: "center",
              transform: [{ scale: overlayScale }],
              shadowColor: overlay === "success" ? "#2E7D32" : "#B45309",
              shadowOpacity: 0.35,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 6 },
              elevation: 6,
            }}
          >
            {overlay === "success" ? (
              <Check size={48} color="#FFFFFF" strokeWidth={3} />
            ) : (
              <ActivityIndicator size="large" color="#FFFFFF" />
            )}
          </Animated.View>
          <Animated.Text
            style={{
              marginTop: 18,
              color: "#160800",
              fontFamily: "Peachi-Bold",
              fontSize: 22,
              opacity: overlayOpacity,
            }}
          >
            {overlay === "success" ? "Payment successful" : "Confirming payment"}
          </Animated.Text>
          <Animated.Text
            style={{
              marginTop: 4,
              color: "rgba(26,2,0,0.6)",
              fontFamily: "SpaceGrotesk_500Medium",
              fontSize: 13,
              opacity: overlayOpacity,
            }}
          >
            {overlay === "success"
              ? "We're starting on your order now"
              : `Usually a few seconds via ${currentMethodLabel}`}
          </Animated.Text>
        </Animated.View>
      )}

      <RmCheckoutModal
        visible={!!rmModal}
        url={rmModal?.url ?? null}
        methodLabel={rmModal?.method ?? ""}
        amountLabel={rmModal?.amount}
        methodId={rmModal?.methodId}
        onSuccess={() => {
          setRmModal(null);
          rmModalResolveRef.current?.("success");
          rmModalResolveRef.current = null;
        }}
        onCancel={() => {
          setRmModal(null);
          rmModalResolveRef.current?.("cancel");
          rmModalResolveRef.current = null;
        }}
      />
    </View>
  );
}
