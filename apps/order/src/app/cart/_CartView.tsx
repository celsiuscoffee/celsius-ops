"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Trash2, Plus, Minus, Gift, X } from "lucide-react";

type CartItem = {
  cartId: string;
  productId: string;
  name: string;
  image?: string;
  basePrice: number;
  quantity: number;
  totalPrice: number;
  modifiers?: Array<{ groupName?: string; label?: string; priceDelta?: number }>;
};

type AppliedReward = {
  voucher_id?: string;
  name?: string;
  discount_label?: string;
  discount_sen?: number;
};

type Persisted = {
  state?: {
    cart?: CartItem[];
    outletName?: string | null;
    appliedReward?: AppliedReward | null;
    phone?: string | null;
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

function readCart(): { items: CartItem[]; outletName: string | null; phone: string | null } {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { items: [], outletName: null, phone: null };
    const parsed = JSON.parse(raw) as Persisted;
    return {
      items: parsed.state?.cart ?? [],
      outletName: parsed.state?.outletName ?? null,
      phone: parsed.state?.phone ?? null,
    };
  } catch {
    return { items: [], outletName: null, phone: null };
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

export function CartView() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [outletName, setOutletName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [reward, setReward] = useState<AppliedReward | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const { items, outletName, phone } = readCart();
    setReward(readReward());
    setItems(items);
    setOutletName(outletName);
    setPhone(phone);
    setHydrated(true);
  }, []);

  const subtotal = items.reduce((s, i) => s + i.totalPrice, 0);
  const rewardDiscount = Math.min(reward?.discount_sen ? reward.discount_sen / 100 : 0, subtotal);
  const grandTotal = Math.max(0, subtotal - rewardDiscount);
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
        <div className="p-8 text-center">
          <p className="text-sm text-[#8E8E93]">Your cart is empty.</p>
          <Link
            href="/menu"
            className="mt-4 inline-block rounded-full bg-[#A2492C] text-white px-5 py-3 font-bold active:opacity-80"
          >
            Browse menu →
          </Link>
        </div>
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
                  style={{ color: "#A2492C", fontSize: 14 }}
                >
                  RM{item.totalPrice.toFixed(2)}
                </span>
              </div>
              {item.modifiers && item.modifiers.length > 0 ? (
                <p
                  className="line-clamp-1"
                  style={{ color: "#6B6B6B", fontSize: 12, marginTop: 2, fontWeight: 500 }}
                >
                  {item.modifiers.map((m) => m.label).filter(Boolean).join(", ")}
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
              {reward.name ?? reward.discount_label ?? "Reward applied"}
            </p>
            {reward.discount_sen ? (
              <p className="text-[11px]" style={{ color: "rgba(185,28,28,0.80)" }}>
                {`−RM${(reward.discount_sen / 100).toFixed(2)} off`}
              </p>
            ) : null}
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
        {rewardDiscount > 0 ? (
          <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
            <span className="text-[13px]" style={{ color: "#B91C1C" }}>
              Reward discount
            </span>
            <span className="text-[14px]" style={{ color: "#B91C1C", fontWeight: 500 }}>
              −RM{rewardDiscount.toFixed(2)}
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
        ) : (
          <div style={{ marginBottom: 12 }} />
        )}
        <Link
          href="/checkout"
          className="block w-full rounded-full bg-[#A2492C] text-white text-center py-4 font-bold active:opacity-80"
        >
          Continue to checkout
        </Link>
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
            style={{ fontFamily: "Peachi-Bold, serif", letterSpacing: -0.3, fontWeight: 700 }}
          >
            Your cart
          </h1>
        </div>
      </header>
      {children}
    </>
  );
}
