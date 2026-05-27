"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CreditCard, Wallet, Banknote } from "lucide-react";

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
  };
};

const METHODS: Array<{ id: string; label: string; Icon: typeof CreditCard }> = [
  { id: "card",    label: "Card",     Icon: CreditCard },
  { id: "fpx",     label: "FPX",      Icon: Banknote },
  { id: "grabpay", label: "GrabPay",  Icon: Wallet },
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

  useEffect(() => {
    setState(readState() ?? null);
  }, []);

  const subtotal = useMemo(
    () => (state?.cart ?? []).reduce((s, i) => s + i.totalPrice, 0),
    [state],
  );

  if (!state) {
    return <div className="p-8 text-center text-[#8E8E93]">Loading…</div>;
  }

  const cart = state.cart ?? [];
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
          storeId: state.outletId,
          paymentMethod: method,
          loyaltyPhone: state.phone ?? null,
          loyaltyId:    state.loyaltyId ?? null,
          orderType:    "pickup",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to start payment");
      }
      // Stripe path → confirm via PaymentIntent (TODO: integrate Stripe.js).
      // RM path / hosted-page path → redirect.
      if (data.paymentUrl) {
        window.location.href = data.paymentUrl;
        return;
      }
      if (data.clientSecret) {
        // For Stripe we'd normally use Stripe.js client-side. For
        // now, hand the customer over to the order detail page which
        // polls for status; full Stripe Elements integration is a
        // follow-up.
        window.location.href = `/order/${data.orderId}?payment=pending`;
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
        <h2 className="font-peachi font-bold text-[16px]">Pickup from</h2>
        <p className="mt-1 text-sm text-[#6E6E73]">{state.outletName ?? "Select an outlet"}</p>
      </section>

      <section className="px-4 pt-5">
        <h2 className="font-peachi font-bold text-[16px]">Your order</h2>
        <ul className="mt-2 flex flex-col gap-1">
          {cart.map((i) => (
            <li key={i.cartId} className="flex items-baseline gap-3 text-sm">
              <span className="text-[#160800] font-bold w-6">{i.quantity}×</span>
              <span className="flex-1 truncate">{i.name}</span>
              <span className="text-[#A2492C] font-bold">RM{i.totalPrice.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="px-4 pt-5">
        <h2 className="font-peachi font-bold text-[16px]">Pay with</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {METHODS.map((m) => {
            const Icon = m.Icon;
            const active = method === m.id;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setMethod(m.id)}
                  className={`w-full flex items-center gap-3 rounded-2xl border px-4 py-3 text-left active:opacity-80 ${
                    active ? "border-[#160800] bg-[#F7F4F0]" : "border-[#EBE5DE] bg-white"
                  }`}
                >
                  <Icon size={20} color={active ? "#160800" : "#8E8E93"} />
                  <span className="text-sm font-bold flex-1">{m.label}</span>
                  <span
                    className="h-5 w-5 rounded-full border"
                    style={{
                      borderColor: active ? "#160800" : "#C4BDB3",
                      backgroundColor: active ? "#160800" : "transparent",
                    }}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="px-4 pt-5 border-t border-[#EBE5DE] mt-5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-[#6E6E73]">Total</span>
          <span className="font-peachi font-bold text-xl">RM{subtotal.toFixed(2)}</span>
        </div>
      </section>

      {error ? (
        <p className="px-4 pt-3 text-[12px] text-red-600">{error}</p>
      ) : null}

      <div className="mt-5 px-4">
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
      </div>
    </>
  );
}
