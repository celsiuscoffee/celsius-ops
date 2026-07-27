"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QrCode } from "lucide-react";
import { getDineInContext } from "@/lib/checkout-session";

/**
 * Scan-your-table wall. This app is dine-in QR-table ordering ONLY: a session
 * begins when the customer scans the physical table QR (their camera opens
 * /table/{outletId}/{tableId}, which _TableEntry turns into a dine-in session).
 * There is no web pickup flow — pickup lives in the native "Celsius" app.
 *
 * Every no-table entry point (the /menu OutletGate, an empty /cart or
 * /checkout with no dine-in context, an old /store bookmark) funnels here so a
 * customer can't build an order that would only dead-end at the checkout guard.
 *
 * If a fresh dine-in context DOES exist (a seated customer who wandered onto
 * this URL), bounce straight back into the menu rather than stranding them.
 */
export function ScanWall() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (getDineInContext()) {
      router.replace("/menu");
      return;
    }
    setChecked(true);
  }, [router]);

  if (!checked) {
    return <div className="p-8 text-center text-[#8E8E93]">Loading…</div>;
  }

  return (
    <div
      className="flex flex-col items-center justify-center px-8 text-center"
      style={{ minHeight: "80vh" }}
    >
      <span
        className="flex items-center justify-center"
        style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: "rgba(162,73,44,0.10)" }}
      >
        <QrCode size={40} color="#A2492C" strokeWidth={1.6} />
      </span>
      <h1 className="font-peachi font-bold mt-6" style={{ color: "#1A0200", fontSize: 22 }}>
        Scan the QR on your table
      </h1>
      <p className="text-sm mt-3 max-w-xs" style={{ color: "#6B6B6B", lineHeight: 1.5 }}>
        Open your phone camera and scan the QR code on your table to browse the
        menu and order from your seat.
      </p>
      <p className="text-sm mt-4 max-w-xs" style={{ color: "#6B6B6B", lineHeight: 1.5 }}>
        Want to order ahead for pickup? Use the Celsius app.
      </p>
      <a
        href="/get-app"
        className="mt-6 rounded-full bg-[#A2492C] text-white px-6 py-3 font-peachi font-bold active:opacity-80"
      >
        Get the app
      </a>
      <Link
        href="/"
        className="mt-4 text-[13px] font-bold active:opacity-70"
        style={{ color: "#A2492C" }}
      >
        Back to home
      </Link>
    </div>
  );
}
