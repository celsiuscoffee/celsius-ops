/**
 * Auto-sync the backoffice product catalogue to GrabFood.
 *
 * Backoffice is the SINGLE SOURCE OF TRUTH: whenever a product is created,
 * edited, or deleted, we push to every Grab-linked outlet so item names,
 * photos, price and availability track the catalogue without a manual "Sync".
 *
 * Two push paths, tried in order per outlet:
 *   1. Full-menu replace (PUT /partner/v1/menu) — carries names + photos +
 *      price + availability. Works for partner-managed menus. After it lands we
 *      also notify Grab to re-pull (best-effort), the lever that refreshes
 *      photos / item structure on stores that own their menu.
 *   2. Record batch (PUT /partner/v1/batch/menu, field "ITEM") — price +
 *      availability for items that ALREADY exist on Grab. The fallback for
 *      self-serve-linked stores where the full replace is rejected
 *      (UnsupportedMenuSync). Records MUST target Grab's own item id, so we
 *      translate our product id → products.grab_item_id here (a record keyed by
 *      our id would silently match nothing on a portal-built menu).
 *
 * Everything is best-effort: a Grab failure NEVER breaks the catalogue write.
 * Intended to run from `after()` so it's off the request's critical path.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { updateMenu, batchUpdateMenu, notifyMenuUpdate } from "@/lib/grab";
import { buildOutletGrabMenu } from "@/lib/grab-menu-outlet";
import { buildGrabRecordEntities, type GrabMenuItemLike } from "@/lib/grab-record-entities";

export interface GrabSyncOutcome {
  merchantId: string;
  mode: "full" | "records" | "failed" | "empty";
  items: number;
  error?: string;
}

export interface GrabSyncResult {
  skipped?: string;
  outlets: GrabSyncOutcome[];
}

/**
 * Push the current catalogue to every Grab-linked outlet. Safe to call from
 * `after()`; resolves with a per-outlet outcome summary for logging.
 */
export async function autoSyncCatalogueToGrab(
  supabase: SupabaseClient,
): Promise<GrabSyncResult> {
  // Outbound OAuth pair is what every push uses (same as /api/pos/grab/sync).
  // No creds → nothing to do (preview / dev / not-yet-live).
  if (!process.env.GRAB_CLIENT_ID || !process.env.GRAB_CLIENT_SECRET) {
    return { skipped: "no_grab_credentials", outlets: [] };
  }

  const { data: linked, error } = await supabase
    .from("outlets")
    .select("grab_merchant_id")
    .not("grab_merchant_id", "is", null);
  if (error) return { skipped: "outlet_lookup_failed", outlets: [] };

  const merchantIds = Array.from(
    new Set(
      (linked ?? [])
        .map((o) => (o as { grab_merchant_id: string | null }).grab_merchant_id)
        .filter((m): m is string => !!m),
    ),
  );
  if (merchantIds.length === 0) return { skipped: "no_linked_outlets", outlets: [] };

  // product id → Grab item id, for record-push targeting (self-serve stores).
  const { data: gidRows } = await supabase
    .from("products")
    .select("id, grab_item_id")
    .not("grab_item_id", "is", null);
  const gidByProductId = new Map<string, string>();
  for (const r of (gidRows ?? []) as Array<{ id: string; grab_item_id: string | null }>) {
    if (r.grab_item_id) gidByProductId.set(r.id, r.grab_item_id);
  }

  const outlets: GrabSyncOutcome[] = [];
  for (const merchantId of merchantIds) {
    outlets.push(await syncOneOutlet(supabase, merchantId, gidByProductId));
  }
  return { outlets };
}

async function syncOneOutlet(
  supabase: SupabaseClient,
  merchantId: string,
  gidByProductId: Map<string, string>,
): Promise<GrabSyncOutcome> {
  const menu = await buildOutletGrabMenu(supabase, merchantId);
  if (!menu) return { merchantId, mode: "failed", items: 0, error: "build_failed" };

  const menuItems: GrabMenuItemLike[] = menu.categories
    .flatMap((c) => c.items)
    .map((it) => ({
      id: it.id,
      price: it.price,
      availableStatus: it.availableStatus,
      ...(it.maxStock != null ? { maxStock: it.maxStock } : {}),
    }));
  if (menuItems.length === 0) return { merchantId, mode: "empty", items: 0 };

  // 1. Full replace — names + photos + price + availability.
  try {
    await updateMenu(menu);
    try {
      await notifyMenuUpdate(merchantId); // nudge a re-pull (photos / structure)
    } catch {
      /* notify is unsupported on some stores — ignore */
    }
    return { merchantId, mode: "full", items: menuItems.length };
  } catch (fullErr) {
    // 2. Fallback — records (price + availability) targeting Grab's item ids.
    try {
      const entities = buildGrabRecordEntities(menuItems, gidByProductId);
      await batchUpdateMenu(merchantId, "ITEM", entities);
      return { merchantId, mode: "records", items: entities.length };
    } catch (recErr) {
      console.error(
        `[grab:auto-sync] both pushes failed merchant=${merchantId} full=${
          fullErr instanceof Error ? fullErr.message : fullErr
        }`,
      );
      return {
        merchantId,
        mode: "failed",
        items: menuItems.length,
        error: recErr instanceof Error ? recErr.message : String(recErr),
      };
    }
  }
}
