import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  Animated,
  Easing,
} from "react-native";
import { Alert } from "@/lib/alert";
// TextInput stays imported — it's still used by the phone / OTP entry steps.
import { Stack, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, AlertCircle, Coffee, MapPin, Clock, Wallet } from "lucide-react-native";
import * as Haptics from "@/lib/haptics";
import { useStripe } from "@/lib/stripe-shim";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, type Outlet } from "../lib/supabase";
import { useApp, cartTotal, cartCount } from "../lib/store";
import { api, formatPrice } from "../lib/api";
import {
  calcRewardDiscount,
  fetchTier,
  fetchRewards,
  type MemberTier,
  type EvaluatedCart,
} from "../lib/rewards";
import { useEvaluatePromotions } from "../lib/use-evaluate-promotions";
import { getSetting } from "../lib/settings";
import { showToast } from "../lib/toast";
import { trackEvent } from "../lib/analytics";
import { EspressoHeader } from "../components/EspressoHeader";
import { PrimaryButton } from "../components/PrimaryButton";

type Step = "phone" | "otp" | "review";

export default function Checkout() {
  const insets = useSafeAreaInsets();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const cart = useApp((s) => s.cart);
  const outletId = useApp((s) => s.outletId);
  const outletName = useApp((s) => s.outletName);
  const phoneFromStore = useApp((s) => s.phone);
  const setPhone = useApp((s) => s.setPhone);
  const clearCart = useApp((s) => s.clearCart);
  const setReservedVoucher = useApp((s) => s.setReservedVoucher);
  const appliedReward = useApp((s) => s.appliedReward);
  const setAppliedReward = useApp((s) => s.setAppliedReward);
  const loyaltyId = useApp((s) => s.loyaltyId);
  const queryClient = useQueryClient();

  // SST is config-driven via /api/settings?key=sst — admin can toggle/adjust
  // from backoffice without redeploy.
  const [sstConfig, setSstConfig] = useState({ rate: 0.06, enabled: true });
  const [paymentsEnabled, setPaymentsEnabled] = useState(true);
  const [tier, setTier] = useState<MemberTier | null>(null);
  useEffect(() => {
    getSetting("sst").then(setSstConfig);
    getSetting("payments_enabled").then((v) => setPaymentsEnabled(v.enabled));
  }, []);

  // Fetch tier whenever loyaltyId is known so we can show the points-earning
  // line with the right multiplier ("Gold member · earning 1.5× = 12 pts").
  useEffect(() => {
    if (!loyaltyId) {
      setTier(null);
      return;
    }
    fetchTier(loyaltyId).then(setTier).catch(() => setTier(null));
  }, [loyaltyId]);

  // ── Promotion preview ──────────────────────────────────────────────────
  // Discount engine eval — shared cache with the cart screen via
  // the useEvaluatePromotions hook. When the customer transitions
  // cart → checkout with an unchanged cart, the eval is instant
  // (hits the React Query cache) instead of firing a 600-900ms
  // network round-trip on the checkout side. Stale time = 30s, so
  // a fresh navigation always reuses the cart's just-fetched result.
  const promoEvalReady = !loyaltyId || !!tier;
  const { data: promoEval, isError: promoEvalError } = useEvaluatePromotions({
    memberTierId: tier?.tier_id ?? null,
    enabled: promoEvalReady,
  });
  // Surface a one-time toast when the engine is unreachable —
  // checkout still proceeds at full price.
  const promoErrorToastShown = useRef(false);
  useEffect(() => {
    if (promoEvalError && !promoErrorToastShown.current) {
      promoErrorToastShown.current = true;
      showToast({
        message: "Couldn't check for discounts. Pull to retry.",
        variant: "info",
      });
    } else if (!promoEvalError) {
      promoErrorToastShown.current = false;
    }
  }, [promoEvalError]);

  const promoDiscount = promoEval?.total_discount ?? 0;

  // Pull live outlet record so the pickup card shows status + ETA.
  // Polled every 30s while the checkout screen is mounted so the
  // customer doesn't commit to an outlet that closed mid-flow —
  // e.g. they took 4 min on payment selection and the outlet
  // shuttered for the night. refetchOnWindowFocus catches the
  // common "switched apps to grab card, came back" pattern.
  const outlets = useQuery({
    queryKey: ["outlets"],
    queryFn: async (): Promise<Outlet[]> => {
      const { data, error } = await supabase
        .from("outlet_settings")
        .select("store_id,name,address,lat,lng,is_open,is_busy,pickup_time_mins")
        .eq("is_active", true);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const currentOutlet = (outlets.data ?? []).find((o) => o.store_id === outletId) ?? null;
  const outletClosed = currentOutlet ? currentOutlet.is_open === false : false;

  const subtotal = cartTotal(cart);
  const rewardDiscountRaw = calcRewardDiscount(appliedReward, cart, subtotal);

  // Non-stackable tier exclusivity (Staff, Black Card). Mirrors the
  // server-side auto-pick-larger so the cart, summary, and Place
  // Order button all read the same number. Without this, both
  // discounts stack client-side, hit the Math.max(0, ...) floor at
  // 0, and produce a bug: button "RM0.00" + summary "Total RM7.45"
  // (the leftover tier-perk after the cap absorbs the voucher).
  const isNonStackableTier = tier?.tier_stackable === false;
  const rawTierPerk = (promoEval?.discounts ?? []).find((d) => d.reason === "tier_perk");
  const rawTierPerkAmt = rawTierPerk?.discount_amount ?? 0;
  const rawOtherPromoSum = (promoEval?.discounts ?? [])
    .filter((d) => d.reason !== "tier_perk")
    .reduce((s, d) => s + d.discount_amount, 0);

  let rewardDiscount = rewardDiscountRaw;
  let effectivePromoDiscount = promoDiscount;
  let dropTierPerk = false;
  if (isNonStackableTier && rawTierPerkAmt > 0) {
    if (rewardDiscountRaw >= rawTierPerkAmt) {
      // Voucher wins — drop the tier perk, keep voucher + any other
      // promo-engine discounts (auto, reward_link).
      dropTierPerk = true;
      effectivePromoDiscount = rawOtherPromoSum;
    } else if (rewardDiscountRaw > 0) {
      // Tier wins — drop the voucher, keep tier perk + any other
      // promo-engine discounts.
      rewardDiscount = 0;
    }
  }

  const afterDiscount = Math.max(0, subtotal - rewardDiscount - effectivePromoDiscount);
  const sst = sstConfig.enabled ? +(afterDiscount * sstConfig.rate).toFixed(2) : 0;
  const grandTotal = +(afterDiscount + sst).toFixed(2);

  const [step, setStep] = useState<Step>(phoneFromStore ? "review" : "phone");
  const [phoneInput, setPhoneInput] = useState(phoneFromStore ?? "");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  // Contextual message shown next to the spinner during checkout. Lets
  // the customer see WHAT is happening at each step instead of a bare
  // spinner — particularly important after the Stripe sheet dismisses,
  // when the wait between "paid" and the order-detail screen used to
  // feel like a stall.
  const [busyLabel, setBusyLabel] = useState<string | undefined>(undefined);
  // Single Stripe-routed payment flow. The sheet presents whatever
  // methods are enabled in Stripe Dashboard (card, Apple Pay, FPX,
  // GrabPay, etc.) via automatic_payment_methods, so the app no
  // longer asks the customer to pre-pick. We still send a value to
  // the server because it requires one; "card" is the most common
  // and the actual method gets recorded post-payment via Stripe's
  // PaymentIntent metadata.
  const [lastError, setLastError] = useState<string | null>(null);
  // Success acknowledgement — toggled the moment payment is confirmed
  // (or we hit the skipPayment branch for zero-amount orders). The
  // overlay animates in, holds ~1.5s, then router.replace navigates
  // to the order detail screen.
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  // Frozen snapshot of the order summary, captured the instant Place
  // Order is tapped. clearCart() runs immediately after the server
  // creates the pending order (to prevent duplicate-order submissions
  // if the customer back-navigates and retries) — but that empties
  // `cart`, recomputes all derived totals to 0, and made the order
  // summary flash "Total RM 0.00" behind the Apple Pay sheet while
  // the user authorised payment. Pinning the summary values here
  // keeps the display stable until we navigate away.
  type FrozenSummary = {
    items:          typeof cart;
    subtotal:       number;
    rewardDiscount: number;
    rewardName:     string | null;
    promoDiscounts: NonNullable<typeof promoEval>["discounts"];
    sst:            number;
    grandTotal:     number;
    afterDiscount:  number;
  };
  const [frozenSummary, setFrozenSummary] = useState<FrozenSummary | null>(null);
  const successOpacity = useRef(new Animated.Value(0)).current;
  const successScale   = useRef(new Animated.Value(0.6)).current;

  // Run the success animation + auto-navigate to /order/[id] after a
  // brief hold. Used by every "we're done, get out of checkout"
  // path (Stripe success, zero-amount skipPayment, payment-cancel
  // fallback) so the customer always sees the same exit moment.
  const routeAfterSuccess = (orderId: string, opts?: { holdMs?: number }) => {
    const holdMs = opts?.holdMs ?? 1400;
    setPaymentSuccess(true);
    Animated.parallel([
      Animated.timing(successOpacity, {
        toValue:  1,
        duration: 220,
        easing:   Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(successScale, {
        toValue:  1,
        friction: 6,
        tension:  90,
        useNativeDriver: true,
      }),
    ]).start();
    setTimeout(() => {
      router.replace({ pathname: "/order/[id]", params: { id: orderId } });
    }, holdMs);
  };

  const onSendOtp = async () => {
    const normalized = phoneInput.trim().replace(/\s/g, "");
    if (!/^\+?6?01\d{8,9}$/.test(normalized)) {
      Alert.alert("Invalid phone", "Enter a Malaysian number, e.g. 0123456789");
      return;
    }
    setBusy(true);
    setBusyLabel("Sending code…");
    try {
      await api.sendOtp(normalized);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep("otp");
    } catch (e) {
      Alert.alert("Couldn't send code", String(e));
    } finally {
      setBusy(false);
      setBusyLabel(undefined);
    }
  };

  const onVerifyOtp = async () => {
    if (otp.length < 4) return;
    setBusy(true);
    setBusyLabel("Checking code…");
    try {
      await api.verifyOtp(phoneInput.trim(), otp.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      trackEvent("login_success", { surface: "checkout" });
      setPhone(phoneInput.trim());
      setStep("review");
    } catch (e) {
      Alert.alert("Couldn't verify", String(e));
    } finally {
      setBusy(false);
      setBusyLabel(undefined);
    }
  };

  const onPlaceOrder = async () => {
    if (!outletId) {
      Alert.alert("No outlet selected", "Pick an outlet first.");
      return;
    }
    trackEvent("checkout_started", {
      itemCount: cart.length,
      subtotal,
      hasReward: !!appliedReward,
      outletId,
    });

    // Guard: re-validate the applied reward right before submitting.
    // Customers can sit on the cart screen for hours; a reward that
    // was eligible at add-time may have expired, hit its
    // max_redemptions cap, or been deactivated. Catching it client-
    // side is friendlier than the server-side 422 surprise.
    //
    // Only runs for legacy points-shop rewards (no voucher_id). Wallet
    // vouchers (voucher_id set) live in issued_rewards — their id will
    // never match a points-shop reward.id, so without this guard the
    // .find() returned undefined and silently cleared every wallet
    // voucher right before place-order: the discount disappeared from
    // the order. Wallet validation runs server-side on /api/orders.
    if (appliedReward && !appliedReward.voucher_id) {
      try {
        const fresh = await fetchRewards(phoneInput.trim() || phoneFromStore || null);
        const live = fresh.rewards.find((r) => r.id === appliedReward.id);
        const now = Date.now();
        const stillValid =
          live &&
          live.is_active !== false &&
          (!live.valid_until || new Date(live.valid_until).getTime() > now) &&
          (live.stock == null || live.stock > 0) &&
          (live.max_redemptions_per_member == null ||
            (live.redemption_count ?? 0) < live.max_redemptions_per_member);
        if (!stillValid) {
          // Clear the stale reward, surface a toast, bounce out so
          // the customer sees the corrected total before tapping
          // place-order again.
          setAppliedReward(null);
          showToast({
            message: "Your reward expired. Updated total below.",
            variant: "info",
            durationMs: 3500,
          });
          return;
        }
      } catch {
        // Network failure on the re-check is non-blocking — let the
        // server be the final arbiter rather than holding up the
        // order over a transient connectivity blip.
      }
    }

    setBusy(true);
    setBusyLabel("Reviewing your order…");
    setLastError(null);
    let stage = "init";
    try {
      stage = "create-order";
      // 1. Create the order on the server.
      //    Server expects: selectedStore (object), loyaltyPhone, total (RM), items, paymentMethod.
      // Cart is cleared the moment the order is committed server-side —
      // any retry happens from the order page using the existing orderId,
      // never by re-submitting the cart (which would create a duplicate).
      const res = await api.placeOrder({
        selectedStore: { id: outletId, name: outletName ?? undefined },
        loyaltyPhone: phoneInput.trim(),
        loyaltyId: loyaltyId ?? undefined,
        paymentMethod: "card",
        total: subtotal, // pre-discount subtotal in RM; server applies discount + SST
        items: cart.map((i) => ({
          productId: i.productId,
          name: i.name,
          quantity: i.quantity,
          basePrice: i.basePrice,
          totalPrice: i.totalPrice,
          modifiers: i.modifiers.map((m) => ({
            groupName: m.groupName,
            label: m.label,
            priceDelta: m.priceDelta,
          })),
          specialInstructions: i.specialInstructions,
        })),
        rewardId: appliedReward?.id ?? null,
        rewardName: appliedReward?.name ?? null,
        rewardPointsCost: appliedReward?.points_required ?? 0,
        rewardDiscountSen: Math.round(rewardDiscount * 100),
        walletVoucherId: appliedReward?.voucher_id ?? null,
      });
      // Pin the summary BEFORE clearCart so the customer keeps seeing
      // their RM 4.45 (or whatever) behind the Stripe / Apple Pay
      // sheet — otherwise the live total recomputes to 0 the moment
      // the cart empties.
      setFrozenSummary({
        items:          cart,
        subtotal,
        rewardDiscount,
        rewardName:     appliedReward?.name ?? null,
        promoDiscounts: promoEval?.discounts ?? [],
        sst,
        grandTotal,
        afterDiscount,
      });
      clearCart();
      // Voucher (if reserved) has now been redeemed at checkout. Clear the
      // wallet hold so the banner stops showing on menu/cart for the next
      // order.
      setReservedVoucher(null);
      trackEvent("order_placed", {
        orderId:        res.orderId,
        orderNumber:    res.orderNumber,
        total:          grandTotal,
        subtotal,
        rewardDiscount,
        promoDiscount,
        rewardId:       appliedReward?.id ?? null,
        outletId,
      });
      // Reward was just consumed (server deducts points + decrements stock)
      // and points were earned on the after-discount subtotal. The home,
      // rewards, and account screens cache tier + rewards for 5 min — without
      // these invalidations the customer sees the OLD points balance and
      // their just-used reward still sitting there as "available".
      setAppliedReward(null);
      queryClient.invalidateQueries({ queryKey: ["tier", loyaltyId] });
      queryClient.invalidateQueries({ queryKey: ["rewards", phoneInput.trim() || phoneFromStore || "anonymous"] });
      // Order list query keys to wipe — the screen uses kebab-case
      // ["order-history", phone]; the home page uses ["recent-orders"].
      // Both need to refetch so the just-placed order shows up
      // immediately in In progress / Recents instead of waiting out
      // the 5-min staleTime.
      queryClient.invalidateQueries({ queryKey: ["order-history"] });
      queryClient.invalidateQueries({ queryKey: ["recent-orders"] });

      // Pre-flight: a zero-amount order (full reward / 100%-off promo)
      // skips Stripe entirely, so "Opening secure payment…" would be
      // a lie. Show "Sending to kitchen…" up-front for those — the
      // server confirms the order in the same PaymentIntent call.
      const isFreeOrder = grandTotal <= 0.001;
      setBusyLabel(isFreeOrder ? "Sending to kitchen…" : "Opening secure payment…");
      stage = "create-payment-intent";
      // 2. Card / ewallet — Stripe native PaymentSheet. The server mints a
      //    PaymentIntent for this orderId; we hand the clientSecret to the
      //    native sheet. Vercel cold-starts can intermittently 500 with a
      //    StripeConnectionError; one retry after a short delay reliably
      //    succeeds once the function is warm.
      const fetchIntent = async () =>
        fetch(`https://order.celsiuscoffee.com/api/checkout/create-payment-intent`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin:  "https://order.celsiuscoffee.com",
            Referer: "https://order.celsiuscoffee.com/",
          },
          body: JSON.stringify({ orderId: res.orderId }),
        });
      let piRes = await fetchIntent();
      let piJson = (await piRes.json()) as {
        clientSecret?:    string;
        paymentIntentId?: string;
        skipPayment?:     boolean;
        error?:           string;
        type?:            string;
      };
      if (
        !piRes.ok &&
        (piJson.type === "StripeConnectionError" ||
          /connection/i.test(piJson.error ?? ""))
      ) {
        // Cold-start retry — wait 1.2s then try once more.
        await new Promise((r) => setTimeout(r, 1200));
        piRes = await fetchIntent();
        piJson = (await piRes.json()) as typeof piJson;
      }
      // Zero-amount orders (free-drink reward, etc.) — server already
      // moved the order to "preparing" and ran earn/deduct hooks.
      // Skip Stripe PaymentSheet and route straight to the order page.
      if (piRes.ok && piJson.skipPayment) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        trackEvent("payment_skipped", { orderId: res.orderId, reason: "zero_amount" });
        routeAfterSuccess(res.orderId);
        return;
      }
      if (!piRes.ok || !piJson.clientSecret) {
        throw new Error(
          `${stage} HTTP ${piRes.status}: ${piJson.error || "no clientSecret"}`
        );
      }

      stage = "init-payment-sheet";
      const initRes = await initPaymentSheet({
        merchantDisplayName: "Celsius Coffee",
        paymentIntentClientSecret: piJson.clientSecret,
        applePay: { merchantCountryCode: "MY" },
        // Google Pay's live-mode "Buying Intent" check denies any AAB that
        // isn't on the public Play Store (we're still on internal testing).
        // The Stripe publishable key prefix is the authoritative signal:
        // pk_test_* → not real money → test wallet is the right surface and
        // also bypasses the Play Store presence check. pk_live_* keeps the
        // live wallet so production builds work the moment we hit the public
        // store. No env toggle needed — flips automatically when keys swap.
        googlePay: {
          merchantCountryCode: "MY",
          currencyCode: "myr",
          testEnv: (process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "").startsWith("pk_test_"),
        },
        defaultBillingDetails: { phone: phoneInput.trim() },
        returnURL: "celsiuscoffee://stripe-redirect",
        allowsDelayedPaymentMethods: false,
      });
      if (initRes.error) {
        throw new Error(
          `${stage} [${initRes.error.code ?? "?"}]: ${initRes.error.message}`
        );
      }

      stage = "present-payment-sheet";
      const presentRes = await presentPaymentSheet();
      if (presentRes.error) {
        // User cancelled or payment failed. Order stays pending; cron will
        // expire it after 10 min if no retry.
        if (presentRes.error.code !== "Canceled") {
          trackEvent("payment_failed", { orderId: res.orderId, code: presentRes.error.code, message: presentRes.error.message });
          Alert.alert("Payment failed", presentRes.error.message);
        } else {
          trackEvent("payment_cancelled", { orderId: res.orderId });
        }
        // Always route to the order page so customer can retry from there.
        router.replace({ pathname: "/order/[id]", params: { id: res.orderId } });
        return;
      }
      trackEvent("payment_success", { orderId: res.orderId });
      // The Stripe sheet has dismissed, payment is captured, and the
      // server is finishing the loop (confirm-stripe + mystery drop
      // mint). This is the gap the customer used to stare at a bare
      // spinner — now they get a clear cue that work is happening.
      setBusyLabel("Sending to kitchen…");

      // Payment succeeded — confirm server-side immediately so the order is
      // already "preparing" by the time we navigate.
      try {
        await fetch(
          `https://order.celsiuscoffee.com/api/orders/${encodeURIComponent(res.orderId)}/confirm-stripe`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin:  "https://order.celsiuscoffee.com",
              Referer: "https://order.celsiuscoffee.com/",
            },
            body: JSON.stringify({
              paymentIntentId:
                piJson.paymentIntentId ?? piJson.clientSecret.split("_secret_")[0],
            }),
          }
        );
      } catch {
        // Webhook is the backstop if this fails.
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      routeAfterSuccess(res.orderId);
    } catch (e: any) {
      const detail = `[${stage}] ${e?.message ?? String(e)}`;
      setLastError(detail);
      Alert.alert("Couldn't place order", detail);
      console.warn("[checkout]", detail, e);
    } finally {
      setBusy(false);
      setBusyLabel(undefined);
    }
  };

  // Empty cart guard — covers deep-link / back-nav cases where the user
  // lands here with nothing to pay for. Suppressed while `busy` is true
  // (an order is in flight) or while the success overlay is showing
  // (we're about to navigate to /order/[id] but the cart was already
  // cleared, so without this gate the empty-cart placeholder flashes
  // for ~1.4s before navigation).
  if (cartCount(cart) === 0 && !busy && !paymentSuccess) {
    return (
      <View className="flex-1 bg-background">
        <Stack.Screen options={{ headerShown: false }} />
        <EspressoHeader title="Checkout" showBack showCart={false} />
        <View className="flex-1 items-center justify-center px-6">
          <Coffee size={48} color="#8E8E93" strokeWidth={1.25} />
          <Text
            className="text-espresso text-base mt-4"
            style={{ fontFamily: "Peachi-Bold" }}
          >
            Your cart is empty
          </Text>
          <Text
            className="text-muted-fg text-sm text-center mt-1"
            style={{ fontFamily: "SpaceGrotesk_400Regular" }}
          >
            Add a drink first, then we'll get you to pickup quick.
          </Text>
          <Pressable
            onPress={() => router.replace(outletId ? "/menu" : "/store")}
            className="mt-6 bg-espresso rounded-full active:opacity-80"
            style={{ paddingHorizontal: 22, paddingVertical: 11 }}
          >
            <Text
              className="text-white text-[14px]"
              style={{ fontFamily: "Peachi-Bold" }}
            >
              Browse menu
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <EspressoHeader title="Checkout" showBack showCart={false} />

      <ScrollView contentContainerClassName="px-4 py-4 pb-32 gap-4">
        {step === "phone" && (
          <View className="bg-surface rounded-2xl border border-border p-5">
            <Text className="text-espresso text-xs font-bold uppercase tracking-wider">
              Phone number
            </Text>
            <Text className="text-muted-fg text-xs mt-1">
              We'll text you a code, then notify you when your order is ready.
            </Text>
            <TextInput
              value={phoneInput}
              onChangeText={setPhoneInput}
              placeholder="0123456789"
              placeholderTextColor="#8E8E93"
              keyboardType="phone-pad"
              autoFocus
              className="mt-3 bg-background border border-border rounded-2xl px-4 py-3 text-espresso text-lg"
            />
            <View className="mt-5">
              <PrimaryButton label="Text me the code" onPress={onSendOtp} loading={busy} loadingLabel={busyLabel} />
            </View>
          </View>
        )}

        {step === "otp" && (
          <View className="bg-surface rounded-2xl border border-border p-5">
            <Text className="text-espresso text-xs font-bold uppercase tracking-wider">
              Enter code
            </Text>
            <Text className="text-muted-fg text-xs mt-1">Sent to {phoneInput}</Text>
            <TextInput
              value={otp}
              onChangeText={setOtp}
              placeholder="••••••"
              placeholderTextColor="#8E8E93"
              keyboardType="number-pad"
              autoFocus
              maxLength={6}
              className="mt-3 bg-background border border-border rounded-2xl px-4 py-3 text-espresso text-2xl tracking-widest text-center"
            />
            <View className="mt-5">
              <PrimaryButton label="Let me in" onPress={onVerifyOtp} loading={busy} loadingLabel={busyLabel} />
            </View>
            <Pressable onPress={() => setStep("phone")} className="mt-3 items-center active:opacity-70">
              <Text className="text-muted-fg text-sm">Wrong number? Edit</Text>
            </Pressable>
          </View>
        )}

        {step === "review" && (
          <>
            <Pressable
              onPress={() => router.push("/store")}
              className="bg-surface rounded-2xl border border-border p-4 active:opacity-70"
            >
              <View className="flex-row items-center justify-between">
                <Text className="text-muted-fg text-[10px] font-bold uppercase tracking-widest">
                  Pickup at
                </Text>
                <Text
                  className="text-primary text-[11px]"
                  style={{ fontFamily: "Peachi-Bold" }}
                >
                  Change
                </Text>
              </View>
              <View className="flex-row items-center gap-2 mt-1">
                <MapPin size={14} color="#160800" />
                <Text className="text-espresso font-bold text-[15px] flex-1" numberOfLines={1}>
                  {outletName ?? "Select outlet"}
                </Text>
              </View>
              {currentOutlet && (
                <View className="flex-row items-center gap-1.5 mt-2">
                  <View
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: !currentOutlet.is_open
                        ? "#EF4444"
                        : currentOutlet.is_busy
                        ? "#F59E0B"
                        : "#22C55E",
                    }}
                  />
                  <Text
                    className="text-muted-fg text-[12px]"
                    style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}
                  >
                    {!currentOutlet.is_open
                      ? "Closed now"
                      : currentOutlet.is_busy
                      ? "Busy"
                      : "Open"}
                    {currentOutlet.is_open && currentOutlet.pickup_time_mins
                      ? ` · ready in ~${currentOutlet.pickup_time_mins} min`
                      : ""}
                  </Text>
                </View>
              )}
            </Pressable>

            <Pressable
              onPress={() => setStep("phone")}
              className="bg-surface rounded-2xl border border-border p-4 active:opacity-70"
            >
              <View className="flex-row items-center justify-between">
                <Text className="text-muted-fg text-[10px] font-bold uppercase tracking-widest">
                  Contact
                </Text>
                <Text
                  className="text-primary text-[11px]"
                  style={{ fontFamily: "Peachi-Bold" }}
                >
                  Edit
                </Text>
              </View>
              <View className="flex-row items-center gap-2 mt-1">
                <Clock size={14} color="#160800" />
                <Text className="text-espresso font-bold text-[15px]">{phoneInput}</Text>
              </View>
              <Text
                className="text-muted-fg text-[11px] mt-1"
                style={{ fontFamily: "SpaceGrotesk_500Medium" }}
              >
                We'll notify you in the app when it's ready.
              </Text>
            </Pressable>

            <View>
              <Text className="text-muted-fg text-[11px] font-bold uppercase tracking-wider px-1 mb-2">
                Payment
              </Text>
              {/* Stripe sheet handles method selection — Card, Apple Pay,
                  FPX, GrabPay, etc. are surfaced based on what's enabled
                  in the Stripe Dashboard. No app-side picker so customers
                  don't get a misleading pre-selection that doesn't actually
                  filter the sheet. */}
              <View className="bg-surface rounded-2xl border border-border px-4 py-3 flex-row items-center gap-3">
                <View className="w-9 h-9 rounded-2xl items-center justify-center bg-primary/15">
                  <Wallet size={18} color="#C05040" />
                </View>
                <View className="flex-1">
                  <Text className="text-espresso font-bold">
                    Pay securely via Stripe
                  </Text>
                  <Text className="text-muted-fg text-xs">
                    Card · Apple Pay · FPX · GrabPay — pick on the next screen
                  </Text>
                </View>
              </View>
            </View>

            <View className="bg-surface rounded-2xl border border-border p-4">
              <Text className="text-muted-fg text-[10px] font-bold uppercase tracking-widest">
                Order
              </Text>
              {/* Use frozenSummary values when set (during the Place Order
                  → Stripe sheet → navigate window) so the summary behind
                  the payment sheet doesn't recompute to RM 0 once the
                  cart is cleared. Falls back to live values when not
                  frozen — i.e. normal browsing of the checkout screen. */}
              {(() => {
                const items          = frozenSummary?.items          ?? cart;
                const dispSubtotal   = frozenSummary?.subtotal       ?? subtotal;
                // Reward + promo lists already reflect the
                // non-stackable-tier exclusivity (computed at
                // component-top so the Place Order button stays in
                // sync). When frozenSummary is in effect (payment
                // in progress) we use the snapshot verbatim — that's
                // a frozen receipt of what got billed.
                const dispReward     = frozenSummary?.rewardDiscount ?? rewardDiscount;
                const dispRewardName = frozenSummary?.rewardName     ?? (rewardDiscount > 0 ? (appliedReward?.name ?? null) : null);
                const rawDispPromos  = frozenSummary?.promoDiscounts ?? promoEval?.discounts ?? [];
                const dispPromos     = frozenSummary
                  ? rawDispPromos
                  : dropTierPerk
                    ? rawDispPromos.filter((d) => d.reason !== "tier_perk")
                    : rawDispPromos;
                const dispSst        = frozenSummary?.sst            ?? sst;
                const dispGrand      = frozenSummary?.grandTotal     ?? grandTotal;
                const dispAfter      = frozenSummary?.afterDiscount  ?? afterDiscount;
                const effRewardName  = dispRewardName;
                const effReward      = dispReward;
                return (
                  <View className="mt-2 gap-1.5">
                    {items.map((i) => (
                      <View key={i.cartId} style={{ gap: 2 }}>
                        <View className="flex-row justify-between">
                          <Text className="text-espresso flex-1">
                            {i.quantity}× {i.name}
                          </Text>
                          <Text className="text-espresso">{formatPrice(i.totalPrice)}</Text>
                        </View>
                        {/* Modifier chips and special instructions —
                            previously hidden on checkout. Customer
                            confirms exactly what they're ordering, including
                            "oat milk · less sweet" and any free-text note
                            for the barista, before paying. */}
                        {i.modifiers.length > 0 && (
                          <Text
                            className="text-muted-fg text-[12px]"
                            numberOfLines={2}
                            style={{ paddingRight: 60 }}
                          >
                            {i.modifiers.map((m) => m.label).join(" · ")}
                          </Text>
                        )}
                        {i.specialInstructions ? (
                          <Text
                            className="text-muted-fg text-[12px] italic"
                            numberOfLines={2}
                            style={{ paddingRight: 60 }}
                          >
                            “{i.specialInstructions}”
                          </Text>
                        ) : null}
                      </View>
                    ))}
                    <View className="flex-row justify-between mt-3 pt-3 border-t border-border">
                      <Text className="text-muted-fg">Subtotal</Text>
                      <Text className="text-espresso">{formatPrice(dispSubtotal)}</Text>
                    </View>
                    {effRewardName && effReward > 0 && (
                      <View className="flex-row justify-between">
                        <Text className="text-primary text-[13px]" numberOfLines={1}>
                          Reward · {effRewardName}
                        </Text>
                        <Text className="text-primary">−{formatPrice(effReward)}</Text>
                      </View>
                    )}
                    {dispPromos.map((d) => (
                      <View key={d.promotion_id} className="flex-row justify-between">
                        <Text className="text-primary text-[13px]" numberOfLines={1}>
                          {d.promotion_name}
                        </Text>
                        <Text className="text-primary">
                          −{formatPrice(d.discount_amount)}
                        </Text>
                      </View>
                    ))}
                    {sstConfig.enabled && dispSst > 0 && (
                      <View className="flex-row justify-between">
                        <Text className="text-muted-fg text-[13px]">
                          SST ({Math.round(sstConfig.rate * 100)}%)
                        </Text>
                        <Text className="text-muted-fg text-[13px]">{formatPrice(dispSst)}</Text>
                      </View>
                    )}
                    <View className="flex-row justify-between mt-2 pt-2 border-t border-border">
                      <Text className="text-espresso font-bold">Total</Text>
                      <Text
                        className="text-primary"
                        style={{ fontFamily: "Peachi-Bold" }}
                      >
                        {formatPrice(dispGrand)}
                      </Text>
                    </View>
                    {tier && tier.tier_name && (
                      <View className="flex-row justify-between mt-2">
                        <Text className="text-muted-fg text-[13px]" numberOfLines={1}>
                          {tier.tier_name} · earning {tier.tier_multiplier}×
                        </Text>
                        <Text
                          className="text-[13px]"
                          style={{ color: tier.tier_color ?? "#92400e" }}
                        >
                          +{Math.round(dispAfter * (tier.tier_multiplier ?? 1))} pts
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })()}
            </View>

            {!paymentsEnabled && (
              <View className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex-row gap-3">
                <AlertCircle size={18} color="#B45309" />
                <View className="flex-1">
                  <Text
                    className="text-amber-900 text-[14px]"
                    style={{ fontFamily: "Peachi-Bold" }}
                  >
                    Online ordering paused
                  </Text>
                  <Text
                    className="text-amber-800 text-[12px] mt-0.5"
                    style={{ fontFamily: "SpaceGrotesk_400Regular" }}
                  >
                    We're not taking online payments right now. Please order at the counter.
                  </Text>
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Sticky bottom Place Order — visible without scrolling, total stays
          in view as customer scrolls through the summary above. */}
      {step === "review" && (
        <View
          className="bg-surface border-t border-border"
          style={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: insets.bottom + 12,
          }}
        >
          {lastError && (
            <Pressable
              onPress={() => setLastError(null)}
              className="bg-red-50 border border-red-200 rounded-2xl px-3 py-2 mb-2 flex-row items-start gap-2"
            >
              <AlertCircle size={14} color="#B91C1C" />
              <Text
                className="text-red-800 text-[11px] flex-1"
                style={{ fontFamily: "SpaceGrotesk_500Medium" }}
                selectable
              >
                {lastError}
              </Text>
            </Pressable>
          )}
          {outletClosed && (
            <View
              className="bg-amber-50 border border-amber-200 rounded-2xl px-3 py-2 mb-2 flex-row items-start gap-2"
            >
              <AlertCircle size={14} color="#92400e" />
              <Text
                className="text-amber-900 text-[12px] flex-1"
                style={{ fontFamily: "SpaceGrotesk_500Medium" }}
              >
                {currentOutlet?.name ?? "This outlet"} just closed. Switch to another outlet to place your order.
              </Text>
            </View>
          )}
          <PrimaryButton
            label={
              !paymentsEnabled
                ? "Online ordering paused"
                : outletClosed
                  ? "Outlet closed — switch outlet"
                  : `Place order · ${formatPrice(grandTotal)}`
            }
            onPress={onPlaceOrder}
            loading={busy}
            loadingLabel={busyLabel}
            disabled={!paymentsEnabled || outletClosed}
          />
        </View>
      )}

      {/* Payment success overlay — animates over the checkout content
          for ~1.4s after a successful payment (or zero-amount bypass)
          before router.replace navigates to /order/[id]. Gives the
          customer a clear "yes, that worked" moment instead of an
          abrupt screen swap. Backdrop is semi-opaque cream so the
          rest of the page recedes without going to black. */}
      {paymentSuccess && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "rgba(255,247,231,0.96)",
            alignItems: "center",
            justifyContent: "center",
            opacity: successOpacity,
          }}
        >
          <Animated.View
            style={{
              width: 88,
              height: 88,
              borderRadius: 44,
              backgroundColor: "#C05040",
              alignItems: "center",
              justifyContent: "center",
              transform: [{ scale: successScale }],
              shadowColor: "#C05040",
              shadowOpacity: 0.35,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 6 },
              elevation: 6,
            }}
          >
            <Check size={48} color="#FFFFFF" strokeWidth={3} />
          </Animated.View>
          <Animated.Text
            style={{
              marginTop: 18,
              color: "#160800",
              fontFamily: "Peachi-Bold",
              fontSize: 22,
              opacity: successOpacity,
            }}
          >
            Payment successful
          </Animated.Text>
          <Animated.Text
            style={{
              marginTop: 4,
              color: "rgba(26,2,0,0.6)",
              fontFamily: "SpaceGrotesk_500Medium",
              fontSize: 13,
              opacity: successOpacity,
            }}
          >
            We're starting on your order now
          </Animated.Text>
        </Animated.View>
      )}
    </View>
  );
}
