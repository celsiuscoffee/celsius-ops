import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isGrabConfigured, markOrderReady } from "@/lib/grab";

/**
 * POST /api/pos/order-status
 * Body: { source: "pickup" | "grab", id: string, status: string }
 *
 * Advances the kitchen/fulfilment status of a Grab or Pickup order from
 * the POS register's order-management panel (the on-register KDS).
 *
 * Why service-role: the customer `orders` table (pickup app) only lets
 * the anon key UPDATE rows where kitchen_docket_printed_at IS NULL (the
 * print-claim policy). Orders the cashier marks "ready" have already
 * printed, so an anon update is blocked by RLS. Grab `pos_orders` is
 * anon-writable but we route both through here for one consistent,
 * server-validated path. CSRF is enforced by the shared POS middleware
 * (Origin/Referer must match) — same as the loyalty routes.
 */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

// Statuses the register is allowed to set. Keeps a stray/forged call
// from flipping an order into an arbitrary state.
const ALLOWED = new Set(["preparing", "ready", "completed"]);

export async function POST(req: NextRequest) {
  try {
    const { source, id, status } = await req.json();
    if (source !== "pickup" && source !== "grab") {
      return NextResponse.json({ error: "source must be 'pickup' or 'grab'" }, { status: 400 });
    }
    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    if (!ALLOWED.has(status)) {
      return NextResponse.json({ error: `status must be one of ${[...ALLOWED].join(", ")}` }, { status: 400 });
    }

    const table = source === "pickup" ? "orders" : "pos_orders";
    const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    // pos_orders carries the Grab order id in external_id; pickup orders
    // don't have that column, so only ask for it on the grab path.
    const selectCols = source === "grab" ? "id, order_number, status, external_id" : "id, order_number, status";

    const { data, error } = await supabase
      .from(table)
      .update(patch)
      .eq("id", id)
      .select(selectCols)
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Propagate "ready" to Grab so the merchant order on Grab's side
    // (and the driver) advances too — the local pos_orders flip alone
    // never reaches Grab. Best-effort + gated: if Grab API access /
    // creds aren't live yet (isGrabConfigured === false), we skip
    // silently and the local status still updates for the on-register KDS.
    let grabPushed = false;
    if (source === "grab" && status === "ready" && isGrabConfigured()) {
      const grabOrderId = (data as { external_id?: string | null })?.external_id;
      if (grabOrderId) {
        try {
          await markOrderReady(grabOrderId);
          grabPushed = true;
        } catch (e) {
          console.warn("[pos/order-status] grab markOrderReady failed:", e instanceof Error ? e.message : e);
        }
      }
    }

    return NextResponse.json({ ok: true, order: data, grabPushed });
  } catch (err) {
    console.error("[pos/order-status]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
