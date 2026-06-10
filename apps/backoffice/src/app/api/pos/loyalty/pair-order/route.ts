import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/pos/loyalty/pair-order
 * Body: { order_id, employee_id, outlet_id?, product_ids: string[] }
 *
 * Exact upsell attribution. Pair-with-a-Bite taps are logged at ADD time
 * (/api/pos/loyalty/pair-event), before the order exists, so they carry no
 * order_id. At checkout the register calls this with the freshly created
 * order_id and the products it pair-added for THIS cart — we stamp order_id
 * onto those still-unbound events for this cashier.
 *
 * The cashier-performance dashboard then counts DISTINCT stamped order_ids for
 * an exact "orders that contained an upsell" rate, replacing the old fragile
 * 30-min time-reconcile that missed nearly everything.
 *
 * Bounded so an identical product pair-added in an earlier abandoned cart can't
 * be back-stamped: only this cashier's unbound (order_id IS NULL) register
 * events for the given products in the last 2 hours.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const orderId: string | null = body?.order_id ?? null;
    const employeeId: string | null = body?.employee_id ?? null;
    const productIds: string[] = Array.isArray(body?.product_ids)
      ? body.product_ids.filter((p: unknown): p is string => typeof p === "string")
      : [];
    if (!orderId || !employeeId || productIds.length === 0) {
      return NextResponse.json({ ok: false }, { status: 200 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await supabase
      .from("pos_pair_events")
      .update({ order_id: orderId })
      .eq("source", "register")
      .eq("employee_id", employeeId)
      .is("order_id", null)
      .gte("created_at", twoHoursAgo)
      .in("product_id", productIds);

    return NextResponse.json({ ok: true });
  } catch {
    // Attribution must never break the order flow.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
