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
      // Start the dine-in basket clean (a stale pickup cart shouldn't bleed
      // in), but KEEP any applied reward / reserved voucher. A customer who
      // locks in a Free Drink and THEN scans the table QR to order (or
      // re-scans mid-order) must not lose it — clearing it here was why the
      // free drink never reached the dine-in order (reward_id NULL → not free,
      // while the same reward worked fine on pickup). The reward is
      // re-validated server-side at checkout regardless.
      state.cart = [];
      window.localStorage.setItem("celsius-pickup", JSON.stringify({ ...parsed, state }));
      // Authoritative dine-in context on its OWN key. The shared
      // "celsius-pickup" blob above is rewritten by ~10 components AND by the
      // Expo store, whose `partialize` deliberately drops orderType/tableNumber
      // — so the dine_in flag set above gets stripped between here and
      // checkout, and the table order silently becomes a pickup. This
      // dedicated key is touched by nothing else, so checkout can trust it.
      // Outlet-scoped + timestamped so it can never strand a later pickup
      // customer in dine-in (checkout ignores it once the outlet differs or
      // it ages out; the outlet picker and a completed order clear it).
      window.localStorage.setItem(
        "celsius-dinein",
        JSON.stringify({ outletId, tableNumber: tableId, ts: Date.now() }),
      );
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
          This QR code doesn&apos;t match an active outlet or table. Please re-scan the QR code on
          your table, ask a barista for help, or browse the menu for pickup.
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
