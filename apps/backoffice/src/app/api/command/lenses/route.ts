import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { buildByCategory, type OutletPick } from "@/app/api/sales/_lib/reports";
import { getUnifiedSalesForOutlet } from "@/app/api/sales/_lib/unified-sales";
import { startOfWeekMYT, startOfMonthMYT } from "@celsius/shared";

// ─── GET /api/command/lenses ────────────────────────────────────────────────
// The heavier Command Center lenses, split out from /api/command so the pulse +
// league render instantly while these fill in: serving time (the <10-min
// promise), COGS, wastage, people cost, and customer win-back. Each lens is
// independently guarded — one failing never blanks the rest.

const BRAND_ID = "brand-celsius";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function GET(request: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const period = new URL(request.url).searchParams.get("period") || "month";
  const mytNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const todayMYT = mytNow.toISOString().split("T")[0];
  const fromDate = period === "today" ? todayMYT : period === "week" ? startOfWeekMYT(todayMYT) : startOfMonthMYT(todayMYT);
  const toDate = todayMYT;

  const scopeOutletId = user.outletId || new URL(request.url).searchParams.get("outletId") || null;
  const outlets: OutletPick[] = await prisma.outlet.findMany({
    where: scopeOutletId
      ? { id: scopeOutletId }
      : { status: "ACTIVE", OR: [{ storehubId: { not: null } }, { loyaltyOutletId: { not: null } }] },
    select: { id: true, name: true, storehubId: true, loyaltyOutletId: true, pickupStoreId: true, posNativeCutoverAt: true },
  });

  const supabase = getSupabaseAdmin();
  const outletByLoyalty = new Map(outlets.filter((o) => o.loyaltyOutletId).map((o) => [o.loyaltyOutletId!, o.id]));

  // ── Serving time (served_at − created_at, per outlet) ───────────────────
  const serving = (async () => {
    try {
      const { data } = await supabase
        .from("pos_orders")
        .select("outlet_id, created_at, served_at, ready_at")
        .gte("created_at", `${fromDate}T00:00:00+08:00`)
        .lte("created_at", `${toDate}T23:59:59+08:00`);
      const byOutlet: Record<string, number[]> = {};
      const all: number[] = [];
      for (const r of data ?? []) {
        const fulfilled = r.served_at || r.ready_at;
        if (!fulfilled) continue;
        const mins = (new Date(fulfilled).getTime() - new Date(r.created_at).getTime()) / 60000;
        if (!(mins > 0 && mins < 60)) continue; // drop forgotten / left-open tickets (>60m ≠ serve time)
        const oid = outletByLoyalty.get(r.outlet_id);
        if (!oid) continue;
        (byOutlet[oid] ??= []).push(mins);
        all.push(mins);
      }
      const stat = (arr: number[]) =>
        arr.length ? { avgMins: Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10, maxMins: Math.round(Math.max(...arr) * 10) / 10, tracked: arr.length } : null;
      const perOutlet: Record<string, { avgMins: number; maxMins: number; tracked: number }> = {};
      for (const [oid, arr] of Object.entries(byOutlet)) { const s = stat(arr); if (s) perOutlet[oid] = s; }
      return { company: stat(all), byOutlet: perOutlet };
    } catch (e) { console.error("[lenses] serving", e); return null; }
  })();

  // ── COGS (company, BOM-based) ───────────────────────────────────────────
  const cogs = (async () => {
    try {
      const r = await buildByCategory(outlets, fromDate, toDate);
      if (!r.total) return null;
      return { rm: Number(r.total.cogs) || 0, pct: Number(r.total.cogsPct) || 0, gpPct: Number(r.total.gpPct) || 0 };
    } catch (e) { console.error("[lenses] cogs", e); return null; }
  })();

  // ── Wastage (RM, per outlet + company) ──────────────────────────────────
  const wastage = (async () => {
    try {
      const rows = await prisma.stockAdjustment.groupBy({
        by: ["outletId"],
        where: { adjustmentType: "WASTAGE", outletId: { in: outlets.map((o) => o.id) }, createdAt: { gte: new Date(`${fromDate}T00:00:00+08:00`), lte: new Date(`${toDate}T23:59:59+08:00`) } },
        _sum: { costAmount: true },
      });
      const byOutlet: Record<string, number> = {};
      let companyRM = 0;
      for (const r of rows) { const v = Number(r._sum.costAmount) || 0; byOutlet[r.outletId] = Math.round(v); companyRM += v; }
      return { companyRM: Math.round(companyRM), byOutlet };
    } catch (e) { console.error("[lenses] wastage", e); return null; }
  })();

  // ── People cost (latest closed payroll month, per outlet, vs that month's sales) ─
  // Payroll is monthly and lands in fin_payroll_actuals — the authoritative
  // BrioHR ledger, one row per (period, company, outlet), tagged to the real
  // outlet so the per-outlet split is the actual assigned cost. The current
  // calendar month is usually still open (no actuals yet), so we show the most
  // recent month that HAS actuals at or before the selected window — normally the
  // last closed month, labelled so it reads as e.g. "Jun 2026". HQ / management
  // rows (outlet_id NULL) are a group cost: they sit in the company roll-up and
  // `unassignedRM`, never inside a single outlet's %.
  const peopleCost = (async () => {
    try {
      const monthEnd = toDate.slice(0, 7); // 'YYYY-MM'
      const latest = await prisma.$queryRaw<{ ym: string }[]>`
        SELECT to_char(period, 'YYYY-MM') AS ym FROM fin_payroll_actuals
        WHERE to_char(period, 'YYYY-MM') <= ${monthEnd}
        ORDER BY period DESC LIMIT 1`;
      const ym = latest[0]?.ym;
      if (!ym) return null;
      const [py, pm] = ym.split("-").map(Number);

      // Per-outlet salary + employer statutory for that month.
      const rows = await prisma.$queryRaw<{ outlet_id: string | null; cost: number }[]>`
        SELECT outlet_id, COALESCE(SUM(salary + employer_stat), 0)::float AS cost
        FROM fin_payroll_actuals
        WHERE to_char(period, 'YYYY-MM') = ${ym}
        GROUP BY outlet_id`;
      const inScope = new Set(outlets.map((o) => o.id));
      const costByOutlet: Record<string, number> = {};
      let unassignedRM = 0;   // HQ / management (null outlet)
      let companyCostRM = 0;  // total group people cost for the month
      for (const r of rows) {
        const c = Number(r.cost) || 0;
        companyCostRM += c;
        if (r.outlet_id && inScope.has(r.outlet_id)) costByOutlet[r.outlet_id] = (costByOutlet[r.outlet_id] || 0) + c;
        else if (r.outlet_id == null) unassignedRM += c;
      }

      // Sales for that same payroll month, per in-scope outlet.
      const mFrom = new Date(`${ym}-01T00:00:00+08:00`);
      const mTo = new Date(Date.UTC(py, pm, 0, 23, 59, 59)); // last day of month
      const salesByOutlet: Record<string, number> = {};
      await Promise.all(outlets.map(async (o) => {
        salesByOutlet[o.id] = await getUnifiedSalesForOutlet({ outletId: o.id, storehubStoreId: o.storehubId, loyaltyOutletId: o.loyaltyOutletId, pickupStoreId: o.pickupStoreId, cutoverAt: o.posNativeCutoverAt }, mFrom, mTo)
          .then((s) => s.reduce((sum, e) => sum + e.total, 0)).catch(() => 0);
      }));
      const monthSales = Object.values(salesByOutlet).reduce((a, b) => a + b, 0);

      const byOutlet: Record<string, { costRM: number; pct: number | null }> = {};
      for (const o of outlets) {
        const c = Math.round(costByOutlet[o.id] || 0);
        const s = salesByOutlet[o.id] || 0;
        byOutlet[o.id] = { costRM: c, pct: s > 0 ? Math.round((c / s) * 100) : null };
      }

      // When the request is already scoped to one outlet (manager view), surface
      // that outlet's figure at the top level; otherwise show the company roll-up.
      const scoped = scopeOutletId ? byOutlet[scopeOutletId] : null;
      return {
        label: `${MONTHS[pm - 1]} ${py}`,
        costRM: scoped ? scoped.costRM : Math.round(companyCostRM),
        pct: scoped ? scoped.pct : monthSales > 0 ? Math.round((companyCostRM / monthSales) * 100) : null,
        unassignedRM: Math.round(unassignedRM),
        byOutlet,
      };
    } catch (e) { console.error("[lenses] peopleCost", e); return null; }
  })();

  // ── Churn / win-back (company, members inactive > 28 days) ───────────────
  const churn = (async () => {
    try {
      const cutoff = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();
      const atRiskQ = supabase.from("member_brands").select("*", { count: "exact", head: true })
        .eq("brand_id", BRAND_ID).lt("last_visit_at", cutoff).gt("total_visits", 0);
      const winBackQ = supabase.from("member_brands").select("*", { count: "exact", head: true })
        .eq("brand_id", BRAND_ID).lt("last_visit_at", cutoff).gt("total_visits", 1);
      const [{ count: atRisk }, { count: winBack }] = await Promise.all([atRiskQ, winBackQ]);
      return { atRisk: atRisk ?? 0, winBack: winBack ?? 0 };
    } catch (e) { console.error("[lenses] churn", e); return null; }
  })();

  const [servingR, cogsR, wastageR, peopleR, churnR] = await Promise.all([serving, cogs, wastage, peopleCost, churn]);
  return NextResponse.json({
    period: { type: period, from: fromDate, to: toDate },
    serving: servingR,
    cogs: cogsR,
    wastage: wastageR,
    peopleCost: peopleR,
    churn: churnR,
  });
}
