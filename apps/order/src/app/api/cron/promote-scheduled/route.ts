export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { notifyOrderPreparing } from "@/lib/push/templates";
import { checkCronAuth } from "@celsius/shared";

/**
 * Runs every 2 minutes. Finds scheduled orders sitting in "paid"
 * whose brew window has just opened, and promotes them to
 * "preparing" so the kitchen surface picks them up. Fires the
 * "Brewing now" push at the same time — the payment-time push was
 * suppressed for these orders so the customer wouldn't get pinged
 * 30 minutes before their drink was actually being made.
 *
 * Brew window opens at pickup_at - outlet.pickup_time_mins. If the
 * outlet's prep time isn't set we default to 10 min (matches the
 * checkout-side default).
 */
export async function GET(request: NextRequest) {
  const cronAuth = checkCronAuth(request.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const supabase = getSupabaseAdmin();

  // Fetch held scheduled orders. Look at every "paid" row with a
  // non-null pickup_at — the brew-window comparison happens per-row
  // because each outlet can have a different pickup_time_mins.
  const { data: held, error } = await supabase
    .from("orders")
    .select("id, order_number, customer_phone, store_id, pickup_at")
    .eq("status", "paid")
    .not("pickup_at", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    id: string;
    order_number: string;
    customer_phone: string | null;
    store_id: string | null;
    pickup_at: string;
  };
  const rows = (held ?? []) as Row[];

  // Outlet prep_time lookup, cached across the run so a busy outlet
  // doesn't multiply Supabase round-trips.
  const prepCache = new Map<string, number>();
  async function prepFor(storeId: string | null): Promise<number> {
    if (!storeId) return 10;
    if (prepCache.has(storeId)) return prepCache.get(storeId)!;
    const { data: outlet } = await supabase
      .from("outlet_settings")
      .select("pickup_time_mins")
      .eq("store_id", storeId)
      .maybeSingle();
    const ptm = (outlet as { pickup_time_mins?: number } | null)?.pickup_time_mins;
    const val = typeof ptm === "number" && ptm > 0 ? ptm : 10;
    prepCache.set(storeId, val);
    return val;
  }

  const now = Date.now();
  const result = { checked: rows.length, promoted: 0, skipped: 0 };

  for (const row of rows) {
    const prepMins = await prepFor(row.store_id);
    const at = new Date(row.pickup_at).getTime();
    if (Number.isNaN(at)) { result.skipped += 1; continue; }
    const brewWindowOpensAt = at - prepMins * 60_000;
    if (now < brewWindowOpensAt) { result.skipped += 1; continue; }

    // Flip paid → preparing. Gated on status="paid" so a concurrent
    // run (or staff manual edit) doesn't redouble the transition.
    const { data: updated, error: updErr } = await supabase
      .from("orders")
      .update({ status: "preparing" } as Record<string, unknown>)
      .eq("id", row.id)
      .eq("status", "paid")
      .select("id")
      .maybeSingle();
    if (updErr || !updated) { result.skipped += 1; continue; }

    result.promoted += 1;

    // "Brewing now" push, deferred so we don't block the cron loop.
    notifyOrderPreparing({
      orderId:       row.id,
      orderNumber:   row.order_number,
      customerPhone: row.customer_phone,
    }).catch((e) => console.warn("[push] promote-scheduled", row.order_number, e));
  }

  return NextResponse.json(result);
}
