/**
 * GrabFood marketing overview — promo cost + GrabAds spend per outlet.
 *
 * GET /api/ads/grab/overview?from=YYYY-MM-DD&to=YYYY-MM-DD&outletId=outlet-sa
 *   → { range, totals, byOutlet[] }
 *
 * Promo cost = Σ pos_orders.grab_merchant_promo (merchant-funded discounts on
 * GrabFood orders in range). Ad spend = Σ grab_ads_spend.amount_sen (manually
 * entered GrabAds, since GrabAds isn't in the Partner API). Revenue = Σ total,
 * for marketing-cost-as-%-of-revenue. Raw SQL so aggregation isn't capped by
 * the Supabase REST 1000-row limit.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

function parseDate(s: string | null): string | null {
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(req.headers, "OWNER", "ADMIN");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const from = parseDate(url.searchParams.get("from")) ?? `${today.slice(0, 8)}01`;
  const to = parseDate(url.searchParams.get("to")) ?? today;
  const outletId = url.searchParams.get("outletId");
  const oFilter = outletId && outletId !== "all" ? outletId : null;

  const promoRows = await prisma.$queryRaw<
    { outlet_id: string; name: string | null; orders: bigint; revenue_sen: bigint; promo_sen: bigint }[]
  >(Prisma.sql`
    SELECT po.outlet_id, o.name,
           COUNT(*)                              AS orders,
           COALESCE(SUM(po.total), 0)            AS revenue_sen,
           COALESCE(SUM(po.grab_merchant_promo), 0) AS promo_sen
    FROM pos_orders po
    LEFT JOIN outlets o ON o.id = po.outlet_id
    WHERE po.source = 'grabfood'
      AND po.created_at::date BETWEEN ${from}::date AND ${to}::date
      AND (${oFilter}::text IS NULL OR po.outlet_id = ${oFilter})
    GROUP BY po.outlet_id, o.name
  `);

  const adRows = await prisma.$queryRaw<{ outlet_id: string; ad_sen: bigint }[]>(Prisma.sql`
    SELECT s.outlet_id, COALESCE(SUM(s.amount_sen), 0) AS ad_sen
    FROM grab_ads_spend s
    WHERE s.period_start BETWEEN ${from}::date AND ${to}::date
      AND (${oFilter}::text IS NULL OR s.outlet_id = ${oFilter})
    GROUP BY s.outlet_id
  `);
  const adByOutlet = new Map(adRows.map((r) => [r.outlet_id, Number(r.ad_sen)]));

  const byOutlet = promoRows.map((r) => {
    const promoMYR = Number(r.promo_sen) / 100;
    const adSpendMYR = (adByOutlet.get(r.outlet_id) ?? 0) / 100;
    const revenueMYR = Number(r.revenue_sen) / 100;
    adByOutlet.delete(r.outlet_id);
    const totalMYR = promoMYR + adSpendMYR;
    return {
      outletId: r.outlet_id,
      name: r.name ?? r.outlet_id,
      orders: Number(r.orders),
      revenueMYR,
      promoMYR,
      adSpendMYR,
      totalMYR,
      marketingPctOfRevenue: revenueMYR > 0 ? (totalMYR / revenueMYR) * 100 : null,
    };
  });
  // Outlets with ad spend but no orders in range still surface.
  for (const [oid, sen] of adByOutlet) {
    byOutlet.push({
      outletId: oid, name: oid, orders: 0, revenueMYR: 0, promoMYR: 0,
      adSpendMYR: sen / 100, totalMYR: sen / 100, marketingPctOfRevenue: null,
    });
  }
  byOutlet.sort((a, b) => b.totalMYR - a.totalMYR);

  const t = byOutlet.reduce(
    (a, b) => ({
      revenueMYR: a.revenueMYR + b.revenueMYR,
      promoMYR: a.promoMYR + b.promoMYR,
      adSpendMYR: a.adSpendMYR + b.adSpendMYR,
      totalMYR: a.totalMYR + b.totalMYR,
      orders: a.orders + b.orders,
    }),
    { revenueMYR: 0, promoMYR: 0, adSpendMYR: 0, totalMYR: 0, orders: 0 },
  );

  return NextResponse.json({
    range: { from, to },
    totals: { ...t, marketingPctOfRevenue: t.revenueMYR > 0 ? (t.totalMYR / t.revenueMYR) * 100 : null },
    byOutlet,
  });
}
