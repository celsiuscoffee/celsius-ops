"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapPin, Smartphone, ChevronRight } from "lucide-react";

/**
 * Writes the dine-in context into the persisted "celsius-pickup" store,
 * then shows an app-conversion interstitial instead of bouncing straight
 * to the menu: customers who reach this page are exactly the ones WITHOUT
 * the native app installed (installed apps intercept /table/* via
 * Universal Links / App Links and never load this page), so this is the
 * one moment to pitch the app before they order on web. "Get the app"
 * goes through /get-app (platform-sniffing store redirect); "Continue on
 * web" proceeds to the menu with the dine-in context already written.
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
  }, [outletId, outletName, tableId]);

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
    <div className="flex flex-col items-center justify-center px-6 text-center" style={{ minHeight: "80vh" }}>
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
        {outletName}
      </p>

      {/* App-conversion panel — mirrors the espresso GuestSignInCTA styling */}
      <div
        className="w-full max-w-sm mt-8 overflow-hidden text-left"
        style={{
          backgroundColor: "#1A0200",
          borderRadius: 16,
          boxShadow: "0 6px 14px rgba(22,8,0,0.18)",
        }}
      >
        <div style={{ padding: 20 }}>
          <div className="flex items-center" style={{ gap: 12 }}>
            <span
              className="flex items-center justify-center flex-shrink-0"
              style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: "#A2492C" }}
            >
              <Smartphone size={24} color="#FFFFFF" strokeWidth={2} />
            </span>
            <span className="flex-1 min-w-0">
              <span
                className="block uppercase"
                style={{ color: "#FBBF24", fontSize: 10, fontWeight: 700, letterSpacing: 2 }}
              >
                App exclusive
              </span>
              <span
                className="block font-peachi font-bold"
                style={{ color: "#FFFFFF", fontSize: 17, marginTop: 2 }}
              >
                Get 10% off this order
              </span>
              <span
                className="block"
                style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 2, fontWeight: 500 }}
              >
                Order with the Celsius Coffee app
              </span>
            </span>
          </div>
          {/* Route handler redirect to the App/Play Store — plain <a>, not
              <Link>, so Next never prefetches the 302 to an external store. */}
          <a
            href="/get-app"
            className="flex items-center justify-center gap-1 rounded-full active:opacity-80"
            style={{
              backgroundColor: "#FFFFFF",
              marginTop: 16,
              paddingTop: 12,
              paddingBottom: 12,
            }}
          >
            <span className="font-peachi font-bold" style={{ color: "#1A0200", fontSize: 14 }}>
              Get the app · 10% off
            </span>
            <ChevronRight size={15} color="#1A0200" />
          </a>
          <p
            className="text-center"
            style={{ color: "rgba(255,255,255,0.55)", fontSize: 11, marginTop: 10 }}
          >
            After installing, re-scan the QR on your table — it opens right in the app.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => router.replace("/menu")}
        className="mt-5 text-sm font-semibold underline underline-offset-4 active:opacity-70"
        style={{ color: "#6B6B6B" }}
      >
        Continue on web
      </button>
    </div>
  );
}
