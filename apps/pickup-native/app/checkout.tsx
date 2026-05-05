import { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  Alert,
} from "react-native";
import { Stack, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CreditCard, Smartphone, Check, AlertCircle, Building2, Coffee, MapPin, Clock } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useStripe } from "@stripe/stripe-react-native";
import { useQuery } from "@tanstack/react-query";
import { supabase, type Outlet } from "../lib/supabase";
import { useApp, cartTotal, cartCount } from "../lib/store";
import { api, formatPrice } from "../lib/api";
import { calcRewardDiscount } from "../lib/rewards";
import { getSetting } from "../lib/settings";
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
  const appliedReward = useApp((s) => s.appliedReward);
  const loyaltyId = useApp((s) => s.loyaltyId);

  // SST is config-driven via /api/settings?key=sst — admin can toggle/adjust
  // from backoffice without redeploy.
  const [sstConfig, setSstConfig] = useState({ rate: 0.06, enabled: true });
  const [paymentsEnabled, setPaymentsEnabled] = useState(true);
  useEffect(() => {
    getSetting("sst").then(setSstConfig);
    getSetting("payments_enabled").then((v) => setPaymentsEnabled(v.enabled));
  }, []);

  // Pull live outlet record so the pickup card shows status + ETA — same
  // info the home page surfaces, kept consistent here so the customer
  // confirms exactly what they're committing to.
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
  });
  const currentOutlet = (outlets.data ?? []).find((o) => o.store_id === outletId) ?? null;

  const subtotal = cartTotal(cart);
  const rewardDiscount = calcRewardDiscount(appliedReward, cart, subtotal);
  const afterDiscount = Math.max(0, subtotal - rewardDiscount);
  const sst = sstConfig.enabled ? +(afterDiscount * sstConfig.rate).toFixed(2) : 0;
  const grandTotal = +(afterDiscount + sst).toFixed(2);

  const [step, setStep] = useState<Step>(phoneFromStore ? "review" : "phone");
  const [phoneInput, setPhoneInput] = useState(phoneFromStore ?? "");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"card" | "ewallet" | "fpx">("card");
  const [lastError, setLastError] = useState<string | null>(null);

  const onSendOtp = async () => {
    const normalized = phoneInput.trim().replace(/\s/g, "");
    if (!/^\+?6?01\d{8,9}$/.test(normalized)) {
      Alert.alert("Invalid phone", "Enter a Malaysian number, e.g. 0123456789");
      return;
    }
    setBusy(true);
    try {
      await api.sendOtp(normalized);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep("otp");
    } catch (e) {
      Alert.alert("Couldn't send code", String(e));
    } finally {
      setBusy(false);
    }
  };

  const onVerifyOtp = async () => {
    if (otp.length < 4) return;
    setBusy(true);
    try {
      await api.verifyOtp(phoneInput.trim(), otp.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPhone(phoneInput.trim());
      setStep("review");
    } catch (e) {
      Alert.alert("Couldn't verify", String(e));
    } finally {
      setBusy(false);
    }
  };

  const onPlaceOrder = async () => {
    if (!outletId) {
      Alert.alert("No outlet selected", "Pick an outlet first.");
      return;
    }
    setBusy(true);
    setLastError(null);
    let stage = "init";
    try {
      stage = "create-order";
      // 1. Create the order on the server.
      //    Server expects: selectedStore (object), loyaltyPhone, total (RM), items, paymentMethod.
      const res = await api.placeOrder({
        selectedStore: { id: outletId, name: outletName ?? undefined },
        loyaltyPhone: phoneInput.trim(),
        loyaltyId: loyaltyId ?? undefined,
        paymentMethod,
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
      });

      stage = "create-payment-intent";
      // 2. Card / ewallet — Stripe native PaymentSheet. The server mints a
      //    PaymentIntent for this orderId; we hand the clientSecret to the
      //    native sheet which slides up over the app and handles card entry,
      //    Apple Pay, and SCA inline. On success Stripe also posts a webhook
      //    that flips the order to "preparing"; we additionally call
      //    /confirm-stripe ourselves so the user lands on a moving order
      //    immediately, no polling needed.
      const piRes = await fetch(
        `https://order.celsiuscoffee.com/api/checkout/create-payment-intent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // CSRF middleware requires Origin/Referer matching the host.
            Origin:  "https://order.celsiuscoffee.com",
            Referer: "https://order.celsiuscoffee.com/",
          },
          body: JSON.stringify({ orderId: res.orderId }),
        }
      );
      const piJson = (await piRes.json()) as {
        clientSecret?:    string;
        paymentIntentId?: string;
        error?:           string;
      };
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
        googlePay: { merchantCountryCode: "MY", currencyCode: "myr", testEnv: false },
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
          Alert.alert("Payment failed", presentRes.error.message);
        }
        // Always route to the order page so customer can retry from there.
        router.replace({ pathname: "/order/[id]", params: { id: res.orderId } });
        return;
      }

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
      clearCart();
      router.replace({ pathname: "/order/[id]", params: { id: res.orderId } });
    } catch (e: any) {
      const detail = `[${stage}] ${e?.message ?? String(e)}`;
      setLastError(detail);
      Alert.alert("Couldn't place order", detail);
      console.warn("[checkout]", detail, e);
    } finally {
      setBusy(false);
    }
  };

  const PaymentRow = ({
    method,
    icon: Icon,
    label,
    sub,
  }: {
    method: typeof paymentMethod;
    icon: any;
    label: string;
    sub?: string;
  }) => {
    const selected = paymentMethod === method;
    return (
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          setPaymentMethod(method);
        }}
        className={`px-4 py-3 rounded-2xl border flex-row items-center gap-3 active:opacity-70 ${
          selected ? "bg-primary/8 border-primary" : "bg-surface border-border"
        }`}
      >
        <View
          className={`w-9 h-9 rounded-xl items-center justify-center ${
            selected ? "bg-primary/15" : "bg-background"
          }`}
        >
          <Icon size={18} color={selected ? "#C05040" : "#160800"} />
        </View>
        <View className="flex-1">
          <Text className={selected ? "text-primary font-bold" : "text-espresso font-bold"}>
            {label}
          </Text>
          {sub && <Text className="text-muted-fg text-xs">{sub}</Text>}
        </View>
        {selected && <Check size={18} color="#C05040" />}
      </Pressable>
    );
  };

  // Empty cart guard — covers deep-link / back-nav cases where the user
  // lands here with nothing to pay for.
  if (cartCount(cart) === 0) {
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
              className="mt-3 bg-background border border-border rounded-xl px-4 py-3 text-espresso text-lg"
            />
            <View className="mt-5">
              <PrimaryButton label="Send code" onPress={onSendOtp} loading={busy} />
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
              className="mt-3 bg-background border border-border rounded-xl px-4 py-3 text-espresso text-2xl tracking-widest text-center"
            />
            <View className="mt-5">
              <PrimaryButton label="Verify" onPress={onVerifyOtp} loading={busy} />
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
              <View className="gap-2">
                <PaymentRow method="card" icon={CreditCard} label="Card / Apple Pay" sub="Pay now via Stripe" />
                <PaymentRow method="fpx" icon={Building2} label="FPX online banking" sub="Maybank2u · CIMB Clicks · Public Bank · all banks" />
                <PaymentRow method="ewallet" icon={Smartphone} label="E-wallet" sub="GrabPay · TNG · Boost" />
              </View>
            </View>

            <View className="bg-surface rounded-2xl border border-border p-4">
              <Text className="text-muted-fg text-[10px] font-bold uppercase tracking-widest">
                Order
              </Text>
              <View className="mt-2 gap-1.5">
                {cart.map((i) => (
                  <View key={i.cartId} className="flex-row justify-between">
                    <Text className="text-espresso flex-1">
                      {i.quantity}× {i.name}
                    </Text>
                    <Text className="text-espresso">{formatPrice(i.totalPrice)}</Text>
                  </View>
                ))}
                <View className="flex-row justify-between mt-3 pt-3 border-t border-border">
                  <Text className="text-muted-fg">Subtotal</Text>
                  <Text className="text-espresso">{formatPrice(subtotal)}</Text>
                </View>
                {appliedReward && rewardDiscount > 0 && (
                  <View className="flex-row justify-between">
                    <Text className="text-primary text-[13px]" numberOfLines={1}>
                      Reward · {appliedReward.name}
                    </Text>
                    <Text className="text-primary">−{formatPrice(rewardDiscount)}</Text>
                  </View>
                )}
                {sstConfig.enabled && (
                  <View className="flex-row justify-between">
                    <Text className="text-muted-fg text-[13px]">
                      SST ({Math.round(sstConfig.rate * 100)}%)
                    </Text>
                    <Text className="text-muted-fg text-[13px]">{formatPrice(sst)}</Text>
                  </View>
                )}
                <View className="flex-row justify-between mt-2 pt-2 border-t border-border">
                  <Text className="text-espresso font-bold">Total</Text>
                  <Text
                    className="text-primary"
                    style={{ fontFamily: "Peachi-Bold" }}
                  >
                    {formatPrice(grandTotal)}
                  </Text>
                </View>
              </View>
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
          <PrimaryButton
            label={
              paymentsEnabled
                ? `Place order · ${formatPrice(grandTotal)}`
                : "Online ordering paused"
            }
            onPress={onPlaceOrder}
            loading={busy}
            disabled={!paymentsEnabled}
          />
        </View>
      )}
    </View>
  );
}
