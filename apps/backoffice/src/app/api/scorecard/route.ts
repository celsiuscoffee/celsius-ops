import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";

/**
 * GET /api/scorecard?period=last7days
 *
 * Per-OUTLET ("area") KPI scoreboard — answers "which area is hitting KPI".
 * Built entirely on the CURRENT POS / apps system (pos_orders, pos_pair_events,
 * checklists, stock adjustments) — NOT the retired StoreHub feed. Each outlet is
 * scored against a small set of operational KPIs and ranked by how many it meets.
 *
 * KPIs (per outlet, per period):
 *   1. Loyalty capture — % of cashier-rung orders where a loyalty phone was
 *      collected (pos_orders.loyalty_phone). Target 70% (see the cashier-
 *      performance design doc).
 *   2. Upsell — % of cashier-rung orders that ended up containing a
 *      Pair-with-a-Bite add (pos_pair_events stamped to a completed order).
 *   3. Ops compliance — checklist completion %.
 *   4. Wastage — wastage cost as % of POS sales (lower is better).
 *   5. Serving time — NOT YET INSTRUMENTED. pos_orders has no ready/served
 *      timestamp, so this is surfaced as "not tracked" rather than faked.
 *
 * Outlet identity: Prisma Outlet is the join hub. pos_orders.outlet_id maps to
 * Outlet.loyaltyOutletId; checklists / stock adjustments key by Outlet.id.
 */

export const dynamic = "force-dynamic";

// ── Default KPI targets ──────────────────────────────────────
// First-class constants (returned to the client so the UI shows the bar). These
// are the benchmarks the owner nags about; make them settings-editable later.
export const KPI_TARGETS = {
  collectionRate: 70, // % of cashier-rung orders with a loyalty phone
  upsellRate: 10, // % of cashier-rung orders with a Pair-with-a-Bite add
  opsCompletion: 90, // % of checklists completed
  wastagePctOfSales: 3, // wastage cost ≤ 3% of POS sales
} as const;

const CASHIER_SOURCES = ["pos"]; // till-rung only (excludes grab / pickup / qr)
const WASTE_TYPES = [
  "WASTAGE",
  "BREAKAGE",
  "EXPIRED",
  "SPILLAGE",
  "THEFT",
  "USED_NOT_RECORDED",
] as const;

type PeriodType =
  | "daily"
  | "yesterday"
  | "last7days"
  | "last30days"
  | "weekly"
  | "monthly"
  | "custom";

const PERIOD_LABELS: Record<PeriodType, string> = {
  daily: "Today",
  yesterday: "Yesterday",
  last7days: "Last 7 Days",
  last30days: "Last 30 Days",
  weekly: "This Week",
  monthly: "This Month",
  custom: "Custom",
};

// Resolve a period to MYT (UTC+8) day boundaries + matching ISO timestamps.
function resolvePeriod(period: PeriodType, fromParam?: string, toParam?: string) {
  const now = new Date();
  const mytNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const todayMYT = mytNow.toISOString().split("T")[0];
  let fromDate: string;
  let toDate = todayMYT;

  if (period === "custom") {
    fromDate = fromParam || toDate;
    toDate = toParam || toDate;
  } else if (period === "daily") {
    fromDate = toDate;
  } else if (period === "yesterday") {
    const d = new Date(mytNow);
    d.setDate(d.getDate() - 1);
    fromDate = toDate = d.toISOString().split("T")[0];
  } else if (period === "last30days") {
    const d = new Date(mytNow);
    d.setDate(d.getDate() - 29);
    fromDate = d.toISOString().split("T")[0];
  } else if (period === "monthly") {
    fromDate = new Date(mytNow.getUTCFullYear(), mytNow.getUTCMonth(), 1)
      .toISOString()
      .split("T")[0];
  } else {
    // last7days / weekly → trailing 7 days
    const d = new Date(mytNow);
    d.setDate(d.getDate() - 6);
    fromDate = d.toISOString().split("T")[0];
  }

  return {
    type: period,
    label: PERIOD_LABELS[period] ?? "Custom",
    fromDate,
    toDate,
    fromISO: `${fromDate}T00:00:00+08:00`,
    toISO: `${toDate}T23:59:59+08:00`,
    fromObj: new Date(`${fromDate}T00:00:00+08:00`),
    toObj: new Date(`${toDate}T23:59:59+08:00`),
  };
}

type KpiStatus = "hit" | "miss" | "nodata";

function rate(num: number, den: number): number | null {
  return den > 0 ? Math.round((num / den) * 100) : null;
}

// hit when value ≥ target (higher-is-better metrics)
function statusHigher(value: number | null, target: number): KpiStatus {
  if (value === null) return "nodata";
  return value >= target ? "hit" : "miss";
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN", "MANAGER"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const period = (searchParams.get("period") || "last7days") as PeriodType;
  const p = resolvePeriod(
    period,
    searchParams.get("from") || undefined,
    searchParams.get("to") || undefined,
  );

  const supabase = getSupabaseAdmin();

  // ── Outlets: the join hub (active storefronts only) ─────────
  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE", type: "OUTLET" },
    select: { id: true, code: true, name: true, loyaltyOutletId: true },
    orderBy: { name: "asc" },
  });

  // Map loyaltyOutletId → Prisma outlet (for the POS-side joins)
  const byLoyaltyId = new Map<string, (typeof outlets)[number]>();
  for (const o of outlets) {
    if (o.loyaltyOutletId) byLoyaltyId.set(o.loyaltyOutletId, o);
  }

  // ── 1+2+sales. POS orders → collection, upsell, revenue ─────
  const ordersQ = supabase
    .from("pos_orders")
    .select("id, source, status, loyalty_phone, outlet_id, total, created_at")
    .eq("status", "completed")
    .gte("created_at", p.fromISO)
    .lte("created_at", p.toISO)
    .limit(50000);

  const pairQ = supabase
    .from("pos_pair_events")
    .select("order_id, outlet_id")
    .eq("source", "register")
    .gte("created_at", p.fromISO)
    .lte("created_at", p.toISO)
    .limit(50000);

  // ── 3. Ops compliance — checklists in range ─────────────────
  const checklistsP = prisma.checklist.findMany({
    where: { date: { gte: p.fromObj, lte: p.toObj } },
    select: {
      outletId: true,
      status: true,
      items: { select: { photoUrl: true } },
    },
  });

  // ── 4. Wastage — stock adjustments in range + cost lookup ───
  const adjustmentsP = prisma.stockAdjustment.findMany({
    where: {
      adjustmentType: { in: [...WASTE_TYPES] },
      createdAt: { gte: p.fromObj, lte: p.toObj },
    },
    select: {
      outletId: true,
      quantity: true,
      costAmount: true,
      productId: true,
    },
  });
  const supplierPricesP = prisma.supplierProduct.findMany({
    where: { isActive: true },
    select: {
      productId: true,
      price: true,
      productPackage: { select: { conversionFactor: true } },
    },
  });

  const [ordersRes, pairRes, checklists, adjustments, supplierPrices] =
    await Promise.all([ordersQ, pairQ, checklistsP, adjustmentsP, supplierPricesP]);

  if (ordersRes.error) {
    return NextResponse.json({ error: ordersRes.error.message }, { status: 500 });
  }
  const orders = ordersRes.data ?? [];
  const pairRows = pairRes.data ?? [];

  // Per-outlet accumulators keyed by Prisma Outlet.id
  type Acc = {
    posOrders: number; // cashier-rung order count (denominator)
    collected: number; // cashier-rung orders with a loyalty phone
    revenue: number; // RM across ALL completed pos_orders sources
    upsellOrderIds: Set<string>; // distinct cashier orders containing a pair add
    posOrderIds: Set<string>; // cashier order ids (to bind pair events)
    checklistTotal: number;
    checklistDone: number;
    photoItems: number;
    totalItems: number;
    wasteCost: number;
  };
  const acc = new Map<string, Acc>();
  const ensure = (outletId: string): Acc => {
    let a = acc.get(outletId);
    if (!a) {
      a = {
        posOrders: 0,
        collected: 0,
        revenue: 0,
        upsellOrderIds: new Set(),
        posOrderIds: new Set(),
        checklistTotal: 0,
        checklistDone: 0,
        photoItems: 0,
        totalItems: 0,
        wasteCost: 0,
      };
      acc.set(outletId, a);
    }
    return a;
  };

  // POS orders → collection + revenue (map via loyaltyOutletId)
  for (const o of orders) {
    const outlet = byLoyaltyId.get(o.outlet_id as string);
    if (!outlet) continue; // pos_orders for an outlet we don't track
    const a = ensure(outlet.id);
    a.revenue += (Number(o.total) || 0) / 100; // total is in sen
    if (CASHIER_SOURCES.includes(o.source as string)) {
      a.posOrders++;
      a.posOrderIds.add(o.id as string);
      if (o.loyalty_phone) a.collected++;
    }
  }

  // Pair events → upsell (only ones bound to a cashier order in scope)
  for (const pe of pairRows) {
    const outlet = byLoyaltyId.get(pe.outlet_id as string);
    if (!outlet) continue;
    const a = acc.get(outlet.id);
    const oid = pe.order_id as string | null;
    if (a && oid && a.posOrderIds.has(oid)) a.upsellOrderIds.add(oid);
  }

  // Checklists → ops compliance (key by Outlet.id)
  for (const cl of checklists) {
    const a = ensure(cl.outletId);
    a.checklistTotal++;
    if (cl.status === "COMPLETED") a.checklistDone++;
    for (const item of cl.items) {
      a.totalItems++;
      if (item.photoUrl) a.photoItems++;
    }
  }

  // Wastage cost (cheapest active supplier price / conversion factor as fallback)
  const costMap = new Map<string, number>();
  for (const sp of supplierPrices) {
    const conversion = sp.productPackage?.conversionFactor
      ? Number(sp.productPackage.conversionFactor)
      : 0;
    if (conversion <= 0) continue;
    const costPerBase = Number(sp.price) / conversion;
    const existing = costMap.get(sp.productId);
    if (existing === undefined || costPerBase < existing) {
      costMap.set(sp.productId, costPerBase);
    }
  }
  for (const adj of adjustments) {
    const a = ensure(adj.outletId);
    const qty = Math.abs(Number(adj.quantity));
    const cost =
      adj.costAmount !== null
        ? Math.abs(Number(adj.costAmount))
        : qty * (costMap.get(adj.productId) ?? 0);
    a.wasteCost += cost;
  }

  // ── Assemble per-outlet rows ────────────────────────────────
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const rows = outlets.map((o) => {
    const a = acc.get(o.id);
    const posOrders = a?.posOrders ?? 0;
    const collected = a?.collected ?? 0;
    const upsellOrders = a?.upsellOrderIds.size ?? 0;
    const revenue = round2(a?.revenue ?? 0);
    const checklistTotal = a?.checklistTotal ?? 0;
    const checklistDone = a?.checklistDone ?? 0;
    const totalItems = a?.totalItems ?? 0;
    const photoItems = a?.photoItems ?? 0;
    const wasteCost = round2(a?.wasteCost ?? 0);

    const collectionVal = rate(collected, posOrders);
    const upsellVal = rate(upsellOrders, posOrders);
    const opsVal = rate(checklistDone, checklistTotal);
    const photoRate = rate(photoItems, totalItems);
    const wastagePct = revenue > 0 ? round2((wasteCost / revenue) * 100) : null;

    const collection = {
      value: collectionVal,
      target: KPI_TARGETS.collectionRate,
      status: statusHigher(collectionVal, KPI_TARGETS.collectionRate),
      orders: posOrders,
      collected,
    };
    const upsell = {
      value: upsellVal,
      target: KPI_TARGETS.upsellRate,
      status: statusHigher(upsellVal, KPI_TARGETS.upsellRate),
      orders: posOrders,
      upsellOrders,
    };
    const ops = {
      value: opsVal,
      target: KPI_TARGETS.opsCompletion,
      status: statusHigher(opsVal, KPI_TARGETS.opsCompletion),
      completed: checklistDone,
      total: checklistTotal,
      photoRate,
    };
    // Wastage is lower-is-better; "no data" when there's no sales to measure against.
    const wastageStatus: KpiStatus =
      wastagePct === null
        ? "nodata"
        : wastagePct <= KPI_TARGETS.wastagePctOfSales
          ? "hit"
          : "miss";
    const wastage = {
      value: wastagePct,
      target: KPI_TARGETS.wastagePctOfSales,
      status: wastageStatus,
      cost: wasteCost,
    };
    const serving = {
      value: null as number | null,
      status: "nodata" as KpiStatus,
      note: "Not tracked yet — needs a ready/served timestamp on pos_orders.",
    };

    const tracked = [collection, upsell, ops, wastage];
    const met = tracked.filter((k) => k.status === "hit").length;
    const measurable = tracked.filter((k) => k.status !== "nodata").length;

    return {
      id: o.id,
      code: o.code,
      name: o.name,
      onPos: !!o.loyaltyOutletId,
      revenue,
      kpis: { collection, upsell, ops, wastage, serving },
      met,
      measurable,
      score: measurable > 0 ? Math.round((met / measurable) * 100) : null,
    };
  });

  // Rank: highest score first, then most KPIs met, then revenue
  rows.sort(
    (x, y) =>
      (y.score ?? -1) - (x.score ?? -1) ||
      y.met - x.met ||
      y.revenue - x.revenue,
  );

  // ── Summary ─────────────────────────────────────────────────
  const measured = rows.filter((r) => r.measurable > 0);
  const hittingAll = measured.filter((r) => r.met === r.measurable).length;
  const avg = (vals: (number | null)[]) => {
    const nums = vals.filter((v): v is number => v !== null);
    return nums.length ? Math.round(nums.reduce((s, v) => s + v, 0) / nums.length) : null;
  };

  return NextResponse.json({
    period: { from: p.fromDate, to: p.toDate, type: p.type, label: p.label },
    generatedAt: new Date().toISOString(),
    targets: KPI_TARGETS,
    summary: {
      totalOutlets: rows.length,
      measuredOutlets: measured.length,
      hittingAll,
      totalRevenue: round2(rows.reduce((s, r) => s + r.revenue, 0)),
      avg: {
        collection: avg(rows.map((r) => r.kpis.collection.value)),
        upsell: avg(rows.map((r) => r.kpis.upsell.value)),
        ops: avg(rows.map((r) => r.kpis.ops.value)),
        wastagePct: avg(rows.map((r) => r.kpis.wastage.value)),
      },
    },
    outlets: rows,
  });
}
