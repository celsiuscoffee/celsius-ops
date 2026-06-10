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

  // ── Member join dates → new vs repeat ──────────────────────
  // A collected order is "new" if the member was created at/around this order
  // (a fresh enrolment — the high-value acquisition), "repeat" if the member
  // already existed. Phones are E.164 and join members.phone exactly; a member
  // not found is counted as repeat (never inflate the new-acquisition number).
  const phones = [...new Set(rows.map((o) => o.loyalty_phone as string | null).filter(Boolean))] as string[];
  const memberCreatedMs: Record<string, number> = {};
  for (let i = 0; i < phones.length; i += 1000) {
    const chunk = phones.slice(i, i + 1000);
    const { data: members } = await supabase.from("members").select("phone, created_at").in("phone", chunk);
    for (const m of members ?? []) {
      const c = m.created_at as string | null;
      if (m.phone && c) memberCreatedMs[m.phone as string] = Date.parse(c);
    }
  }
  const NEW_WINDOW_MS = 15 * 60 * 1000; // member born within 15 min of the order = a fresh enrolment

  // ── Aggregate per cashier ──────────────────────────────────
  type Agg = { orders: number; collected: number; newC: number; phones: Record<string, number> };
  const byStaff: Record<string, Agg> = {};
  let totalOrders = 0;
  let totalCollected = 0;
  let totalNew = 0;
  for (const o of rows) {
    const id = (o.employee_id as string) || "unknown";
    const phone = (o.loyalty_phone as string | null) || null;
    if (!byStaff[id]) byStaff[id] = { orders: 0, collected: 0, newC: 0, phones: {} };
    byStaff[id].orders++;
    totalOrders++;
    if (phone) {
      byStaff[id].collected++;
      totalCollected++;
      const memMs = memberCreatedMs[phone];
      const isNew = memMs != null && memMs >= Date.parse(o.created_at as string) - NEW_WINDOW_MS;
      if (isNew) {
        byStaff[id].newC++;
        totalNew++;
      }
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

  // ── Upsell: per-cashier Pair-with-a-Bite penetration ────────
  // Pair Adds = raw count of cashier-attributed pair taps (source=register,
  //   employee_id set) — an effort/volume number.
  // Upsell %  = share of the cashier's completed orders that ended up CONTAINING
  //   an upsold pair = (orders with an upsell) ÷ (total orders), DEDUPED PER
  //   ORDER — three pairs on one ticket still count as a single upsell order.
  //   Attribution is now EXACT: the register stamps the real order_id onto each
  //   cart's pair-adds at checkout (/api/pos/loyalty/pair-order), so we just
  //   count DISTINCT stamped order_ids that are completed cashier orders in
  //   scope. (Replaces the old 30-min time-reconcile, which missed almost
  //   everything because a tap carried no order key.) Order-based + success-
  //   based: an unbound tap on an abandoned cart never counts.
  const orderIdSet = new Set(rows.map((o) => o.id as string));

  let pairQ = supabase
    .from("pos_pair_events")
    .select("employee_id, order_id")
    .eq("source", "register")
    .not("employee_id", "is", null)
    .gte("created_at", since)
    .limit(20000);
  if (outletId) pairQ = pairQ.eq("outlet_id", outletId);
  const { data: pairRows } = await pairQ;

  // Raw pair taps per cashier (the "Pair Adds" number) + the DISTINCT in-scope
  // orders each cashier's taps were stamped to (the upsell-penetration number).
  const addsByEmp: Record<string, number> = {};
  const upsellOrderIds: Record<string, Set<string>> = {};
  let totalAdds = 0;
  for (const pe of pairRows ?? []) {
    const emp = pe.employee_id as string | null;
    if (!emp) continue;
    addsByEmp[emp] = (addsByEmp[emp] || 0) + 1;
    totalAdds++;
    const oid = pe.order_id as string | null;
    if (oid && orderIdSet.has(oid)) (upsellOrderIds[emp] ||= new Set<string>()).add(oid);
  }

  const upsellOrdersByEmp: Record<string, number> = {};
  let totalUpsellOrders = 0;
  for (const [emp, ids] of Object.entries(upsellOrderIds)) {
    upsellOrdersByEmp[emp] = ids.size;
    totalUpsellOrders += ids.size;
  }

  const cashiers = Object.entries(byStaff)
    .map(([id, a]) => {
      // Anti-gaming: the most-repeated single phone among this cashier's
      // collected orders. A real regular recurs a little; a cashier's own number
      // on many tickets spikes. Flag = informational (owner reviews), not a block.
      const maxSamePhone = Object.values(a.phones).reduce((m, n) => Math.max(m, n), 0);
      const adds = addsByEmp[id] || 0;
      const upsellOrders = upsellOrdersByEmp[id] || 0;
      return {
        id,
        name: nameById[id] || (id === "unknown" ? "Unassigned" : "Staff"),
        orders: a.orders,
        collected: a.collected,
        collectedNew: a.newC,
        collectedRepeat: a.collected - a.newC,
        rate: a.orders > 0 ? Math.round((a.collected / a.orders) * 100) : 0,
        maxSamePhone,
        suspicious: maxSamePhone >= 5 && a.collected > 0 && maxSamePhone / a.collected >= 0.3,
        // Upsell (coaching-only): raw pair adds + the order-penetration rate
        // (orders with an upsell ÷ total orders, deduped per order).
        pairAdds: adds,
        upsellOrders,
        upsellRate: a.orders > 0 ? Math.round((upsellOrders / a.orders) * 100) : null,
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
      newMembers: totalNew,
      repeatMembers: totalCollected - totalNew,
      rate: totalOrders > 0 ? Math.round((totalCollected / totalOrders) * 100) : 0,
      pairAdds: totalAdds,
      upsellOrders: totalUpsellOrders,
      upsellRate: totalOrders > 0 ? Math.round((totalUpsellOrders / totalOrders) * 100) : null,
    },
    cashiers,
  });
}
