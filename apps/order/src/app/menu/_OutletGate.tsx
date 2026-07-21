"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getDineInContext } from "@/lib/checkout-session";

/**
 * Dine-in gate for the menu. This app is table-QR ordering ONLY — a session
 * exists only after the customer scans their table (which _TableEntry turns
 * into a fresh dine-in context). Without one, funnel to /scan rather than the
 * retired pickup outlet picker, so no one can browse the whole menu, hit
 * checkout, and only then learn there's no valid table order to place.
 */
export function OutletGate() {
  const router = useRouter();
  useEffect(() => {
    if (!getDineInContext()) router.replace("/scan");
  }, [router]);
  return null;
}
