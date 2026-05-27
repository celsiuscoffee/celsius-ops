"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * Floating "View cart" pill. Reads the SPA's persisted cart from
 * localStorage (key "celsius-pickup") and renders if non-empty. Tap →
 * /cart (still SPA-rendered).
 *
 * Pinned to viewport bottom via position: fixed; sits above the
 * BottomNav (~80px offset for safe-area + nav height).
 */
type Persisted = {
  state?: {
    cart?: Array<{ quantity?: number; totalPrice?: number }>;
  };
};

export function GlobalCartPill() {
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    function read() {
      try {
        const raw = window.localStorage.getItem("celsius-pickup");
        if (!raw) return;
        const parsed = JSON.parse(raw) as Persisted;
        const cart = parsed.state?.cart ?? [];
        setCount(cart.reduce((s, i) => s + (i.quantity ?? 1), 0));
        setTotal(cart.reduce((s, i) => s + (i.totalPrice ?? 0), 0));
      } catch {
        /* ignore */
      }
    }
    read();
    // Poll periodically so a cart change in the SPA (different React
    // tree) gets reflected here without forcing a full reload. Cheap.
    const id = window.setInterval(read, 1500);
    window.addEventListener("storage", read);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("storage", read);
    };
  }, []);

  if (count <= 0) return null;

  return (
    <Link
      href="/cart"
      className="fixed left-4 right-4 z-30 bg-[#A2492C] text-white rounded-full px-5 py-3 flex items-center justify-between active:opacity-80"
      style={{
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)",
        boxShadow: "0 4px 12px rgba(162,73,44,0.3)",
      }}
    >
      <span className="flex items-center gap-2">
        <span className="bg-white rounded-full w-6 h-6 flex items-center justify-center text-[#A2492C] text-xs font-bold">
          {count}
        </span>
        <span className="font-bold">View cart</span>
      </span>
      <span className="font-bold">
        RM{total.toFixed(2)}
      </span>
    </Link>
  );
}
