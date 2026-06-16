/**
 * Per-outlet GrabFood menu builder — the SINGLE source for both menu directions:
 *   - inbound  "get menu" webhook  (Grab pulls our menu)        — api/pos/grab/merchant/menu
 *   - outbound "sync menu" push     (we PUT our menu to Grab)    — api/pos/grab/sync
 *
 * Building it in one place guarantees what we PUSH is byte-for-byte what we'd
 * SERVE on a pull: same channel-visible products, per-outlet service hours, and
 * per-outlet 86 (stock-out) list. Backoffice stays the single source of truth.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildGrabMenuPayload,
  buildGrabServiceHours,
  grabMenuOptionsFromEnv,
  type RawProduct,
} from "@/lib/grab-menu";

/**
 * Resolve a GrabFood merchant ID to the full per-outlet menu payload.
 * Returns null only on a hard product-fetch failure (caller decides the HTTP code).
 */
export async function buildOutletGrabMenu(
  supabase: SupabaseClient,
  merchantId: string,
): Promise<ReturnType<typeof buildGrabMenuPayload> | null> {
  const [productsRes, categoriesRes] = await Promise.all([
    supabase.from("products").select("*").order("category").order("name"),
    supabase.from("categories").select("id, slug, name").order("position", { ascending: true }),
  ]);

  if (productsRes.error || !productsRes.data) {
    console.error("[grab:build-menu] product fetch failed:", productsRes.error);
    return null;
  }

  // Per-outlet open hours: merchantID → outlets.grab_merchant_id → outlet id →
  // pos_branch_settings.grab_open_time/close/24h. Falls back to the env default.
  let serviceHours: ReturnType<typeof buildGrabServiceHours> | undefined;
  // Product ids 86'd at this merchant's outlet (per-outlet stock-outs) → forced
  // UNAVAILABLE so a full sync respects the same overrides the live 86 push sends.
  let unavailableIds: Set<string> | undefined;
  if (merchantId) {
    const { data: outlet } = await supabase
      .from("outlets").select("id").eq("grab_merchant_id", merchantId).maybeSingle();
    if (outlet?.id) {
      const { data: bs } = await supabase
        .from("pos_branch_settings")
        .select("grab_open_time, grab_close_time, grab_open_24h")
        .eq("outlet_id", outlet.id)
        .maybeSingle();
      if (bs) {
        serviceHours = buildGrabServiceHours({
          open: bs.grab_open_time, close: bs.grab_close_time, open24h: bs.grab_open_24h,
        });
      }
      const { data: os } = await supabase
        .from("outlet_settings").select("store_id").eq("loyalty_outlet_id", outlet.id).maybeSingle();
      const storeId = (os as { store_id?: string } | null)?.store_id;
      if (storeId) {
        const { data: oos } = await supabase
          .from("outlet_product_availability").select("product_id")
          .eq("outlet_id", storeId).eq("is_available", false);
        unavailableIds = new Set((oos ?? []).map((r: { product_id: string }) => r.product_id));
      }
    }
  }

  // Build slug→displayName map so Grab sees "Artisan Choc" instead of "artisan-choc".
  const categoryNames: Record<string, string> = {};
  for (const c of categoriesRes.data || []) {
    if (c.slug && c.name) categoryNames[c.slug] = c.name;
    if (c.id && c.name) categoryNames[c.id] = c.name; // products.category might store id too
  }

  // "Show on" placement: only products visible on the Grab channel ship (empty
  // visible_channels = everywhere — same allow-list rule as modifiers).
  const grabProducts = (productsRes.data as RawProduct[]).filter((p) => {
    const vc = (p as { visible_channels?: string[] }).visible_channels;
    return !Array.isArray(vc) || vc.length === 0 || vc.includes("grab");
  });

  return buildGrabMenuPayload(grabProducts, merchantId, {
    ...grabMenuOptionsFromEnv(),
    categoryNames,
    serviceHours,
    unavailableProductIds: unavailableIds,
  });
}
