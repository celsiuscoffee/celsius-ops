import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireAuth } from "@/lib/auth";

/**
 * GET /api/pos/cashier-performance
 *
 * Per-cashier phone-collection effectiveness — the loyalty-DB top-of-funnel
 * metric. See docs/design/cashier-performance-dashboard.md.
 *
 * Scope: only CASHIER-RUNG orders (source='pos', status='completed'). Grab /
 * pickup / QR self-orders are excluded — there's no cashier to ask, so counting
 * them would punish staff for orders they can't act on.
 *
 * Collection = a loyalty phone was captured on the order (loyalty_phone not
 * null) — i.e. the customer was tied into the loyalty DB. Rates are 0–100 ints.
 *
 * Query params: outletId (optional, all outlets if absent), days (default 30).
 *
 * NOTE: new-vs-repeat split and the upsell metric are deliberately NOT here yet
 * (Phase B) — v1 is the ungameable collection rate. The maxSamePhone field is an
 * informational anti-gaming signal (one number on many of a cashier's tickets).
 */

const CASHIER_SOURCES = ["pos"]; // till-rung only; excludes grabfood / pickup / qr-table

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const outletId = url.searchParams.get("outletId");
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10) || 30, 1), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const supabase = getSupabaseAdmin();

  let q = supabase
    .from("pos_orders")
    .select("id, employee_id, source, loyalty_phone, outlet_id, created_at")
    .eq("status", "completed")
    .in("source", CASHIER_SOURCES)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20000);
  if (outletId) q = q.eq("outlet_id", outletId);

  const { data: orders, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = orders ?? [];

  // ── Aggregate per cashier ──────────────────────────────────
  type Agg = { orders: number; collected: number; phones: Record<string, number> };
  const byStaff: Record<string, Agg> = {};
  let totalOrders = 0;
  let totalCollected = 0;
  for (const o of rows) {
    const id = (o.employee_id as string) || "unknown";
    const phone = (o.loyalty_phone as string | null) || null;
    if (!byStaff[id]) byStaff[id] = { orders: 0, collected: 0, phones: {} };
    byStaff[id].orders++;
    totalOrders++;
    if (phone) {
      byStaff[id].collected++;
      totalCollected++;
      byStaff[id].phones[phone] = (byStaff[id].phones[phone] || 0) + 1;
    }
  }

  // ── Resolve names (employee_id = User.id) — same pattern as reports/route ──
  const empIds = Object.keys(byStaff).filter((id) => id !== "unknown");
  const nameById: Record<string, string> = {};
  if (empIds.length > 0) {
    const { data: users } = await supabase.from("User").select("id, name").in("id", empIds);
    for (const u of users ?? []) nameById[u.id as string] = (u.name as string) || "";
  }

  const cashiers = Object.entries(byStaff)
    .map(([id, a]) => {
      // Anti-gaming: the most-repeated single phone among this cashier's
      // collected orders. A real regular recurs a little; a cashier's own number
      // on many tickets spikes. Flag = informational (owner reviews), not a block.
      const maxSamePhone = Object.values(a.phones).reduce((m, n) => Math.max(m, n), 0);
      return {
        id,
        name: nameById[id] || (id === "unknown" ? "Unassigned" : "Staff"),
        orders: a.orders,
        collected: a.collected,
        rate: a.orders > 0 ? Math.round((a.collected / a.orders) * 100) : 0,
        maxSamePhone,
        suspicious: maxSamePhone >= 5 && a.collected > 0 && maxSamePhone / a.collected >= 0.3,
      };
    })
    .sort((x, y) => y.rate - x.rate || y.orders - x.orders);

  return NextResponse.json({
    days,
    outletId: outletId || null,
    target: 70,
    overall: {
      orders: totalOrders,
      collected: totalCollected,
      rate: totalOrders > 0 ? Math.round((totalCollected / totalOrders) * 100) : 0,
    },
    cashiers,
  });
}
