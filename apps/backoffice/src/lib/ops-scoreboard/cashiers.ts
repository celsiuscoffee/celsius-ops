// Per-cashier lead measures over a period, grouped by outlet. The OUTLET roll-up
// lives in /api/scorecard (computeScorecard); this is the per-PERSON layer the
// outlet scorecard doesn't compute — the cashier-coachable numbers (capture +
// upsell) the WhatsApp scoreboard DMs to each cashier and uses to name the
// laggard on the manager board.
//
// Capture = pos_orders.loyalty_phone (matches the dashboard + the live register
// chip in /api/pos/cashier-scorecard), NOT customer_phone — so cashiers see the
// same number everywhere. Cashier-rung only (source='pos', status='completed').

import { prisma } from "@/lib/prisma";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import type { ScorecardPeriod } from "@/app/api/scorecard/route";

export interface CashierRow {
  employeeId: string;
  name: string;
  phone: string | null;
  orders: number;
  captureRate: number | null; // % orders with loyalty_phone
  upsellRate: number | null; // % orders with a register pair-add
}

export interface OutletCashierBoard {
  loyaltyOutletId: string;
  outletId: string; // Prisma Outlet.id
  outletName: string;
  cashiers: CashierRow[]; // sorted worst-capture first (the coaching order)
  crewCaptureRate: number | null; // outlet-wide capture across cashiers
  best: CashierRow | null; // highest-capture cashier with enough volume (the "here's how")
}

const MIN_ORDERS = 15; // ignore cashiers with too little volume to judge

function rate(num: number, den: number): number | null {
  return den > 0 ? Math.round((num / den) * 100) : null;
}

// One board per active POS outlet, each with its cashiers ranked worst-capture
// first. Joins employee_id → User for names + WhatsApp phones.
export async function computeCashierBoards(p: ScorecardPeriod): Promise<OutletCashierBoard[]> {
  const supabase = getSupabaseAdmin();

  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE", type: "OUTLET", loyaltyOutletId: { not: null } },
    select: { id: true, name: true, loyaltyOutletId: true },
  });
  const byLoyaltyId = new Map(outlets.map((o) => [o.loyaltyOutletId as string, o]));

  const [ordersRes, pairRes] = await Promise.all([
    supabase
      .from("pos_orders")
      .select("id, outlet_id, employee_id, loyalty_phone")
      .eq("status", "completed")
      .eq("source", "pos")
      .gte("created_at", p.fromISO)
      .lte("created_at", p.toISO)
      .limit(100000),
    supabase
      .from("pos_pair_events")
      .select("order_id, outlet_id, employee_id")
      .eq("source", "register")
      .gte("created_at", p.fromISO)
      .lte("created_at", p.toISO)
      .limit(100000),
  ]);
  if (ordersRes.error) throw new Error(`pos_orders: ${ordersRes.error.message}`);
  const orders = ordersRes.data ?? [];
  const pairRows = pairRes.data ?? [];

  // Accumulate per (loyaltyOutletId, employeeId).
  type Acc = { orders: number; collected: number; orderIds: Set<string>; upsellOrderIds: Set<string> };
  const byOutlet = new Map<string, Map<string, Acc>>();
  const ensure = (lid: string, emp: string): Acc => {
    let m = byOutlet.get(lid);
    if (!m) byOutlet.set(lid, (m = new Map()));
    let a = m.get(emp);
    if (!a) m.set(emp, (a = { orders: 0, collected: 0, orderIds: new Set(), upsellOrderIds: new Set() }));
    return a;
  };

  for (const o of orders) {
    const lid = o.outlet_id as string | null;
    const emp = o.employee_id as string | null;
    if (!lid || !emp || !byLoyaltyId.has(lid)) continue; // unattributed / untracked
    const a = ensure(lid, emp);
    a.orders++;
    a.orderIds.add(o.id as string);
    if (o.loyalty_phone) a.collected++;
  }
  for (const pe of pairRows) {
    const lid = pe.outlet_id as string | null;
    const emp = pe.employee_id as string | null;
    const oid = pe.order_id as string | null;
    if (!lid || !emp) continue;
    const a = byOutlet.get(lid)?.get(emp);
    if (a && oid && a.orderIds.has(oid)) a.upsellOrderIds.add(oid);
  }

  // Resolve names + phones for every employee seen.
  const empIds = Array.from(new Set([...byOutlet.values()].flatMap((m) => [...m.keys()])));
  const users = empIds.length
    ? await prisma.user.findMany({ where: { id: { in: empIds } }, select: { id: true, name: true, fullName: true, phone: true } })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const boards: OutletCashierBoard[] = [];
  for (const [lid, m] of byOutlet) {
    const outlet = byLoyaltyId.get(lid)!;
    const cashiers: CashierRow[] = [];
    let crewOrders = 0;
    let crewCollected = 0;
    for (const [emp, a] of m) {
      crewOrders += a.orders;
      crewCollected += a.collected;
      if (a.orders < MIN_ORDERS) continue; // too little volume to coach on
      const u = userById.get(emp);
      cashiers.push({
        employeeId: emp,
        name: u ? u.fullName || u.name : emp,
        phone: u?.phone ?? null,
        orders: a.orders,
        captureRate: rate(a.collected, a.orders),
        upsellRate: rate(a.upsellOrderIds.size, a.orders),
      });
    }
    cashiers.sort((x, y) => (x.captureRate ?? 999) - (y.captureRate ?? 999)); // worst first
    const eligible = cashiers.filter((c) => c.captureRate !== null);
    const best = eligible.length ? eligible[eligible.length - 1] : null;
    boards.push({
      loyaltyOutletId: lid,
      outletId: outlet.id,
      outletName: outlet.name,
      cashiers,
      crewCaptureRate: rate(crewCollected, crewOrders),
      best,
    });
  }
  return boards;
}
