import { NextRequest, NextResponse } from "next/server";
import { buildAdsOptimizerReport } from "@/lib/ads/optimizer";
import { checkCronAuth } from "@celsius/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Weekly. SHADOW MODE — computes how much ad spend is reclaimable (waste +
// least-efficient marginal spend) and returns it. It deliberately does NOT
// mutate any budget: cutting a Smart campaign's budget is approval-gated and
// only ever happens from an explicit click on /ads/optimizer. This cron exists
// so the recommendation is fresh (and can later drive a nudge), not to act.
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const report = await buildAdsOptimizerReport(30);

  return NextResponse.json({
    ok: true,
    mode: "shadow",
    generatedFor: `${report.windowDays}d`,
    summary: report.summary,
    // The campaigns with something to reclaim, most first — the shortlist a
    // human would review on the Optimizer page.
    recommendations: report.campaigns
      .filter((c) => c.reclaimableMonthlyMyr > 0)
      .map((c) => ({
        campaign: c.campaignName,
        outlet: c.outletName,
        dailyBudgetMyr: c.dailyBudgetMyr,
        efficiencyRatio: c.efficiencyRatio,
        wasteMonthlyMyr: c.wasteMonthlyMyr,
        trimToDailyMyr: c.trim.trimPct > 0 ? c.trim.newDailyMyr : null,
        reclaimableMonthlyMyr: c.reclaimableMonthlyMyr,
        projConvLostPerMonth: c.trim.projConvLostPerMonth,
      })),
  });
}
