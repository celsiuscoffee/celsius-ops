"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

type ModifierOption = {
  id: string;
  label: string;
  priceDelta: number;
  isDefault: boolean;
};
type ModifierGroup = {
  id: string;
  name: string;
  multiSelect: boolean;
  options: ModifierOption[];
};
type Product = {
  id: string;
  name: string;
  description?: string;
  basePrice: number;
  image: string;
  modifierGroups: ModifierGroup[];
};

type CartItem = {
  cartId: string;
  productId: string;
  name: string;
  image?: string;
  basePrice: number;
  quantity: number;
  modifiers: Array<{
    groupId: string;
    groupName: string;
    optionId: string;
    label: string;
    priceDelta: number;
  }>;
  specialInstructions?: string;
  totalPrice: number;
};

type Persisted = { state?: { cart?: CartItem[] } };

function addToCart(item: CartItem) {
  try {
    const raw = window.localStorage.getItem("celsius-pickup");
    const parsed = raw ? (JSON.parse(raw) as Persisted) : { state: { cart: [] } };
    const state = parsed.state ?? {};
    state.cart = [...(state.cart ?? []), item];
    window.localStorage.setItem("celsius-pickup", JSON.stringify({ ...parsed, state }));
  } catch {
    /* ignore */
  }
}

function defaultSelection(groups: ModifierGroup[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const g of groups) {
    const defaults = g.options.filter((o) => o.isDefault).map((o) => o.id);
    out[g.id] = g.multiSelect ? defaults : defaults.slice(0, 1);
  }
  return out;
}

export function ProductView({ product }: { product: Product }) {
  const router = useRouter();
  const [sel, setSel] = useState(() => defaultSelection(product.modifierGroups));
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");

  const totalDelta = useMemo(() => {
    let d = 0;
    for (const g of product.modifierGroups) {
      const picked = sel[g.id] ?? [];
      for (const id of picked) {
        const opt = g.options.find((o) => o.id === id);
        if (opt) d += opt.priceDelta;
      }
    }
    return d;
  }, [sel, product.modifierGroups]);

  const unitPrice = product.basePrice + totalDelta;
  const totalPrice = unitPrice * qty;

  const requiredAllPicked = product.modifierGroups
    .filter((g) => !g.multiSelect) // radio groups require exactly one
    .every((g) => (sel[g.id]?.length ?? 0) >= 1);

  const onAdd = () => {
    if (!requiredAllPicked) return;
    const selections = product.modifierGroups.flatMap((g) =>
      (sel[g.id] ?? []).map((optId) => {
        const opt = g.options.find((o) => o.id === optId)!;
        return {
          groupId: g.id,
          groupName: g.name,
          optionId: opt.id,
          label: opt.label,
          priceDelta: opt.priceDelta,
        };
      }),
    );
    addToCart({
      cartId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      productId: product.id,
      name: product.name,
      image: product.image,
      basePrice: product.basePrice,
      quantity: qty,
      modifiers: selections,
      specialInstructions: notes || undefined,
      totalPrice,
    });
    // Return to where the customer came from (the menu) rather than
    // pushing them to the cart — matches apps/pickup-native/app
    // /product/[id].tsx's router.back(). The floating cart pill keeps
    // the cart one tap away. Falls back to /menu when there's no
    // in-app history (e.g. a deep link straight to the product).
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/menu");
    }
  };

  const togglePick = (group: ModifierGroup, optId: string) => {
    setSel((prev) => {
      const cur = prev[group.id] ?? [];
      if (group.multiSelect) {
        return {
          ...prev,
          [group.id]: cur.includes(optId) ? cur.filter((x) => x !== optId) : [...cur, optId],
        };
      }
      return { ...prev, [group.id]: [optId] };
    });
  };

  return (
    <>
      <div
        className="relative w-full bg-[#F2EDE5]"
        style={{ height: "50vh" }}
      >
        {product.image ? (
          <Image
            src={product.image}
            alt={product.name}
            fill
            sizes="(max-width: 430px) 100vw, 430px"
            className="object-cover"
            priority
          />
        ) : null}
        <Link
          href="/menu"
          className="absolute left-4 flex items-center justify-center rounded-full bg-white active:opacity-80"
          style={{
            top: "calc(env(safe-area-inset-top, 0px) + 12px)",
            width: 40,
            height: 40,
            boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
          }}
          aria-label="Back"
        >
          <ArrowLeft size={20} color="#160800" />
        </Link>
      </div>

      <div
        className="relative bg-white"
        style={{ marginTop: -24, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 6 }}
      >
      <div className="px-5 pt-4">
        <h1 className="font-peachi font-bold text-2xl text-[#1A0200]">{product.name}</h1>
        {product.description ? (
          <p className="text-sm text-[#6E6E73] mt-2 leading-relaxed">
            {product.description}
          </p>
        ) : null}
        <p className="mt-3 font-peachi font-bold text-[18px] text-[#A2492C]">
          RM{product.basePrice.toFixed(2)}
        </p>
      </div>

      {product.modifierGroups.map((g) => (
        <section key={g.id} className="mt-5 px-5">
          <p
            className="uppercase"
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 1.4,
              color: "#1A0200",
            }}
          >
            {g.name}
            <span style={{ color: "#A2492C", marginLeft: 6 }}>
              · {g.multiSelect ? "Pick any" : "Pick one"}
            </span>
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {g.options.map((opt) => {
              const picked = (sel[g.id] ?? []).includes(opt.id);
              return (
                <li key={opt.id}>
                  <button
                    type="button"
                    onClick={() => togglePick(g, opt.id)}
                    className={`w-full flex items-center gap-3 rounded-2xl border px-4 py-3 text-left active:opacity-80 ${
                      picked
                        ? "border-[#160800] bg-[#F7F4F0]"
                        : "border-[#EBE5DE] bg-white"
                    }`}
                  >
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded-full border"
                      style={{
                        borderColor: picked ? "#160800" : "#C4BDB3",
                        backgroundColor: picked ? "#160800" : "transparent",
                      }}
                    >
                      {picked ? (
                        <span className="h-2 w-2 rounded-full bg-white" />
                      ) : null}
                    </span>
                    <span className="text-sm font-bold flex-1">{opt.label}</span>
                    {opt.priceDelta ? (
                      <span className="text-sm text-[#A2492C] font-bold">
                        {opt.priceDelta > 0 ? "+" : ""}
                        RM{opt.priceDelta.toFixed(2)}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section className="mt-5 px-5">
        <p
          className="uppercase"
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 1.4,
            color: "#1A0200",
          }}
        >
          Special instructions
        </p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Less ice, no cream, etc."
          className="mt-2 w-full rounded-2xl bg-white p-3 text-sm min-h-[88px]"
          style={{ border: "1px solid rgba(26,2,0,0.10)" }}
        />
      </section>

      <section className="mt-5 px-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setQty((q) => Math.max(1, q - 1))}
          className="h-10 w-10 rounded-full border border-[#E0D8CE] flex items-center justify-center active:opacity-60"
          aria-label="Decrease quantity"
        >
          <span className="text-xl leading-none">−</span>
        </button>
        <span className="font-peachi font-bold text-xl w-8 text-center">{qty}</span>
        <button
          type="button"
          onClick={() => setQty((q) => q + 1)}
          className="h-10 w-10 rounded-full bg-[#160800] flex items-center justify-center active:opacity-80"
          aria-label="Increase quantity"
        >
          <span className="text-xl text-white leading-none">+</span>
        </button>
      </section>

      </div>

      {/* Sticky Add-to-cart bar — replaces the bottom nav on the product
          page (no nav, no floating cart pill here). Matches BottomNav's
          fixed/full-width/safe-area placement so it sits in the same spot. */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-[#EBE5DE] px-5 pt-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
      >
        <button
          type="button"
          onClick={onAdd}
          disabled={!requiredAllPicked}
          className={`block w-full rounded-full text-white text-center py-4 font-bold active:opacity-80 ${
            requiredAllPicked ? "bg-[#A2492C]" : "bg-[#A2492C]/40"
          }`}
        >
          {requiredAllPicked ? `Add ${qty} · RM${totalPrice.toFixed(2)}` : "Pick required options"}
        </button>
      </div>
    </>
  );
}
