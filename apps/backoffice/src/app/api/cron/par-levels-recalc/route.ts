import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recalcOutletParLevels } from "@/lib/inventory/par-calc";
import { touchAgentRun, logAgentAction } from "@/lib/agents/substrate";

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
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) {
    const user = await getSession();
    if (!user || !["OWNER", "ADMIN"].includes(user.role)) {
      return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
    }
  }
  await touchAgentRun("par_levels_recalc");
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
    const updated = results.reduce((s, r) => s + r.productsUpdated, 0);
    await logAgentAction({
      agentKey: "par_levels_recalc",
      kind: "pars_recalced",
      summary: `Recalculated reorder points for ${results.length} outlets from 30-day sales: ${updated} products updated, RM${totalParValue.toFixed(0)} projected par value`,
      meta: { outlets: results.length, updated, totalParValue },
    });
    return NextResponse.json({ ok: true, totalParValue, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "par-levels-recalc failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
