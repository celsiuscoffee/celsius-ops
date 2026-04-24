"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, MapPin, ChevronRight, Loader2, Clock, ShoppingBag,
  Star, Gift, X, ChevronDown,
} from "lucide-react";
import { ProductImage } from "@/components/product-image";
import { useCartStore } from "@/store/cart";
import { StripePaymentSheet } from "@/components/stripe-payment-sheet";


// All payment methods route through Stripe (live keys, MYR supported).
const STRIPE_METHODS = new Set(["card", "apple_pay", "google_pay", "fpx", "grabpay", "tng", "boost"]);
const RM_METHODS     = new Set<string>();

const PAYMENT_METHODS = [
  { id: "fpx",        name: "FPX Online Banking",  color: "bg-white",     logo: "fpx.svg"       },
  { id: "apple_pay",  name: "Apple Pay",           color: "bg-black",     logo: "apple-pay.svg" },
  { id: "google_pay", name: "Google Pay",          color: "bg-white",     logo: "google-pay.png"},
  { id: "grabpay",    name: "GrabPay",             color: "bg-[#00B14F]", logo: "grabpay.png"   },
  { id: "card",       name: "Credit / Debit Card", color: "bg-gray-600",  logo: "card.svg"      },
];

interface LoyaltyReward {
  id: string;
  name: string;
  description: string | null;
  points_required: number;
  category: string;
  discount_type?: 'flat' | 'percent' | 'free_item' | 'bogo';
  discount_value?: number; // sen for flat, percent value for percent
}

function calcRewardDiscount(reward: LoyaltyReward | null, cartItems: { totalPrice: number; quantity: number }[], subtotal: number): number {
  if (!reward) return 0;
  if (reward.discount_type === 'free_item') {
    // Deduct cheapest item in cart
    const prices = cartItems.map((i) => i.totalPrice / i.quantity);
    return prices.length > 0 ? Math.min(...prices) : 0;
  }
  if (reward.discount_type === 'bogo') {
    // Buy 1 Get 1 — deduct 2nd cheapest unit price
    const unitPrices = cartItems.flatMap((i) => Array(i.quantity).fill(i.totalPrice / i.quantity)) as number[];
    unitPrices.sort((a, b) => b - a); // descending
    return unitPrices[1] ?? 0; // 2nd item free
  }
  if (reward.discount_type === 'percent' && reward.discount_value) {
    return subtotal * (reward.discount_value / 100);
  }
  if (reward.discount_type === 'flat' && reward.discount_value) {
    return reward.discount_value / 100;
  }
  return 0;
}

export default function CheckoutPage() {
  const router         = useRouter();
  const items          = useCartStore((s) => s.items);
  const selectedStore  = useCartStore((s) => s.selectedStore);
  const total          = useCartStore((s) => s.getTotal());
  const clearCart      = useCartStore((s) => s.clearCart);
  const hasHydrated    = useCartStore((s) => s._hasHydrated);
  const appliedVoucher = useCartStore((s) => s.appliedVoucher);
  const addRecentOrder = useCartStore((s) => s.addRecentOrder);
  const loyaltyMember     = useCartStore((s) => s.loyaltyMember);
  const orderType         = useCartStore((s) => s.orderType);
  const tableNumber       = useCartStore((s) => s.tableNumber);

  const [selectedPayment, setSelectedPayment] = useState("fpx");
  const [orderNote, setOrderNote]             = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Payment sheet state — set after order is created + PaymentIntent returned
  const [clientSecret, setClientSecret]     = useState<string | null>(null);
  const [paymentOrderId, setPaymentOrderId] = useState<string | null>(null);
  const [pendingOrder, setPendingOrder]     = useState<{ orderId: string; orderNumber: string; totalSen: number } | null>(null);

  const [sstRate, setSstRate]     = useState(0.06);
  const [sstEnabled, setSstEnabled] = useState(true);

  useEffect(() => {
    fetch("/api/settings?key=sst")
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data === "object") {
          if (typeof data.enabled === "boolean") setSstEnabled(data.enabled);
          if (typeof data.rate === "number") setSstRate(data.rate);
        }
      })
      .catch(() => {
        setSstEnabled(true);
        setSstRate(0.06);
      });
  }, []);

  // Snapshot total + item count before cart is cleared so the bottom bar stays correct
  const [snapshotTotal, setSnapshotTotal] = useState<number | null>(null);
  const [snapshotItemCount, setSnapshotItemCount] = useState<number | null>(null);

  // Rewards redeem state
  const [showRewardsModal, setShowRewardsModal] = useState(false);
  const [rewardsLoading, setRewardsLoading]     = useState(false);
  const [availableRewards, setAvailableRewards] = useState<LoyaltyReward[]>([]);
  const [appliedReward, setAppliedReward]       = useState<LoyaltyReward | null>(null);

  const discountRM       = appliedVoucher ? appliedVoucher.discountSen / 100 : 0;
  const rewardDiscountRM = calcRewardDiscount(appliedReward, items, total);
  const afterDiscount    = Math.max(0, total - discountRM - rewardDiscountRM);
  const sst              = sstEnabled ? afterDiscount * sstRate : 0;
  const grandTotal       = afterDiscount + sst;
  const pointsToEarn     = loyaltyMember ? Math.floor(afterDiscount) : 0;

  async function openRewardsModal() {
    if (!loyaltyMember) return;
    setShowRewardsModal(true);
    setRewardsLoading(true);
    try {
      const res = await fetch(`/api/loyalty/rewards?phone=${encodeURIComponent(loyaltyMember.phone)}`);
      if (!res.ok) throw new Error("Failed to load rewards");
      const data = await res.json();
      setAvailableRewards(data.rewards ?? []);
    } catch {
      setAvailableRewards([]);
    } finally {
      setRewardsLoading(false);
    }
  }

  function applyReward(reward: LoyaltyReward) {
    setAppliedReward(reward);
    setShowRewardsModal(false);
  }

  function saveOrderAndClearCart(orderId: string, orderNumber: string, totalSen: number) {
    const itemCount = items.reduce((s, i) => s + i.quantity, 0);
    // Snapshot before clearing so bottom bar keeps showing correct values
    setSnapshotTotal(grandTotal);
    setSnapshotItemCount(itemCount);
    addRecentOrder({
      orderId,
      orderNumber,
      storeId:   selectedStore?.id ?? "",
      totalSen:  totalSen ?? Math.round(grandTotal * 100),
      itemCount,
      createdAt: new Date().toISOString(),
    });
    clearCart();
  }

  async function handlePlaceOrder() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/checkout/initiate", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          selectedStore,
          paymentMethod:     selectedPayment,
          total,
          sst,
          discountSen:       appliedVoucher?.discountSen ?? 0,
          voucherCode:       appliedVoucher?.code ?? null,
          voucherId:         appliedVoucher?.voucherId ?? null,
          rewardDiscountSen: Math.round(rewardDiscountRM * 100),
          rewardId:          appliedReward?.id ?? null,
          rewardName:        appliedReward?.name ?? null,
          rewardPointsCost:  appliedReward?.points_required ?? 0,
          loyaltyPhone:      loyaltyMember?.phone ?? null,
          loyaltyId:         loyaltyMember?.id ?? null,
          notes:             orderNote.trim() || null,
          orderType,
          tableNumber,
        }),
      });

      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Checkout failed");
      }

      const data = await res.json() as {
        orderId: string; orderNumber: string; totalSen: number;
        clientSecret?: string;
        freeOrder?: boolean;
        // Legacy redirect fallback (Revenue Monster)
        paymentType?: string; paymentUrl?: string;
      };

      // Reward fully covers the bill — no gateway step, already "preparing".
      if (data.freeOrder) {
        saveOrderAndClearCart(data.orderId, data.orderNumber, data.totalSen);
        router.push(`/order/${data.orderId}?payment=done`);
        return;
      }

      // New flow: Stripe PaymentIntent — open payment sheet.
      // Save order to recentOrders NOW (before any redirect) so FPX orders
      // appear in history even if the browser navigates away to the bank.
      if (data.clientSecret) {
        addRecentOrder({
          orderId:    data.orderId,
          orderNumber: data.orderNumber,
          storeId:    selectedStore?.id ?? "",
          totalSen:   data.totalSen,
          itemCount:  items.reduce((s, i) => s + i.quantity, 0),
          createdAt:  new Date().toISOString(),
        });
        setPendingOrder({ orderId: data.orderId, orderNumber: data.orderNumber, totalSen: data.totalSen });
        setClientSecret(data.clientSecret);
        setPaymentOrderId(data.orderId);
        setLoading(false);
        return;
      }

      // Legacy fallback: redirect (Revenue Monster) — clear cart immediately
      saveOrderAndClearCart(data.orderId, data.orderNumber, data.totalSen);
      if (data.paymentUrl) {
        window.location.href = data.paymentUrl;
        return;
      }

      throw new Error("Unexpected response from checkout");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  if (hasHydrated && items.length === 0 && !loading && !pendingOrder) {
    router.push("/cart");
    return null;
  }

  if (hasHydrated && !selectedStore) {
    router.push("/store");
    return null;
  }

  if (!hasHydrated || items.length === 0) {
    return <div className="flex flex-col min-h-dvh bg-[#f5f5f5]" />;
  }

  return (
    <div className="flex flex-col min-h-dvh bg-[#f5f5f5]">
      {/* Header */}
      <header className="bg-white px-4 pt-12 pb-3 flex items-center gap-3 sticky top-0 z-10 border-b">
        <button onClick={() => router.back()} className="p-1">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-base font-semibold flex-1 text-center">Checkout</h1>
        <div className="w-7" />
      </header>

      <main className="flex-1 overflow-y-auto pb-32 space-y-3 pt-3 px-4">
        {/* Order type banner */}
        <div className="bg-[#160800] rounded-2xl px-4 py-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
            <ShoppingBag className="h-4 w-4 text-white" />
          </div>
          <div>
            {orderType === "dine_in" ? (
              <>
                <p className="text-white font-bold text-sm">Dine-In · Table {tableNumber}</p>
                <p className="text-white/60 text-xs mt-0.5">
                  Your order will be served to your table
                </p>
              </>
            ) : (
              <>
                <p className="text-white font-bold text-sm">Self-Pickup Order</p>
                <p className="text-white/60 text-xs mt-0.5">
                  Walk in, show your order number, collect your drinks
                </p>
              </>
            )}
          </div>
        </div>

        {/* Pick-up / Dine-in */}
        <section>
          <h2 className="text-lg font-bold text-[#160800] mb-2">{orderType === "dine_in" ? "Dine-In" : "Pick-up"}</h2>
          <div className="bg-white rounded-2xl overflow-hidden">
            {/* Estimated pickup time */}
            <div className="px-4 pt-4 pb-3 border-b border-border/50 flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary shrink-0" />
              <p className="text-sm font-semibold text-[#160800]">Estimated ready: <span className="text-primary">{selectedStore?.pickupTime ?? "~15 min"}</span></p>
            </div>

            {/* Store location */}
            {selectedStore && (
              <button
                onClick={() => router.push("/store")}
                className="w-full px-4 py-3 flex items-center justify-between text-left"
              >
                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold text-sm">{selectedStore.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{selectedStore.address}</p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            )}
          </div>
        </section>

        {/* Order summary */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-bold text-[#160800]">Order summary</h2>
            <button
              onClick={() => router.push(selectedStore ? `/menu?store=${selectedStore.id}` : "/store")}
              className="text-sm text-primary font-medium"
            >
              Add more items
            </button>
          </div>
          <div className="bg-white rounded-2xl overflow-hidden">
            {items.map((item, i) => {
              const mods = item.modifiers.selections.map((s) => s.label).join(" / ");
              return (
                <div
                  key={item.id}
                  className={`px-4 py-3 flex items-center gap-3 ${
                    i < items.length - 1 ? "border-b border-border/50" : ""
                  }`}
                >
                  <div className="w-14 h-14 rounded-2xl bg-white border border-border/40 overflow-hidden shrink-0 relative">
                    <ProductImage
                      src={item.product.image}
                      alt={item.product.name}
                      fill
                      sizes="56px"
                      thumbnailWidth={56}
                      fit="contain"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-[#160800]">{item.product.name}</p>
                    {mods && <p className="text-xs text-muted-foreground mt-0.5 truncate">{mods}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">x{item.quantity}</p>
                    <p className="font-semibold text-sm text-[#160800]">RM {item.totalPrice.toFixed(2)}</p>
                  </div>
                </div>
              );
            })}

            {/* Applied voucher discount amount row */}
            {appliedVoucher && discountRM > 0 && (
              <div className="px-4 py-1 flex items-center justify-between">
                <span className="text-xs text-emerald-600">
                  {appliedVoucher.discountLabel}
                </span>
                <span className="text-sm font-semibold text-emerald-600">- RM {discountRM.toFixed(2)}</span>
              </div>
            )}

            {/* Applied reward row */}
            {appliedReward && (
              <div className="px-4 py-3 border-t border-border/50 flex items-center gap-2">
                <Gift className="h-3.5 w-3.5 text-purple-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold text-purple-700">{appliedReward.name}</span>
                  <span className="text-xs text-purple-600 ml-1.5">({appliedReward.points_required} pts)</span>
                </div>
                {appliedReward && rewardDiscountRM > 0 && (
                  <span className="text-sm font-semibold text-purple-600">- RM {rewardDiscountRM.toFixed(2)}</span>
                )}
                <button
                  onClick={() => setAppliedReward(null)}
                  className="text-xs text-muted-foreground p-1 hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {sstEnabled && (
              <div className="px-4 py-3 border-t border-border/50 flex justify-between text-sm">
                <span className="text-muted-foreground">SST ({(sstRate * 100).toFixed(0)}%)</span>
                <span className="text-muted-foreground">RM {sst.toFixed(2)}</span>
              </div>
            )}
          </div>
        </section>

        {/* Rewards section — only for logged-in loyalty members */}
        {loyaltyMember && (
          <section>
            <h2 className="text-lg font-bold text-[#160800] mb-2">Rewards</h2>
            {appliedReward ? (
              <div className="bg-purple-50 border border-purple-200 rounded-2xl px-4 py-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                  <Gift className="h-4 w-4 text-purple-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-purple-800">{appliedReward.name}</p>
                  <p className="text-xs text-purple-600 mt-0.5">
                    {appliedReward.points_required} pts will be deducted from your balance
                  </p>
                </div>
                <button
                  onClick={() => setAppliedReward(null)}
                  className="text-purple-400 hover:text-purple-600 p-1"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={openRewardsModal}
                className="w-full bg-white border border-border rounded-2xl px-4 py-3.5 flex items-center gap-3 text-left"
              >
                <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center shrink-0">
                  <Gift className="h-4 w-4 text-purple-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-[#160800]">Redeem a Reward</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {loyaltyMember.pointsBalance.toLocaleString()} pts available
                  </p>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            )}
          </section>
        )}

        {/* Loyalty points earn banner */}
        {loyaltyMember && pointsToEarn > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
              <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-800">
                Earn {pointsToEarn} pts with this order
              </p>
              <p className="text-xs text-amber-600 mt-0.5">
                Current balance: {loyaltyMember.pointsBalance.toLocaleString()} pts
              </p>
            </div>
          </div>
        )}

        {/* Order note */}
        <section>
          <h2 className="text-lg font-bold text-[#160800] mb-2">Order Note</h2>
          <div className="bg-white rounded-2xl overflow-hidden">
            <textarea
              value={orderNote}
              onChange={(e) => setOrderNote(e.target.value)}
              placeholder="Any special requests? (e.g. less ice, oat milk, extra shot)"
              maxLength={200}
              rows={3}
              className="w-full px-4 py-3.5 text-sm resize-none outline-none placeholder:text-muted-foreground/50 rounded-2xl"
            />
          </div>
        </section>

        {/* Payment */}
        <section>
          <h2 className="text-lg font-bold text-[#160800] mb-2">Payment</h2>
          <div className="bg-white rounded-2xl overflow-hidden">
            {PAYMENT_METHODS.map((method, i) => (
              <button
                key={method.id}
                onClick={() => setSelectedPayment(method.id)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 transition-colors ${
                  i < PAYMENT_METHODS.length - 1 ? "border-b border-border/50" : ""
                } ${selectedPayment === method.id ? "bg-primary/5" : "bg-white"}`}
              >
                <div className={`w-10 h-10 rounded-xl ${method.color} flex items-center justify-center shrink-0 overflow-hidden p-1.5 ${method.color === "bg-white" ? "border border-gray-200" : ""}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/payment-icons/${method.logo}`} alt={method.name} className="w-full h-full object-contain" />
                </div>
                <span className="flex-1 text-left text-sm font-medium">{method.name}</span>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  selectedPayment === method.id ? "border-primary" : "border-border"
                }`}>
                  {selectedPayment === method.id && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                </div>
              </button>
            ))}

          </div>
        </section>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}
      </main>

      {/* Sticky bottom */}
      <div className="fixed bottom-0 inset-x-0 max-w-[430px] mx-auto bg-white border-t px-4 pt-3 pb-6 z-10">
        <div className="flex items-center justify-between mb-3">
          <div>
            {(() => {
              const displayCount = snapshotItemCount ?? items.reduce((n, i) => n + i.quantity, 0);
              const displayTotal = snapshotTotal ?? grandTotal;
              return (
                <>
                  <p className="text-xs text-muted-foreground">
                    {displayCount} item{displayCount !== 1 ? "s" : ""}
                  </p>
                  <p className="text-xl font-bold text-primary">RM {displayTotal.toFixed(2)}</p>
                </>
              );
            })()}
          </div>
          <button
            onClick={handlePlaceOrder}
            disabled={loading}
            className="bg-[#160800] text-white rounded-full px-6 py-3.5 font-semibold text-sm disabled:opacity-60 flex items-center gap-2"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Continue to Payment
          </button>
        </div>
        <p className="text-xs text-center text-muted-foreground">
          Orders are prepared on a first-come, first-served basis
        </p>
      </div>

      {/* Stripe Payment Sheet */}
      {clientSecret && paymentOrderId && pendingOrder && (
        <StripePaymentSheet
          clientSecret={clientSecret}
          orderId={paymentOrderId}
          paymentMethod={selectedPayment}
          total={grandTotal}
          onSuccess={() => {
            // Clear cart on inline payment success (card/Apple Pay/Google Pay).
            // FPX redirects away so this never fires for FPX — cart cleared on order page.
            clearCart();
          }}
          onClose={() => {
            // User dismissed sheet without paying — keep cart intact
            setClientSecret(null);
            setPaymentOrderId(null);
            setPendingOrder(null);
          }}
        />
      )}

      {/* Rewards Modal */}
      {showRewardsModal && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowRewardsModal(false)}
          />
          <div className="relative bg-white rounded-t-3xl max-h-[70vh] flex flex-col max-w-[430px] mx-auto w-full">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b shrink-0">
              <div>
                <h3 className="font-bold text-base text-[#160800]">Your Rewards</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {loyaltyMember?.pointsBalance.toLocaleString()} pts available
                </p>
              </div>
              <button
                onClick={() => setShowRewardsModal(false)}
                className="p-2 rounded-full hover:bg-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {rewardsLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : availableRewards.length === 0 ? (
                <div className="text-center py-10">
                  <Gift className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
                  <p className="text-sm font-medium text-muted-foreground">No rewards available yet</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Keep earning points to unlock rewards
                  </p>
                </div>
              ) : (
                availableRewards.map((reward) => (
                  <div
                    key={reward.id}
                    className="bg-[#f5f5f5] rounded-2xl px-4 py-3.5 flex items-center gap-3"
                  >
                    <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center shrink-0">
                      <Gift className="h-5 w-5 text-purple-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-[#160800]">{reward.name}</p>
                      {reward.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{reward.description}</p>
                      )}
                      <p className="text-xs font-semibold text-purple-700 mt-0.5">{reward.points_required} pts</p>
                    </div>
                    <button
                      onClick={() => applyReward(reward)}
                      className="bg-[#160800] text-white text-xs font-semibold px-4 py-2 rounded-full shrink-0"
                    >
                      Apply
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="px-4 pb-6 pt-2 shrink-0">
              <p className="text-xs text-center text-muted-foreground">
                Points will be deducted when your order is confirmed
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
