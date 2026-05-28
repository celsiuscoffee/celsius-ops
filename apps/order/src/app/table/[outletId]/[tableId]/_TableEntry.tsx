"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";

/**
 * Writes the dine-in context into the persisted "celsius-pickup" store
 * and redirects to the menu. Sets outletId/outletName so the menu's
 * OutletGate passes without a picker, plus orderType "dine_in" +
 * tableNumber so checkout creates a table order (not a pickup).
 */
type Persisted = {
  state?: Record<string, unknown>;
};

export function TableEntry({
  outletId,
  outletName,
  tableId,
}: {
  outletId: string;
  outletName: string | null;
  tableId: string;
}) {
  const router = useRouter();
  const [ok] = useState(() => !!outletName);

  useEffect(() => {
    if (!outletName) return;
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      const parsed = raw ? (JSON.parse(raw) as Persisted) : { state: {} };
      const state = (parsed.state ?? {}) as Record<string, unknown>;
      state.outletId = outletId;
      state.outletName = outletName;
      state.outletIsOpen = true;
      state.orderType = "dine_in";
      state.tableNumber = tableId;
      // A fresh table session shouldn't inherit a previous pickup
      // cart/reward — start the dine-in basket clean.
      state.cart = [];
      state.appliedReward = null;
      state.reservedVoucher = null;
      window.localStorage.setItem("celsius-pickup", JSON.stringify({ ...parsed, state }));
    } catch {
      /* ignore */
    }
    router.replace("/menu");
  }, [outletId, outletName, tableId, router]);

  if (!ok) {
    return (
      <div className="flex flex-col items-center justify-center px-8 text-center" style={{ minHeight: "70vh" }}>
        <MapPin size={44} color="#A2492C" strokeWidth={1.5} />
        <p className="font-peachi font-bold text-xl mt-4" style={{ color: "#1A0200" }}>
          Table not found
        </p>
        <p className="text-sm mt-2" style={{ color: "#6B6B6B" }}>
          This QR code doesn&apos;t match an active outlet. Ask a barista for help, or browse the menu
          for pickup.
        </p>
        <Link
          href="/"
          className="mt-6 rounded-full bg-[#A2492C] text-white px-5 py-3 font-peachi font-bold active:opacity-80"
        >
          Go to home
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center px-8 text-center" style={{ minHeight: "70vh" }}>
      <span
        className="flex items-center justify-center"
        style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: "rgba(162,73,44,0.10)" }}
      >
        <MapPin size={28} color="#A2492C" strokeWidth={1.5} />
      </span>
      <p className="font-peachi font-bold text-xl mt-4" style={{ color: "#1A0200" }}>
        Table {tableId}
      </p>
      <p className="text-sm mt-1" style={{ color: "#6B6B6B" }}>
        {outletName} · opening your menu…
      </p>
    </div>
  );
}
