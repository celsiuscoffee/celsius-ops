import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { isGrabConfigured, batchUpdateMenu } from "@/lib/grab";

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
 * On every toggle we also best-effort push the new status to GrabFood for that
 * outlet's own Grab merchant, so a 86 reaches delivery within seconds. The
 * Grab push never blocks the DB write — if Grab isn't configured / live yet,
 * the toggle still succeeds and pickup + every register update via realtime.
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

  // 3. Best-effort live push to this outlet's GrabFood merchant.
  let grab = "skipped";
  try {
    const { data: outlet } = await supabase
      .from("outlets")
      .select("grab_merchant_id")
      .eq("id", outlet_id)
      .maybeSingle();
    const merchantId = (outlet as { grab_merchant_id?: string | null } | null)?.grab_merchant_id;
    if (!merchantId) {
      grab = "no-merchant";
    } else if (!isGrabConfigured()) {
      grab = "grab-not-configured";
    } else {
      // Records must target GRAB's item id, not ours — a portal-built (self-serve)
      // menu keys items by Grab's id (e.g. "MYITE2026..."), so a record keyed by
      // our product id matches nothing and the 86 silently never reaches Grab.
      // Use products.grab_item_id when linked; fall back to our id (works only on
      // stores that pulled our menu).
      const { data: prod } = await supabase
        .from("products")
        .select("grab_item_id")
        .eq("id", product_id)
        .maybeSingle();
      const grabItemId =
        (prod as { grab_item_id?: string | null } | null)?.grab_item_id || product_id;
      // field is the record TYPE ("ITEM"), attributes go in the entity. To set
      // UNAVAILABLE Grab requires maxStock:0 alongside the status.
      await batchUpdateMenu(merchantId, "ITEM", [
        is_available
          ? { id: grabItemId, availableStatus: "AVAILABLE" }
          : { id: grabItemId, availableStatus: "UNAVAILABLE", maxStock: 0 },
      ]);
      grab = "pushed";
    }
  } catch (e) {
    grab = "error";
    console.error("[pos/availability] Grab push failed:", e);
  }

  return NextResponse.json({ ok: true, store_id: storeId, grab });
}
