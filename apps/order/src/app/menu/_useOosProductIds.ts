"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase/client";

/** The customer's selected pickup outlet (store slug), read from the persisted
 *  SPA store — the same key + shape OutletRow / OutletPickerRow read. */
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
 * Per-outlet out-of-stock product ids — the POS "86" overrides — kept live.
 *
 * Mirrors apps/pickup-native/lib/menu.ts: reads `outlet_product_availability`
 * for the customer's selected outlet (the SAME table + store-slug key the POS
 * register writes via /api/pos/availability and the backoffice Availability
 * matrix edits) and subscribes to realtime, so a counter 86 drops the item off
 * the website within seconds. The web menu had been ignoring this table
 * entirely, so a POS 86 never reached the site.
 *
 * Empty set when no outlet is selected — the menu then shows everything,
 * governed only by the product's global is_available.
 */
export function useOosProductIds(): Set<string> {
  const [oos, setOos] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const outletId = readOutletId();
    if (!outletId) {
      setOos(new Set());
      return;
    }
    // The browser client is typed to the generated Database, which doesn't
    // include this sparse override table — use the untyped client for it.
    const supabase = getSupabaseClient() as unknown as SupabaseClient;
    let cancelled = false;

    const load = async () => {
      const { data } = await supabase
        .from("outlet_product_availability")
        .select("product_id")
        .eq("outlet_id", outletId)
        .eq("is_available", false);
      if (cancelled) return;
      setOos(new Set((data ?? []).map((r: { product_id: string }) => r.product_id)));
    };
    void load();

    const channel = supabase
      .channel(`web-oos-${outletId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "outlet_product_availability",
          filter: `outlet_id=eq.${outletId}`,
        },
        () => void load(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, []);

  return oos;
}
