import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isGrabConfigured, markOrderReady } from "@/lib/grab";

/**
 * POST /api/pos/order-status
 * Body: { source: "pickup" | "grab" | "qr" | "counter", id: string, status: string }
 *
 * Advances the kitchen/fulfilment status of a Grab, Pickup, QR-table
 * dine-in or counter (till) order from the POS register's order-management
 * panel (the on-register KDS). "qr" rows live in the same `orders` table as
 * pickup (order_type=dine_in) — the cashier taps Done to mark them served.
 *
 * "counter" rows are till sales in `pos_orders` (source='pos') that are ALREADY
 * status='completed' (an exact sale the moment they're rung up). They don't move
 * through a status lifecycle — instead the cashier taps Served and we stamp
 * served_at, which is what drops them off the live Counter KDS + serving alarm.
 * status is deliberately left untouched so the Z-report / sales totals are
 * unaffected (see migration 027).
 *
 * Why service-role: the customer `orders` table (pickup app) only lets
 * the anon key UPDATE rows where kitchen_docket_printed_at IS NULL (the
 * print-claim policy). Orders the cashier marks "ready" have already
 * printed, so an anon update is blocked by RLS. Grab `pos_orders` is
 * anon-writable but we route both through here for one consistent,
 * server-validated path. CSRF is enforced by the shared POS middleware
 * (Origin/Referer must match) — same as the loyalty routes.
 */
// Created LAZILY (first request): module-scope createClient runs during
// build-time page-data collection and fails any build without runtime
// env (Vercel previews). Same pattern as the pos/loyalty routes.
let cachedSupabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!cachedSupabase) {
    cachedSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return cachedSupabase;
}

// Statuses the register is allowed to set. The on-register KDS only ever
// sends "ready" (Mark Ready) or "completed" (Mark Collected) — "preparing"
// was never sent AND isn't in the pos_orders status CHECK, so a stray
// "preparing" would 500 on the grab path. Keep the set tight.
const ALLOWED = new Set(["ready", "completed"]);

export async function POST(req: NextRequest) {
  const supabase = getSupabase();
  try {
    const { source, id, status } = await req.json();
    if (source !== "pickup" && source !== "grab" && source !== "qr" && source !== "counter") {
      return NextResponse.json({ error: "source must be 'pickup', 'grab', 'qr' or 'counter'" }, { status: 400 });
    }
    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    // Counter (till) order → mark served. The row is already a completed sale,
    // so we only stamp served_at (status untouched). No payment guard: it was
    // paid at the till before this row ever existed. Idempotent — re-serving an
    // already-served row just re-stamps the time, harmlessly.
    if (source === "counter") {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("pos_orders")
        .update({ served_at: now, updated_at: now })
        .eq("id", id)
        .select("id, order_number, served_at")
        .maybeSingle();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data) return NextResponse.json({ error: "order not found" }, { status: 404 });
      return NextResponse.json({ ok: true, order: data });
    }

    if (!ALLOWED.has(status)) {
      return NextResponse.json({ error: `status must be one of ${[...ALLOWED].join(", ")}` }, { status: 400 });
    }

    // Payment guard: never advance an UNPAID online order (pickup / QR table).
    // A real order is already "paid"/"preparing" by the time the cashier marks
    // it ready/collected — a still-"pending" online order means payment was
    // never confirmed, so refuse. This (with the register hiding pending QR
    // orders) stops staff completing an order nobody paid for. Grab is prepaid
    // on Grab's side, so it's exempt; free (total=0) orders pass.
    if (source !== "grab") {
      const { data: cur } = await supabase
        .from("orders")
        .select("status, payment_provider_ref, total")
        .eq("id", id)
        .maybeSingle();
      const c = cur as { status?: string; payment_provider_ref?: string | null; total?: number | null } | null;
      if (c && c.status === "pending" && c.payment_provider_ref == null && (c.total ?? 0) > 0) {
        return NextResponse.json(
          { error: "Order is not paid — an unpaid order can't be marked ready or collected." },
          { status: 409 },
        );
      }
    }

    // pickup + qr dine-in both live in `orders`; only grab is `pos_orders`.
    const table = source === "grab" ? "pos_orders" : "orders";
    const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    // pos_orders carries the Grab order id in external_id; pickup orders
    // don't have that column, so only ask for it on the grab path.
    const selectCols = source === "grab" ? "id, order_number, status, external_id" : "id, order_number, status";

    // maybeSingle (not single): a non-matching id returns data=null with NO
    // error. .single() instead throws PGRST116 → a misleading 500 for what is
    // really "order not found". Map the null case to a clean 404 so the
    // register can tell "gone" from "server broke".
    const { data, error } = await supabase
      .from(table)
      .update(patch)
      .eq("id", id)
      .select(selectCols)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "order not found" }, { status: 404 });

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

