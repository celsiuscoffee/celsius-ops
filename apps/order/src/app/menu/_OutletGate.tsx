"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Force outlet pick before showing the menu — same gate as
 * apps/pickup-native/app/menu.tsx. If no outletId is in localStorage,
 * client-side redirect to /store?next=menu so the customer is
 * funnelled back to /menu after picking. Avoids the situation where a
 * customer browses the whole menu, hits checkout, and only then learns
 * they don't have an outlet selected.
 */
export function OutletGate() {
  const router = useRouter();
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      const outletId = raw
        ? (JSON.parse(raw) as { state?: { outletId?: string | null } }).state?.outletId
        : null;
      if (!outletId) router.replace("/store?next=menu");
    } catch {
      /* ignore */
    }
  }, [router]);
  return null;
}
