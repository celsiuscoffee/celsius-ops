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
 *
 * Two render paths are supported and they fall back gracefully:
 *  - `image_url` (preferred) — a data: or https: URL pointing at the
 *    real Maybank-issued QR poster image. The customer-display shows
 *    the actual pink Maybank poster so customers see exactly what they
 *    would in-store. Uploaded via BO; stored as a data URL.
 *  - `payload` (legacy fallback) — a raw merchant identifier string
 *    that the display renders via QRCode. Kept for outlets whose
 *    image hasn't been uploaded yet.
 */

// POS outlet_id → pickup store_id (BO uses pickup namespace for these settings).
const POS_TO_PICKUP_STORE: Record<string, string> = {
  "outlet-sa": "shah-alam",
  "outlet-con": "conezion",
  "outlet-tam": "tamarind",
  "outlet-nilai": "nilai",
};

type OutletQrEntry = {
  payload: string;
  enabled: boolean;
  /** Data URL or https URL of the real Maybank QR poster (preferred). */
  image_url?: string | null;
};
type MaybankQrBlob = { enabled: boolean; outlets: Record<string, OutletQrEntry> };

export type MaybankQr = {
  /** Raw merchant id for fallback QRCode rendering. */
  payload: string;
  /** Direct image URL of the Maybank QR poster (preferred when set). */
  image_url: string | null;
};

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
 * QR record for the given POS outlet — or null if the outlet has no QR
 * configured or its per-outlet toggle is off.
 *
 * NOTE: the global `maybank_qr.enabled` master toggle gates the *customer
 * ordering* QR flow (order.celsiuscoffee.com), NOT the in-store POS
 * display — the POS shows its outlet's QR independently as long as the
 * outlet has a payload (or image) set and its per-outlet toggle is on.
 */
export function useMaybankQr(outletId: string | null): MaybankQr | null {
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
  if (!entry || !entry.enabled) return null;
  // Need either an image_url or a payload to render anything useful.
  if (!entry.image_url && !entry.payload) return null;
  return { payload: entry.payload ?? "", image_url: entry.image_url ?? null };
}
