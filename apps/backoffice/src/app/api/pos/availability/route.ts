import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { syncItemAvailabilityToGrab } from "@/lib/grab-availability";

// The push retries through Grab's "retry after N seconds" throttle, so give the
// request room to finish rather than being cut off mid-retry.
export const maxDuration = 60;

/**
 * POS register "86" (out-of-stock) toggle — the consolidated, single write
 * path for per-outlet product availability. A cashier long-presses an item on
 * the SUNMI register; pos-native POSTs here.
 *
 * One source of truth: `outlet_product_availability(outlet_id, product_id,
 * is_available)` — the SAME table the pickup app reads and the backoffice
 * Availability matrix edits. We key it by the outlet's pickup STORE slug
 * (e.g. "shah-alam"), resolved from the loyalty outlet id the register sends
 * ("outlet-sa"), so all channels agree.
 *
 * On every toggle we also push the new status to GrabFood for that outlet's own
 * Grab merchant, so a 86 reaches delivery within seconds. The Grab push never
 * blocks the DB write — if Grab isn't configured / live yet, the toggle still
 * succeeds and pickup + every register update via realtime.
 *
 * The push RETRIES through Grab's menu-record throttle (409 "batchUpdate ITEM
 * <id> too frequently, retry after N seconds"), which staff trip routinely by
 * 86-ing several items in a row. A single un-retried call used to drop the 86 on
 * the floor: closed on the till, still selling on Grab. Whatever the retry can't
 * land is left un-synced in the pushed-state snapshot so `cron/grab-reconcile`
 * re-sends it — see lib/grab-availability.ts.
 *
 * Body: { outlet_id: string (loyalty id), product_id: string,
 *         is_available: boolean, reason?: string }
 */
export async function POST(req: NextRequest) {
  let body: {
    outlet_id?: string;
    product_id?: string;
    is_available?: boolean;
    reason?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { outlet_id, product_id, is_available, reason } = body;
  if (!outlet_id || !product_id || typeof is_available !== "boolean") {
    return NextResponse.json(
      { error: "outlet_id, product_id, is_available required" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();

  // 1. Loyalty outlet id → pickup store slug (the availability table's key).
  const { data: os } = await supabase
    .from("outlet_settings")
    .select("store_id")
    .eq("loyalty_outlet_id", outlet_id)
    .maybeSingle();
  const storeId = (os as { store_id?: string } | null)?.store_id;
  if (!storeId) {
    return NextResponse.json({ error: `Unknown outlet ${outlet_id}` }, { status: 404 });
  }

  // 2. Upsert the per-outlet override (mirrors the BO matrix + pickup reader).
  const { error } = await supabase
    .from("outlet_product_availability")
    .upsert(
      {
        outlet_id: storeId,
        product_id,
        is_available,
        reason: reason ?? null,
        updated_at: new Date().toISOString(),
        updated_by: "pos",
      },
      { onConflict: "outlet_id,product_id" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 3. Live push to this outlet's GrabFood merchant, with throttle retry.
  const grab = await syncItemAvailabilityToGrab(
    supabase,
    { loyaltyOutletId: outlet_id },
    product_id,
    is_available,
  );

  return NextResponse.json({ ok: true, store_id: storeId, grab });
}
