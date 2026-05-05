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
import { CreditCard, Smartphone, Check, AlertCircle } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { useApp, cartTotal } from "../lib/store";
import { api, formatPrice } from "../lib/api";
import { calcRewardDiscount } from "../lib/rewards";
import { getSetting } from "../lib/settings";
import { EspressoHeader } from "../components/EspressoHeader";
import { PrimaryButton } from "../components/PrimaryButton";

type Step = "phone" | "otp" | "review";

export default function Checkout() {
  const insets = useSafeAreaInsets();
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

  const subtotal = cartTotal(cart);
  const rewardDiscount = calcRewardDiscount(appliedReward, cart, subtotal);
  const afterDiscount = Math.max(0, subtotal - rewardDiscount);
  const sst = sstConfig.enabled ? +(afterDiscount * sstConfig.rate).toFixed(2) : 0;
  const grandTotal = +(afterDiscount + sst).toFixed(2);

  const [step, setStep] = useState<Step>(phoneFromStore ? "review" : "phone");
  const [phoneInput, setPhoneInput] = useState(phoneFromStore ?? "");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"card" | "ewallet">("card");

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
    try {
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

      // 2. Card / ewallet — open the PWA's hosted payment page in an in-app browser.
      //    PWA handles Stripe Elements (card, FPX, Apple Pay). When the sheet
      //    closes we don't trust its return type — Stripe can succeed even
      //    when the user dismissed manually after payment, and can fail when
      //    they hit the close button mid-flow. Always poll the order status
      //    on return to see what actually happened.
      const payUrl = `https://order.celsiuscoffee.com/order/pending?orderId=${encodeURIComponent(res.orderId)}&from=app`;
      await WebBrowser.openBrowserAsync(payUrl, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
        dismissButtonStyle: "close",
        toolbarColor: "#160800",
        controlsColor: "#FFFFFF",
      });

      // Poll for up to 8 seconds to see if payment confirmed via webhook
      let paid = false;
      for (let i = 0; i < 4; i++) {
        try {
          const statusRes = await fetch(
            `https://order.celsiuscoffee.com/api/orders/${encodeURIComponent(res.orderId)}`,
            { headers: { Origin: "https://order.celsiuscoffee.com", Referer: "https://order.celsiuscoffee.com/" } }
          );
          if (statusRes.ok) {
            const order = await statusRes.json();
            if (
              order.status === "paid" ||
              order.status === "preparing" ||
              order.status === "ready" ||
              order.status === "completed" ||
              order.payment_status === "succeeded"
            ) {
              paid = true;
              break;
            }
          }
        } catch {
          // network blip — try again
        }
        if (i < 3) await new Promise((r) => setTimeout(r, 2000));
      }

      if (paid) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        clearCart();
        router.replace({ pathname: "/order/[id]", params: { id: res.orderId } });
      } else {
        // Payment didn't confirm. Don't clear cart — let user retry from
        // order detail page (which has a "Complete payment" button).
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        router.replace({ pathname: "/order/[id]", params: { id: res.orderId } });
      }
    } catch (e: any) {
      Alert.alert("Couldn't place order", e?.message ?? String(e));
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
        className={`px-4 py-3 rounded-xl border flex-row items-center gap-3 active:opacity-70 ${
          selected ? "bg-primary/8 border-primary" : "bg-surface border-border"
        }`}
      >
        <View
          className={`w-9 h-9 rounded-lg items-center justify-center ${
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

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <EspressoHeader title="Checkout" showBack showCart={false} />

      <ScrollView contentContainerClassName="px-4 py-4 pb-12 gap-6">
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
            <View className="bg-surface rounded-2xl border border-border p-4">
              <Text className="text-muted-fg text-[10px] font-bold uppercase tracking-widest">
                Pickup
              </Text>
              <Text className="text-espresso font-bold text-[15px] mt-1">{outletName}</Text>
            </View>

            <View className="bg-surface rounded-2xl border border-border p-4">
              <Text className="text-muted-fg text-[10px] font-bold uppercase tracking-widest">
                Contact
              </Text>
              <Text className="text-espresso font-bold text-[15px] mt-1">{phoneInput}</Text>
            </View>

            <View>
              <Text className="text-muted-fg text-[11px] font-bold uppercase tracking-wider px-1 mb-2">
                Payment
              </Text>
              <View className="gap-2">
                <PaymentRow method="card" icon={CreditCard} label="Card / Apple Pay" sub="Pay now via Stripe" />
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
                <View className="flex-row justify-between">
                  <Text className="text-muted-fg text-[13px]">SST (6%)</Text>
                  <Text className="text-muted-fg text-[13px]">{formatPrice(sst)}</Text>
                </View>
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
          </>
        )}
        <View style={{ height: insets.bottom }} />
      </ScrollView>
    </View>
  );
}
