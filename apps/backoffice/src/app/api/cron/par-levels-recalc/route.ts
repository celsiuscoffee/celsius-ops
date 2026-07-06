import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recalcOutletParLevels } from "@/lib/inventory/par-calc";
import { cronRoute } from "@/lib/cron-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/cron/par-levels-recalc — weekly par-level refresh, every outlet
// with a POS-native mapping. Keeps reorder points / pars / max levels tracking
// the last 30 days of real sales instead of freezing at a one-off calculation
// (all 336 pars sat at their 2026-04-12 values until this existed). Scheduled
// Mondays 03:00 MYT in vercel.json; safe to run on demand as OWNER/ADMIN.
//
// Pars are engine-managed: each run overwrites the outlet's rows. Outlets with
// no POS sales in the window are skipped (their stale pars are left alone
// rather than zeroed).
async function runParLevelsRecalc() {
  try {
    const outlets = await prisma.outlet.findMany({
      where: { loyaltyOutletId: { not: null } },
      select: { id: true, name: true },
    });
    const results: Array<{
      outlet: string;
      ok: boolean;
      productsUpdated: number;
      fallbackProducts: number;
      projectedParValue: number;
      error?: string;
    }> = [];
    for (const o of outlets) {
      const r = await recalcOutletParLevels(o.id);
      results.push({
        outlet: o.name,
        ok: r.ok,
        productsUpdated: r.productsUpdated,
        fallbackProducts: r.fallbackProducts,
        projectedParValue: r.projectedParValue,
        ...(r.error ? { error: r.error } : {}),
      });
      console.log(
        `[par-recalc] ${o.name}: ok=${r.ok} updated=${r.productsUpdated} fallback=${r.fallbackProducts} parValueRM=${r.projectedParValue}${r.error ? ` (${r.error})` : ""}`,
      );
    }
    const totalParValue = Math.round(results.reduce((s, r) => s + r.projectedParValue, 0) * 100) / 100;
    return NextResponse.json({ ok: true, totalParValue, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "par-levels-recalc failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

const cronHandler = cronRoute("par-levels-recalc", runParLevelsRecalc);

// Cron secret (via cronRoute) OR an authenticated OWNER/ADMIN session, so the
// recalc can be run on demand.
export async function GET(req: NextRequest) {
  const user = await getSession();
  if (user && ["OWNER", "ADMIN"].includes(user.role)) {
    return runParLevelsRecalc();
  }
  return cronHandler(req);
}
