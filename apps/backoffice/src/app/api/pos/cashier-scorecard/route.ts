import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";

/**
 * GET /api/pos/cashier-scorecard?employee_id=<User.id>&outlet_id=<loyalty id>
 *
 * The single cashier's OWN numbers for TODAY (since KL midnight), for the live
 * self-performance chip on the register. Two metrics the cashier can move:
 *   - collection rate = orders with a loyalty phone ÷ till-rung orders
 *   - pair adds       = "Pair with a Bite" suggestions this cashier added
 *
 * Scope mirrors the backoffice cashier-performance dashboard: only cashier-rung
 * orders (source='pos', status='completed'). Open POS endpoint (the native app
 * carries no session cookie), same as /api/pos/availability.
 */

const CASHIER_SOURCES = ["pos"];

// Start of "today" in Asia/Kuala_Lumpur (UTC+8, no DST), as a UTC ISO string.
function klTodayStartIso(): string {
  const klNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const midnightUtcMs =
    Date.UTC(klNow.getUTCFullYear(), klNow.getUTCMonth(), klNow.getUTCDate()) - 8 * 60 * 60 * 1000;
  return new Date(midnightUtcMs).toISOString();
}

export async function GET(req: NextRequest) {
  const employeeId = req.nextUrl.searchParams.get("employee_id") || "";
  const outletId = req.nextUrl.searchParams.get("outlet_id");
  if (!employeeId) return NextResponse.json({ error: "employee_id required" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const since = klTodayStartIso();

  // ── Orders + collection (loyalty_phone captured) ──
  let oq = supabase
    .from("pos_orders")
    .select("loyalty_phone")
    .eq("status", "completed")
    .in("source", CASHIER_SOURCES)
    .eq("employee_id", employeeId)
    .gte("created_at", since)
    .limit(5000);
  if (outletId) oq = oq.eq("outlet_id", outletId);
  const { data: orders, error } = await oq;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = orders ?? [];
  const orderCount = rows.length;
  const collected = rows.filter((o) => o.loyalty_phone).length;

  // ── Pair adds (this cashier, register-side) ──
  let pq = supabase
    .from("pos_pair_events")
    .select("id", { count: "exact", head: true })
    .eq("source", "register")
    .eq("employee_id", employeeId)
    .gte("created_at", since);
  if (outletId) pq = pq.eq("outlet_id", outletId);
  const { count: pairAdds } = await pq;

  return NextResponse.json({
    since,
    target: 70,
    orders: orderCount,
    collected,
    rate: orderCount > 0 ? Math.round((collected / orderCount) * 100) : 0,
    pairAdds: pairAdds ?? 0,
  });
}
