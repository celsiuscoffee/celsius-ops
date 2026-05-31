import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

/**
 * Per-outlet Maybank static QR config, sourced from the backoffice
 * (Settings → Integrations → Maybank QR) and stored as a single
 * `app_settings.maybank_qr` blob. The POS customer-display reads from
 * here at runtime + via Supabase realtime so a backoffice edit (or the
 * Sync button) updates the on-screen QR without an app restart.
 *
 * The blob is keyed by the pickup-app store_id namespace
 * (shah-alam / conezion / tamarind / nilai); POS uses the
 * outlet-XX namespace, so we map on read.
 */

// POS outlet_id → pickup store_id (BO uses pickup namespace for these settings).
const POS_TO_PICKUP_STORE: Record<string, string> = {
  "outlet-sa": "shah-alam",
  "outlet-con": "conezion",
  "outlet-tam": "tamarind",
  "outlet-nilai": "nilai",
};

type OutletQrEntry = { payload: string; enabled: boolean };
type MaybankQrBlob = { enabled: boolean; outlets: Record<string, OutletQrEntry> };

async function fetchMaybankQr(): Promise<MaybankQrBlob | null> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "maybank_qr")
    .maybeSingle();
  if (error) {
    console.warn("[maybank-qr] fetch failed:", error.message);
    return null;
  }
  return (data?.value as MaybankQrBlob) ?? null;
}

/**
 * Subscribe to live changes to the per-outlet Maybank QR. Returns the
 * payload string for the given POS outlet — or null if the outlet has
 * no QR set or the per-outlet toggle is off.
 *
 * NOTE: the global `maybank_qr.enabled` master toggle gates the *customer
 * ordering* QR flow (order.celsiuscoffee.com), NOT the in-store POS
 * display — the POS shows its outlet's QR independently as long as the
 * outlet has a payload set and its per-outlet toggle is on.
 */
export function useMaybankQr(outletId: string | null): string | null {
  const [blob, setBlob] = useState<MaybankQrBlob | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    fetchMaybankQr().then((b) => {
      if (!cancelledRef.current) setBlob(b);
    });
    // Live updates: backoffice writes flow straight to the display.
    const ch = supabase
      .channel("maybank-qr")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "app_settings",
          filter: "key=eq.maybank_qr",
        },
        () => {
          fetchMaybankQr().then((b) => {
            if (!cancelledRef.current) setBlob(b);
          });
        },
      )
      .subscribe();
    return () => {
      cancelledRef.current = true;
      supabase.removeChannel(ch);
    };
  }, []);

  if (!blob || !outletId) return null;
  const storeId = POS_TO_PICKUP_STORE[outletId];
  if (!storeId) return null;
  const entry = blob.outlets?.[storeId];
  if (!entry || !entry.enabled || !entry.payload) return null;
  return entry.payload;
}
