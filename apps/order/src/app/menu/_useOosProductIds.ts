"use client";

import { useEffect, useState } from "react";

/** The customer's selected pickup outlet (store slug), read from the persisted
 *  store — the same key + shape OutletRow / OutletPickerRow / _TableEntry use.
 *  In dine-in (table-QR) mode _TableEntry writes this to the scanned outlet. */
function readOutletId(): string | null {
  try {
    const raw = window.localStorage.getItem("celsius-pickup");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { outletId?: string | null } };
    return parsed.state?.outletId ?? null;
  } catch {
    return null;
  }
}

/**
 * Per-outlet out-of-stock product ids — the POS "86" overrides.
 *
 * Fetches via the server /api/menu/availability route (service role), NOT a
 * browser Supabase client: the order app provisions no anon browser client, so
 * a client-side read silently returned nothing and a 86 never reached the web
 * menu. Refetches on tab focus + every 30s so a counter 86 drops the item
 * without a manual refresh. Empty set when no outlet is selected.
 */
export function useOosProductIds(): Set<string> {
  const [oos, setOos] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const outletId = readOutletId();
    if (!outletId) {
      setOos(new Set());
      return;
    }
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(
          `/api/menu/availability?outlet=${encodeURIComponent(outletId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const json = (await res.json()) as { oos?: string[] };
        if (!cancelled) setOos(new Set(json.oos ?? []));
      } catch {
        /* keep the last good set */
      }
    };

    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const interval = setInterval(() => void load(), 30_000);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      clearInterval(interval);
    };
  }, []);

  return oos;
}
