import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

/**
 * Per-outlet Maybank static QR config, sourced from the backoffice
 * (Settings → Integrations → Maybank QR) and stored as a single
 * `app_settings.maybank_qr` blob. The customer ordering app reads it
 * to gate / render the Maybank QR payment tile and the post-checkout
 * "scan to pay" screen. Live via Supabase realtime on app_settings.
 *
 * Schema:
 *   {
 *     enabled: boolean,                            // global on/off (customer flow)
 *     outlets: {
 *       "shah-alam":  { payload: "MBBQR…", enabled: true },
 *       "conezion":   { payload: "MBBQR…", enabled: true },
 *       "tamarind":   { payload: "MBBQR…", enabled: true },
 *       ...
 *     }
 *   }
 *
 * The customer app uses the pickup store_id namespace
 * (shah-alam / conezion / tamarind / nilai) — no mapping needed here.
 */

type OutletQrEntry = { payload: string; enabled: boolean };
export type MaybankQrConfig = {
  enabled: boolean;
  outlets: Record<string, OutletQrEntry>;
};

async function fetchMaybankQr(): Promise<MaybankQrConfig | null> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "maybank_qr")
    .maybeSingle();
  if (error) {
    console.warn("[maybank-qr] fetch failed:", error.message);
    return null;
  }
  return (data?.value as MaybankQrConfig) ?? null;
}

/**
 * Live Maybank QR config — useful for the checkout tile (needs to know
 * whether to render a "Maybank QR" payment option) and the post-checkout
 * "scan to pay" screen (needs the per-outlet payload string).
 *
 * Returns null while loading; otherwise the parsed blob. Live via a
 * realtime subscription on app_settings filtered to key=maybank_qr.
 */
export function useMaybankQrConfig(): MaybankQrConfig | null {
  const [blob, setBlob] = useState<MaybankQrConfig | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    fetchMaybankQr().then((b) => {
      if (!cancelledRef.current) setBlob(b);
    });
    const ch = supabase
      .channel("maybank-qr-customer")
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

  return blob;
}

/**
 * Whether the Maybank QR payment tile should appear for a given store.
 * Requires the master switch on AND the outlet's per-row enabled + payload.
 */
export function maybankQrAvailableFor(
  config: MaybankQrConfig | null,
  storeId: string | null,
): boolean {
  if (!config || !config.enabled || !storeId) return false;
  const entry = config.outlets?.[storeId];
  return !!(entry && entry.enabled && entry.payload);
}

/** Per-outlet payload string for rendering the QR (null if unavailable). */
export function maybankQrPayloadFor(
  config: MaybankQrConfig | null,
  storeId: string | null,
): string | null {
  if (!maybankQrAvailableFor(config, storeId)) return null;
  return config!.outlets[storeId!].payload || null;
}
