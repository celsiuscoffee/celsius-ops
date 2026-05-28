"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CreditCard, Wallet, Banknote } from "lucide-react";
import { StripePaymentForm } from "@/components/stripe-payment-form";
import { calcRewardDiscount, type AppliedReward } from "@/lib/reward-discount";

type CartItem = {
  cartId: string;
  productId: string;
  name: string;
  basePrice: number;
  quantity: number;
  totalPrice: number;
  modifiers: Array<{ groupId: string; groupName: string; optionId: string; label: string; priceDelta: number }>;
  specialInstructions?: string;
};

type Persisted = {
  state?: {
    cart?: CartItem[];
    outletId?: string | null;
    outletName?: string | null;
    phone?: string | null;
    loyaltyId?: string | null;
    appliedReward?: AppliedReward | null;
    orderType?: "pickup" | "dine_in" | null;
    tableNumber?: string | null;
  };
};

type Tier = {
  tier_id: string;
  tier_name: string;
  tier_multiplier: number;
  tier_color?: string | null;
};

const METHODS: Array<{
  id: string;
  label: string;
  subtitle?: string;
  iconSrc?: string;
  iconFallback?: typeof CreditCard;
}> = [
  { id: "card",    label: "Credit / Debit Card", iconSrc: "/payment-icons/card.svg",        iconFallback: CreditCard },
  { id: "fpx",     label: "Online Banking",      subtitle: "FPX",      iconSrc: "/payment-icons/fpx.svg",         iconFallback: Banknote },
  { id: "grabpay", label: "E-Wallet",            subtitle: "GrabPay",  iconSrc: "/payment-icons/grabpay.svg",     iconFallback: Wallet },
];

function readState(): Persisted["state"] {
  try {
    const raw = window.localStorage.getItem("celsius-pickup");
    if (!raw) return {};
    return (JSON.parse(raw) as Persisted).state ?? {};
  } catch {
    return {};
  }
}

export function CheckoutView() {
  const [state, setState] = useState<NonNullable<Persisted["state"]> | null>(null);
  const [method, setMethod] = useState("card");
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stripeContext, setStripeContext] = useState<{ orderId: string; clientSecret: string } | null>(null);
  const [confirmFn, setConfirmFn] = useState<(() => Promise<{ error?: { message?: string } }>) | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [tier, setTier] = useState<Tier | null>(null);

  useEffect(() => {
    setState(readState() ?? null);
  }, []);

  // Same earn-preview line as apps/pickup-native/app/checkout.tsx —
  // pull tier so we can show "{tier_name} · earning {multiplier}× = +{X} pts".
  useEffect(() => {
    const loyaltyId = state?.loyaltyId;
    if (!loyaltyId) {
      setTier(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/loyalty/member-tier?member_id=${encodeURIComponent(loyaltyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data && data.tier_id) setTier(data as Tier);
        else setTier(null);
      })
      .catch(() => !cancelled && setTier(null));
    return () => {
      cancelled = true;
    };
  }, [state?.loyaltyId]);

  const subtotal = useMemo(
    () => (state?.cart ?? []).reduce((s, i) => s + i.totalPrice, 0),
    [state],
  );

  const reward = state?.appliedReward ?? null;
  const rewardDiscount = useMemo(
    () =>
      Math.min(
        calcRewardDiscount(
          reward,
          (state?.cart ?? []).map((i) => ({
            productId: i.productId,
            basePrice: i.basePrice,
            totalPrice: i.totalPrice,
            quantity: i.quantity,
          })),
          subtotal,
        ),
        subtotal,
      ),
    [reward, state, subtotal],
  );
  const rewardDiscountSen = Math.round(rewardDiscount * 100);

  // Server price preview — promo-engine discounts + SST + final total,
  // computed by /api/checkout/quote with the SAME math the order is
  // created with, so the breakdown matches the amount charged.
  const [quote, setQuote] = useState<{
    promoLines: Array<{ name: string; amountSen: number }>;
    promoDiscountSen: number;
    firstOrderDiscountSen: number;
    sstSen: number;
    totalSen: number;
    pointsToEarn: number;
  } | null>(null);

  useEffect(() => {
    const cartItems = state?.cart ?? [];
    if (cartItems.length === 0) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    fetch("/api/checkout/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: cartItems.map((i) => ({ product: { id: i.productId }, quantity: i.quantity })),
        storeId: state?.outletId ?? null,
        loyaltyPhone: state?.phone ?? null,
        loyaltyId: state?.loyaltyId ?? null,
        rewardDiscountSen,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setQuote(d);
      })
      .catch(() => !cancelled && setQuote(null));
    return () => {
      cancelled = true;
    };
  }, [state, rewardDiscountSen]);

  // Use the server quote's total when present; fall back to the
  // client subtotal-minus-reward while it loads.
  const grandTotal = quote ? quote.totalSen / 100 : Math.max(0, subtotal - rewardDiscount);

  if (!state) {
    return <div className="p-8 text-center text-[#8E8E93]">Loading…</div>;
  }

  const cart = state.cart ?? [];
  const isDineIn = state.orderType === "dine_in";
  if (cart.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-[#8E8E93]">Your cart is empty.</p>
        <Link
          href="/menu"
          className="mt-4 inline-block rounded-full bg-[#A2492C] text-white px-5 py-3 font-bold active:opacity-80"
        >
          Browse menu →
        </Link>
      </div>
    );
  }

  const placeOrder = async () => {
    setError(null);
    setPlacing(true);
    try {
      const res = await fetch("/api/checkout/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map((i) => ({
            product:   { id: i.productId, name: i.name },
            modifiers: { selections: i.modifiers ?? [], specialInstructions: i.specialInstructions },
            quantity:  i.quantity,
            totalPrice: i.totalPrice,
          })),
          // The route requires `selectedStore` (with .id) — sending a
          // bare `storeId` string 400s with "Invalid order data".
          // `total` is the pre-discount subtotal in RM; the server
          // applies the reward discount + SST itself.
          selectedStore: { id: state.outletId, name: state.outletName ?? undefined },
          total: subtotal,
          paymentMethod: method,
          loyaltyPhone: state.phone ?? null,
          loyaltyId:    state.loyaltyId ?? null,
          orderType:    state.orderType === "dine_in" ? "dine_in" : "pickup",
          tableNumber:  state.orderType === "dine_in" ? (state.tableNumber ?? null) : null,
          // Forward the applied reward so the server actually discounts
          // the order (otherwise the customer is charged full price).
          rewardId:          reward?.id ?? null,
          rewardName:        reward?.name ?? null,
          rewardPointsCost:  reward?.points_required ?? 0,
          rewardDiscountSen: Math.round(rewardDiscount * 100),
          voucherId:         reward?.voucher_id ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to start payment");
      }
      // Order now exists server-side (pending). Clear the cart + applied
      // reward so a back-nav or re-open of checkout can't re-submit the
      // same basket — any retry happens from the order page via the
      // existing orderId. Mirrors native's clearCart() after placeOrder.
      try {
        const raw = window.localStorage.getItem("celsius-pickup");
        const parsed = raw ? JSON.parse(raw) : { state: {} };
        const s = parsed.state ?? {};
        s.cart = [];
        s.appliedReward = null;
        s.reservedVoucher = null;
        window.localStorage.setItem("celsius-pickup", JSON.stringify({ ...parsed, state: s }));
      } catch {
        /* ignore */
      }
      // Stripe path → confirm via PaymentIntent (TODO: integrate Stripe.js).
      // RM path / hosted-page path → redirect.
      if (data.paymentUrl) {
        window.location.href = data.paymentUrl;
        return;
      }
      if (data.clientSecret) {
        // Stripe path — render Stripe Elements inline so the customer
        // can confirm the payment without leaving the PWA. The form
        // calls /api/orders/[id]/confirm-stripe on success and
        // redirects to the order page.
        setStripeContext({ orderId: data.orderId, clientSecret: data.clientSecret });
        return;
      }
      if (data.freeOrder) {
        window.location.href = `/order/${data.orderId}`;
        return;
      }
      throw new Error("Unknown payment response");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPlacing(false);
    }
  };

  return (
    <>
      <header
        className="bg-[#160800] text-white px-4 pb-3 flex items-center gap-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Link href="/cart" className="-ml-1 p-1 active:opacity-60" aria-label="Back to cart">
          <ArrowLeft size={20} color="#FFFFFF" />
        </Link>
        <h1 className="font-peachi font-bold text-[22px]">Checkout</h1>
      </header>

      <section className="px-4 pt-4">
        <div
          className="bg-white"
          style={{
            border: "1px solid rgba(26,2,0,0.10)",
            borderRadius: 16,
            padding: 16,
          }}
        >
          <p
            className="uppercase"
            style={{ color: "#6B6B6B", fontSize: 10, fontWeight: 700, letterSpacing: 1.4 }}
          >
            {isDineIn ? "Dine-in" : "Pickup from"}
          </p>
          <p
            className="font-peachi font-bold truncate"
            style={{ color: "#1A0200", fontSize: 15, marginTop: 4 }}
          >
            {isDineIn
              ? `Table ${state.tableNumber ?? ""} · ${state.outletName ?? ""}`.trim()
              : state.outletName ?? "Select an outlet"}
          </p>
        </div>
      </section>

      <section className="px-4 pt-3">
        <div
          className="bg-white"
          style={{
            border: "1px solid rgba(26,2,0,0.10)",
            borderRadius: 16,
            padding: 16,
          }}
        >
          <p
            className="uppercase"
            style={{ color: "#6B6B6B", fontSize: 10, fontWeight: 700, letterSpacing: 1.4 }}
          >
            Order
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {cart.map((i) => (
              <li key={i.cartId} className="flex items-baseline gap-3 text-sm">
                <span className="font-peachi font-bold w-6" style={{ color: "#1A0200" }}>
                  {i.quantity}×
                </span>
                <span className="flex-1 truncate" style={{ color: "#1A0200" }}>
                  {i.name}
                </span>
                <span className="font-peachi font-bold" style={{ color: "#1A0200" }}>
                  RM{i.totalPrice.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="px-4 pt-5">
        <h2 className="font-peachi font-bold text-[16px]">Pay with</h2>
        <ul className="mt-2 flex flex-col">
          {METHODS.map((m, idx) => {
            const Fallback = m.iconFallback ?? CreditCard;
            const active = method === m.id;
            const isLast = idx === METHODS.length - 1;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setMethod(m.id)}
                  className="w-full flex items-center text-left active:opacity-80"
                  style={{
                    backgroundColor: "#FFFFFF",
                    border: active
                      ? "2px solid #160800"
                      : "1px solid rgba(26,2,0,0.10)",
                    borderRadius: 16,
                    padding: 14,
                    gap: 14,
                    marginBottom: isLast ? 0 : 8,
                  }}
                >
                  <span
                    className="flex items-center justify-center flex-shrink-0"
                    style={{
                      width: 44,
                      height: 36,
                      borderRadius: 8,
                      backgroundColor: "#F7F4F0",
                      overflow: "hidden",
                    }}
                  >
                    {m.iconSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={m.iconSrc}
                        alt=""
                        style={{
                          maxWidth: "70%",
                          maxHeight: "70%",
                          objectFit: "contain",
                        }}
                      />
                    ) : (
                      <Fallback size={20} color="#1A0200" />
                    )}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span
                      className="block truncate"
                      style={{ color: "#1A0200", fontSize: 14, fontWeight: 700 }}
                    >
                      {m.label}
                    </span>
                    {m.subtitle ? (
                      <span
                        className="block truncate"
                        style={{ color: "#6B6B6B", fontSize: 12, marginTop: 2, fontWeight: 500 }}
                      >
                        {m.subtitle}
                      </span>
                    ) : null}
                  </span>
                  <span
                    className="flex-shrink-0 rounded-full border"
                    style={{
                      width: 20,
                      height: 20,
                      borderColor: active ? "#160800" : "#C4BDB3",
                      backgroundColor: active ? "#160800" : "transparent",
                      borderWidth: active ? 0 : 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {active ? (
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: "#FFFFFF",
                        }}
                      />
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="px-4 pt-4">
        <div
          className="bg-white"
          style={{
            border: "1px solid rgba(26,2,0,0.10)",
            borderRadius: 16,
            padding: 16,
          }}
        >
        <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
          <span className="text-[13px]" style={{ color: "#6B6B6B" }}>Subtotal</span>
          <span className="text-[14px]" style={{ color: "#1A0200", fontWeight: 500 }}>
            RM{subtotal.toFixed(2)}
          </span>
        </div>
        {rewardDiscount > 0 ? (
          <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
            <span className="text-[13px] truncate" style={{ color: "#A2492C" }}>
              Reward{reward?.name ? ` · ${reward.name}` : ""}
            </span>
            <span className="text-[14px]" style={{ color: "#A2492C", fontWeight: 500 }}>
              −RM{rewardDiscount.toFixed(2)}
            </span>
          </div>
        ) : null}
        {(quote?.promoLines ?? []).map((p, i) => (
          <div key={i} className="flex items-center justify-between" style={{ marginBottom: 6 }}>
            <span className="text-[13px] truncate pr-2" style={{ color: "#A2492C" }}>
              {p.name}
            </span>
            <span className="text-[14px]" style={{ color: "#A2492C", fontWeight: 500 }}>
              −RM{(p.amountSen / 100).toFixed(2)}
            </span>
          </div>
        ))}
        {quote && quote.firstOrderDiscountSen > 0 ? (
          <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
            <span className="text-[13px]" style={{ color: "#A2492C" }}>First-order discount</span>
            <span className="text-[14px]" style={{ color: "#A2492C", fontWeight: 500 }}>
              −RM{(quote.firstOrderDiscountSen / 100).toFixed(2)}
            </span>
          </div>
        ) : null}
        {quote && quote.sstSen > 0 ? (
          <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
            <span className="text-[13px]" style={{ color: "#6B6B6B" }}>SST</span>
            <span className="text-[14px]" style={{ color: "#1A0200", fontWeight: 500 }}>
              RM{(quote.sstSen / 100).toFixed(2)}
            </span>
          </div>
        ) : null}
        <div className="flex items-center justify-between pt-3 border-t border-[rgba(26,2,0,0.10)]">
          <span className="font-peachi font-bold" style={{ color: "#1A0200", fontSize: 15 }}>
            Total
          </span>
          <span className="font-peachi font-bold" style={{ color: "#1A0200", fontSize: 18 }}>
            RM{grandTotal.toFixed(2)}
          </span>
        </div>
        {tier ? (
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[12px] truncate" style={{ color: "#6B6B6B" }}>
              {tier.tier_name} · earning {tier.tier_multiplier}×
            </span>
            <span
              className="text-[12px] font-bold"
              style={{ color: tier.tier_color ?? "#92400e" }}
            >
              +{quote ? quote.pointsToEarn : Math.round(grandTotal * (tier.tier_multiplier ?? 1))} pts
            </span>
          </div>
        ) : null}
        </div>
      </section>

      {stripeContext ? (
        <section className="mt-4 px-4">
          <h2 className="font-peachi font-bold text-[16px] mb-3">Payment details</h2>
          <StripePaymentForm
            clientSecret={stripeContext.clientSecret}
            paymentMethod={method}
            orderId={stripeContext.orderId}
            onReady={(fn) => setConfirmFn(() => fn)}
          />
        </section>
      ) : null}

      {error ? (
        <p className="px-4 pt-3 text-[12px] text-red-600">{error}</p>
      ) : null}

      <div className="mt-5 px-4">
        {stripeContext ? (
          <button
            type="button"
            disabled={!confirmFn || confirming}
            onClick={async () => {
              if (!confirmFn) return;
              setConfirming(true);
              setError(null);
              const r = await confirmFn();
              if (r.error) {
                setError(r.error.message ?? "Payment failed");
                setConfirming(false);
                return;
              }
              window.location.href = `/order/${stripeContext.orderId}?payment=done`;
            }}
            className={`block w-full rounded-full text-white text-center py-4 font-bold active:opacity-80 ${
              !confirmFn || confirming ? "bg-[#A2492C]/40" : "bg-[#A2492C]"
            }`}
          >
            {confirming ? "Confirming payment…" : `Pay RM${grandTotal.toFixed(2)}`}
          </button>
        ) : (
        <button
          type="button"
          disabled={placing || !state.outletId}
          onClick={placeOrder}
          className={`block w-full rounded-full text-white text-center py-4 font-bold active:opacity-80 ${
            placing || !state.outletId ? "bg-[#A2492C]/40" : "bg-[#A2492C]"
          }`}
        >
          {placing ? "Placing order…" : !state.outletId ? "Select an outlet first" : "Place order"}
        </button>
        )}
      </div>
    </>
  );
}
