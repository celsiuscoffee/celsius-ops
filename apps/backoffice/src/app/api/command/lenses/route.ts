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

  // ── People cost (latest confirmed monthly payroll, vs that month's sales) ─
  // Company figure = whole payroll vs whole-company sales. Per-outlet figure =
  // only the staff directly assigned to that outlet (User.outletId) vs that
  // outlet's sales — HQ / rotating / unassigned staff have no single outlet, so
  // they sit in `unassignedRM` and the company total, never in one outlet's %.
  const peopleCost = (async () => {
    try {
      const { data: runs } = await supabase
        .from("hr_payroll_runs")
        .select("id, period_month, period_year, total_gross, total_employer_cost")
        .in("status", ["confirmed", "paid"]).eq("cycle_type", "monthly")
        .order("period_year", { ascending: false }).order("period_month", { ascending: false }).limit(1);
      const run = runs?.[0];
      if (!run) return null;
      const companyCostRM = (Number(run.total_gross) || 0) + (Number(run.total_employer_cost) || 0);
      const mFrom = new Date(`${run.period_year}-${String(run.period_month).padStart(2, "0")}-01T00:00:00+08:00`);
      const mTo = new Date(Date.UTC(run.period_year, run.period_month, 0, 23, 59, 59)); // last day of month

      // Per-outlet sales for the payroll month.
      const salesByOutlet: Record<string, number> = {};
      await Promise.all(outlets.map(async (o) => {
        salesByOutlet[o.id] = await getUnifiedSalesForOutlet({ outletId: o.id, storehubStoreId: o.storehubId, loyaltyOutletId: o.loyaltyOutletId, pickupStoreId: o.pickupStoreId, cutoverAt: o.posNativeCutoverAt }, mFrom, mTo)
          .then((s) => s.reduce((sum, e) => sum + e.total, 0)).catch(() => 0);
      }));
      const monthSales = Object.values(salesByOutlet).reduce((a, b) => a + b, 0);

      // Per-outlet labour cost = payroll items mapped to each staff's assigned outlet.
      const { data: items } = await supabase
        .from("hr_payroll_items")
        .select("user_id, total_gross, epf_employer, socso_employer, eis_employer")
        .eq("payroll_run_id", run.id);
      const users = await prisma.user.findMany({
        where: { id: { in: (items ?? []).map((i) => i.user_id) } },
        select: { id: true, outletId: true },
      });
      const outletByUser = new Map(users.map((u) => [u.id, u.outletId]));
      const inScope = new Set(outlets.map((o) => o.id));
      const costByOutlet: Record<string, number> = {};
      let unassignedRM = 0;
      for (const it of items ?? []) {
        const cost = (Number(it.total_gross) || 0) + (Number(it.epf_employer) || 0) + (Number(it.socso_employer) || 0) + (Number(it.eis_employer) || 0);
        const oid = outletByUser.get(it.user_id);
        if (oid && inScope.has(oid)) costByOutlet[oid] = (costByOutlet[oid] || 0) + cost;
        else unassignedRM += cost;
      }
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
        label: `${MONTHS[run.period_month - 1]} ${run.period_year}`,
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
