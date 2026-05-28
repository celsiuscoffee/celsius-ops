"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Trash2, Plus, Minus, Gift, X, Coffee, ChevronRight } from "lucide-react";
import { calcRewardDiscount, formatRewardValue, type AppliedReward } from "@/lib/reward-discount";

type BestSeller = {
  id: string;
  name: string;
  basePrice: number;
  image: string;
};

type CartItem = {
  cartId: string;
  productId: string;
  name: string;
  image?: string;
  basePrice: number;
  quantity: number;
  totalPrice: number;
  modifiers?: Array<{ groupName?: string; label?: string; priceDelta?: number }>;
  specialInstructions?: string;
};

type Persisted = {
  state?: {
    cart?: CartItem[];
    outletId?: string | null;
    outletName?: string | null;
    appliedReward?: AppliedReward | null;
    phone?: string | null;
    loyaltyId?: string | null;
  };
};

const KEY = "celsius-pickup";

function readReward(): AppliedReward | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    return (JSON.parse(raw) as Persisted).state?.appliedReward ?? null;
  } catch {
    return null;
  }
}

function clearReward() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Persisted;
    const state = parsed.state ?? {};
    state.appliedReward = null;
    window.localStorage.setItem(KEY, JSON.stringify({ ...parsed, state }));
  } catch {
    /* ignore */
  }
}

type CartSnapshot = {
  items: CartItem[];
  outletId: string | null;
  outletName: string | null;
  phone: string | null;
  loyaltyId: string | null;
};

function readCart(): CartSnapshot {
  const empty: CartSnapshot = {
    items: [],
    outletId: null,
    outletName: null,
    phone: null,
    loyaltyId: null,
  };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Persisted;
    return {
      items: parsed.state?.cart ?? [],
      outletId: parsed.state?.outletId ?? null,
      outletName: parsed.state?.outletName ?? null,
      phone: parsed.state?.phone ?? null,
      loyaltyId: parsed.state?.loyaltyId ?? null,
    };
  } catch {
    return empty;
  }
}

function writeCart(items: CartItem[]) {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Persisted) : { state: {} };
    const state = parsed.state ?? {};
    state.cart = items;
    window.localStorage.setItem(KEY, JSON.stringify({ ...parsed, state }));
  } catch {
    /* ignore */
  }
}

type Quote = {
  promoLines: Array<{ name: string; amountSen: number }>;
  promoDiscountSen: number;
  minOrderRm: number;
};

export function CartView({ bestSellers = [] }: { bestSellers?: BestSeller[] }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [outletId, setOutletId] = useState<string | null>(null);
  const [outletName, setOutletName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [loyaltyId, setLoyaltyId] = useState<string | null>(null);
  const [reward, setReward] = useState<AppliedReward | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [outletClosed, setOutletClosed] = useState(false);

  useEffect(() => {
    const snap = readCart();
    setReward(readReward());
    setItems(snap.items);
    setOutletId(snap.outletId);
    setOutletName(snap.outletName);
    setPhone(snap.phone);
    setLoyaltyId(snap.loyaltyId);
    setHydrated(true);
  }, []);

  const subtotal = items.reduce((s, i) => s + i.totalPrice, 0);
  const rewardLines = items.map((i) => ({
    productId: i.productId,
    basePrice: i.basePrice,
    totalPrice: i.totalPrice,
    quantity: i.quantity,
  }));

  // Promotion-engine preview (auto + tier-perk + combo + sale) and the
  // min-order threshold, from the SAME endpoint checkout quotes against
  // so the cart breakdown lines up with the final number. Re-fires when
  // the cart, outlet, or member changes.
  useEffect(() => {
    if (items.length === 0) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    fetch("/api/checkout/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: items.map((i) => ({ product: { id: i.productId }, quantity: i.quantity })),
        storeId: outletId,
        loyaltyPhone: phone,
        loyaltyId,
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
  }, [items, outletId, phone, loyaltyId]);

  // Re-check the chosen outlet's open state so a customer who flipped to
  // closed mid-cart gets a banner here instead of a 422 at checkout.
  // /api/stores carries a 30s server cache; poll on the same cadence.
  useEffect(() => {
    if (!outletId || items.length === 0) {
      setOutletClosed(false);
      return;
    }
    let cancelled = false;
    const check = () => {
      fetch("/api/stores")
        .then((r) => (r.ok ? r.json() : []))
        .then((stores: Array<{ id: string; isOpen: boolean }>) => {
          if (cancelled) return;
          const me = stores.find((s) => s.id === outletId);
          setOutletClosed(!!me && me.isOpen === false);
        })
        .catch(() => {});
    };
    check();
    const id = window.setInterval(check, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [outletId, items.length]);

  const rewardDiscount = Math.min(
    calcRewardDiscount(reward, rewardLines, subtotal),
    subtotal,
  );
  // Reward voucher comes off AFTER the promo engine, matching checkout's
  // discount-layering order. No SST here — that's checkout-only.
  const promoDiscount = quote ? quote.promoDiscountSen / 100 : 0;
  const totalAfterPromo = Math.max(0, subtotal - promoDiscount);
  const discount = Math.min(rewardDiscount, totalAfterPromo);
  const grandTotal = Math.max(0, totalAfterPromo - discount);
  const minOrder = quote?.minOrderRm ?? 0;
  const belowMin = minOrder > 0 && subtotal < minOrder;
  const signedIn = typeof phone === "string" && phone.length > 0;

  const updateQty = (cartId: string, delta: number) => {
    const next = items
      .map((i) => {
        if (i.cartId !== cartId) return i;
        const q = Math.max(0, i.quantity + delta);
        return { ...i, quantity: q, totalPrice: (i.totalPrice / i.quantity) * q };
      })
      .filter((i) => i.quantity > 0);
    setItems(next);
    writeCart(next);
  };

  const remove = (cartId: string) => {
    const next = items.filter((i) => i.cartId !== cartId);
    setItems(next);
    writeCart(next);
  };

  if (!hydrated) {
    return <CartShell outletName={null}>
      <div className="p-8 text-center text-[#8E8E93] text-sm">Loading…</div>
    </CartShell>;
  }

  if (items.length === 0) {
    return (
      <CartShell outletName={outletName}>
        {/* Empty cart sells, not just says "empty" — espresso hero +
            best-seller carousel, matching apps/pickup-native/app
            /cart.tsx:121-245. */}
        <div
          className="mx-4 mt-4 overflow-hidden"
          style={{
            backgroundColor: "#160800",
            borderRadius: 16,
            boxShadow: "0 6px 14px rgba(22,8,0,0.18)",
          }}
        >
          <div style={{ paddingLeft: 20, paddingRight: 20, paddingTop: 24, paddingBottom: 24 }}>
            <span
              className="flex items-center justify-center"
              style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: "#A2492C", marginBottom: 12 }}
            >
              <Coffee size={24} color="#FFFFFF" strokeWidth={2} />
            </span>
            <p
              className="uppercase"
              style={{ color: "#FBBF24", fontSize: 10, fontWeight: 700, letterSpacing: 2 }}
            >
              Cart&apos;s feeling thirsty
            </p>
            <p className="font-peachi font-bold" style={{ color: "#FFFFFF", fontSize: 24, marginTop: 4 }}>
              Let&apos;s brew something
            </p>
            <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 6, fontWeight: 500 }}>
              Tap a favourite below or browse the full menu.
            </p>
            <Link
              href="/menu"
              className="inline-flex items-center gap-1 rounded-full active:opacity-80"
              style={{ backgroundColor: "#FFFFFF", marginTop: 16, paddingLeft: 20, paddingRight: 20, paddingTop: 10, paddingBottom: 10 }}
            >
              <span className="font-peachi font-bold" style={{ color: "#1A0200", fontSize: 13 }}>
                See what&apos;s brewing
              </span>
              <ChevronRight size={14} color="#1A0200" />
            </Link>
          </div>
        </div>

        {bestSellers.length > 0 ? (
          <div className="mt-6">
            <p
              className="uppercase px-4 mb-2"
              style={{ color: "#1A0200", fontSize: 14, fontWeight: 700, letterSpacing: 1.5 }}
            >
              Start with these
            </p>
            <div
              className="flex gap-3 px-4 overflow-x-auto pb-1"
              style={{ scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}
            >
              {bestSellers.map((p) => (
                <Link
                  key={p.id}
                  href={`/product/${p.id}`}
                  className="flex-shrink-0 bg-white overflow-hidden active:opacity-70"
                  style={{
                    width: 160,
                    borderRadius: 16,
                    border: "1px solid rgba(26,2,0,0.10)",
                    boxShadow: "0 3px 8px rgba(0,0,0,0.06)",
                    scrollSnapAlign: "start",
                  }}
                >
                  <div className="relative bg-[#F2EDE5]" style={{ width: 160, height: 200 }}>
                    {p.image ? (
                      <Image src={p.image} alt={p.name} fill sizes="160px" className="object-cover" />
                    ) : null}
                  </div>
                  <div style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10 }}>
                    <p className="font-peachi font-bold truncate" style={{ color: "#1A0200", fontSize: 13 }}>
                      {p.name}
                    </p>
                    <div className="flex items-center justify-between" style={{ marginTop: 4 }}>
                      <span className="font-peachi font-bold" style={{ color: "#A2492C", fontSize: 14 }}>
                        RM{p.basePrice.toFixed(2)}
                      </span>
                      <span
                        className="rounded-full flex items-center justify-center"
                        style={{ width: 24, height: 24, backgroundColor: "#160800" }}
                      >
                        <ChevronRight size={14} color="#FFFFFF" />
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </CartShell>
    );
  }

  return (
    <CartShell outletName={outletName}>
      <ul className="px-4 py-4 flex flex-col gap-3">
        {items.map((item) => (
          <li
            key={item.cartId}
            className="bg-white flex gap-3"
            style={{
              border: "1px solid rgba(26, 2, 0, 0.10)",
              borderRadius: 16,
              padding: 12,
              boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
            }}
          >
            <Link
              href={`/product/${item.productId}?cartId=${item.cartId}`}
              className="relative flex-shrink-0 overflow-hidden bg-[#F2EDE5]"
              style={{ width: 72, height: 72, borderRadius: 14 }}
            >
              {item.image ? (
                <Image src={item.image} alt={item.name} fill sizes="72px" className="object-cover" />
              ) : null}
            </Link>
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="flex items-start gap-2">
                <Link href={`/product/${item.productId}?cartId=${item.cartId}`} className="flex-1 min-w-0">
                  <p
                    className="font-peachi font-bold truncate"
                    style={{ color: "#1A0200", fontSize: 15, lineHeight: "19px" }}
                  >
                    {item.name}
                  </p>
                </Link>
                <span
                  className="font-peachi font-bold flex-shrink-0"
                  style={{ color: "#B91C1C", fontSize: 14 }}
                >
                  RM{item.totalPrice.toFixed(2)}
                </span>
              </div>
              {item.modifiers && item.modifiers.length > 0 ? (
                <p
                  className="line-clamp-1"
                  style={{ color: "#6B6B6B", fontSize: 12, marginTop: 2, fontWeight: 500 }}
                >
                  {item.modifiers.map((m) => m.label).filter(Boolean).join(" · ")}
                </p>
              ) : null}
              {item.specialInstructions ? (
                <p
                  className="line-clamp-1 italic"
                  style={{ color: "#6B6B6B", fontSize: 12, marginTop: 1 }}
                >
                  &ldquo;{item.specialInstructions}&rdquo;
                </p>
              ) : null}
              <div className="mt-auto pt-2 flex items-center gap-3">
                <button
                  onClick={() => updateQty(item.cartId, -1)}
                  className="h-7 w-7 rounded-full border border-[#E0D8CE] flex items-center justify-center active:opacity-60"
                  aria-label="Decrease quantity"
                >
                  <Minus size={14} className="text-[#160800]" />
                </button>
                <span className="font-bold w-5 text-center">{item.quantity}</span>
                <button
                  onClick={() => updateQty(item.cartId, +1)}
                  className="h-7 w-7 rounded-full bg-[#160800] flex items-center justify-center active:opacity-80"
                  aria-label="Increase quantity"
                >
                  <Plus size={14} color="#FFFFFF" />
                </button>
                <button
                  onClick={() => remove(item.cartId)}
                  className="ml-auto p-1 active:opacity-60"
                  aria-label="Remove"
                >
                  <Trash2 size={16} color="#8E8E93" />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {reward ? (
        <div
          className="mx-4 mt-1 mb-3 flex items-center gap-2 rounded-2xl px-3 py-2"
          style={{ backgroundColor: "rgba(185,28,28,0.10)" }}
        >
          <span
            className="flex items-center justify-center"
            style={{ width: 32, height: 32, borderRadius: 999, backgroundColor: "#B91C1C" }}
          >
            <Gift size={14} color="#FFFFFF" strokeWidth={2} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-peachi font-bold text-[13px]" style={{ color: "#B91C1C" }}>
              {reward.name ?? formatRewardValue(reward)}
            </p>
            <p className="text-[11px]" style={{ color: "rgba(185,28,28,0.80)" }}>
              {discount > 0
                ? `Reward applied · −RM${discount.toFixed(2)}`
                : "Reward applied — discount at checkout"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              clearReward();
              setReward(null);
            }}
            className="p-1 active:opacity-60"
            aria-label="Remove reward"
          >
            <X size={14} color="#B91C1C" />
          </button>
        </div>
      ) : null}

      <div className="px-4 pt-4 pb-2 border-t border-[rgba(26,2,0,0.10)]">
        <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
          <span className="text-[13px]" style={{ color: "#6B6B6B" }}>Subtotal</span>
          <span className="text-[14px]" style={{ color: "#1A0200", fontWeight: 500 }}>
            RM{subtotal.toFixed(2)}
          </span>
        </div>
        {(quote?.promoLines ?? []).map((p, i) => (
          <div key={i} className="flex items-center justify-between" style={{ marginBottom: 4 }}>
            <span className="text-[13px] truncate" style={{ color: "#B91C1C", paddingRight: 8 }}>
              {p.name}
            </span>
            <span className="text-[14px] flex-shrink-0" style={{ color: "#B91C1C", fontWeight: 500 }}>
              −RM{(p.amountSen / 100).toFixed(2)}
            </span>
          </div>
        ))}
        {discount > 0 ? (
          <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
            <span className="text-[13px]" style={{ color: "#B91C1C" }}>
              Reward discount
            </span>
            <span className="text-[14px]" style={{ color: "#B91C1C", fontWeight: 500 }}>
              −RM{discount.toFixed(2)}
            </span>
          </div>
        ) : null}
        <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
          <span className="font-peachi font-bold" style={{ color: "#1A0200", fontSize: 15 }}>
            Total
          </span>
          <span className="font-peachi font-bold" style={{ color: "#1A0200", fontSize: 18 }}>
            RM{grandTotal.toFixed(2)}
          </span>
        </div>
        {signedIn && grandTotal > 0 ? (
          <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
            <span style={{ color: "#6B6B6B", fontSize: 11, fontWeight: 500 }}>
              You&apos;ll earn
            </span>
            <span style={{ color: "#6B6B6B", fontSize: 11, fontWeight: 700 }}>
              +{Math.floor(grandTotal)} pts
            </span>
          </div>
        ) : null}

        {outletClosed ? (
          <div
            className="flex items-start gap-2.5 rounded-2xl px-3 py-3"
            style={{
              backgroundColor: "rgba(162, 73, 44, 0.10)",
              border: "1px solid rgba(162, 73, 44, 0.25)",
              marginTop: 12,
              marginBottom: 12,
            }}
          >
            <span
              style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#A2492C", marginTop: 6 }}
              className="flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="font-peachi font-bold text-[13px]" style={{ color: "#1A0200" }}>
                {outletName ?? "This outlet"} just closed
              </p>
              <p className="text-[11px]" style={{ color: "#6B6B6B", fontWeight: 500, marginTop: 2 }}>
                Pick another outlet to continue, or come back when we open.
              </p>
            </div>
            <Link
              href="/store"
              className="flex-shrink-0 active:opacity-70 text-[12px] font-bold"
              style={{ color: "#A2492C" }}
            >
              Switch
            </Link>
          </div>
        ) : null}

        {belowMin ? (
          <p
            className="text-center text-[12px]"
            style={{ color: "#A2492C", fontWeight: 500, marginTop: 12, marginBottom: 8 }}
          >
            Add RM{(minOrder - subtotal).toFixed(2)} more to checkout (min RM{minOrder.toFixed(2)})
          </p>
        ) : null}

        {belowMin || outletClosed ? (
          <div
            className="block w-full rounded-full text-white text-center py-4 font-peachi font-bold cursor-not-allowed"
            style={{ marginTop: belowMin ? 0 : 12, backgroundColor: "rgba(162,73,44,0.40)" }}
            aria-disabled="true"
          >
            {outletClosed ? "Outlet closed" : "Continue to checkout"}
          </div>
        ) : (
          <Link
            href="/checkout"
            className="block w-full rounded-full bg-[#A2492C] text-white text-center py-4 font-peachi font-bold active:opacity-80"
            style={{ marginTop: 12 }}
          >
            Continue to checkout
          </Link>
        )}
      </div>
    </CartShell>
  );
}

function CartShell({
  outletName,
  children,
}: {
  outletName: string | null;
  children: React.ReactNode;
}) {
  return (
    <>
      <header
        className="bg-[#160800] text-white px-4 pb-3 flex items-center gap-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Link href="/" className="-ml-1 p-1 active:opacity-60" aria-label="Back">
          <ArrowLeft size={20} color="#FFFFFF" />
        </Link>
        <div className="flex-1 min-w-0">
          {outletName ? (
            <p className="text-[10px] text-white/50 uppercase tracking-widest truncate">
              Pickup from {outletName}
            </p>
          ) : null}
          <h1
            className="text-[22px] truncate"
            style={{ fontFamily: "var(--font-display)", letterSpacing: -0.3, fontWeight: 700 }}
          >
            Your cart
          </h1>
        </div>
      </header>
      {children}
    </>
  );
}
