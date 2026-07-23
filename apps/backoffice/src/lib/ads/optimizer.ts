/**
 * Smart-campaign budget optimizer — "how much ad spend can I safely reclaim
 * and move to other marketing?"
 *
 * Two reclaim tiers, honest about the tradeoff:
 *
 *   1. WASTE (≈ zero conversion loss) — spend on terms you own organically /
 *      competitor brands, from the Paid×Organic report. Cut via negatives;
 *      the clicks were buying what the map already gives you free.
 *
 *   2. EFFICIENCY TRIM (proportional conversion loss, shown explicitly) — the
 *      least cost-efficient campaigns carry the most expensive marginal
 *      conversions. Trim their daily budget in small steps toward the fleet's
 *      best cost/conversion. We do NOT pretend trimming improves efficiency —
 *      it reclaims the worst-value ringgit and states the conversions given up.
 *
 * Smart campaigns expose only two real levers (negatives + budget), so this is
 * the whole optimisation surface. Every number is a proxy: a Smart-campaign
 * "conversion" is a direction/call/menu click, not a sale — use it to compare
 * campaigns and size cuts, not as revenue.
 */

import { prisma } from "@/lib/prisma";
import { microsToMYR } from "./client";
import { buildPaidOrganicReport } from "./paid-organic";

// Trim policy. Conservative single-step cuts; the weekly loop re-measures and
// steps again rather than making one big move a Smart campaign can't absorb.
export const BENCHMARK_MIN_CONV = 20;   // a campaign needs this many conv to set/judge the benchmark
export const EFFICIENT_RATIO = 1.15;    // ≤ this × the best cost/conv → leave alone
export const MAX_TRIM_PCT = 0.20;       // never cut more than 20% of daily budget in one step
export const FLOOR_PCT = 0.5;           // never drop below 50% of current budget (visibility floor)
export const CAPPED_AT = 0.9;           // spending ≥ 90% of budget ⇒ budget-limited

// sync-campaigns stores campaign.status straight from the Ads API, which
// serializes the CampaignStatus enum as its NUMBER ("2" = ENABLED, "3" =
// PAUSED, "4" = REMOVED) — not the label. Match both so the filter survives
// any future change to how the enum is serialized.
export const ENABLED_STATUSES = ["2", "ENABLED"];

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Live allocated Google Ads daily budget across ENABLED (non-manager)
 * campaigns, in MYR/day. This is the forward-looking committed spend the
 * optimizer loop moves up and down — the cashflow marketing forecast reads it
 * instead of the trailing bank run-rate so a budget cut (or raise) shows up in
 * the projection immediately rather than bleeding in over 90 days.
 */
export async function getLiveAdsDailyBudgetMyr(): Promise<{ dailyMyr: number; campaigns: number }> {
  const rows = await prisma.adsCampaign.findMany({
    where: { status: { in: ENABLED_STATUSES }, account: { isManager: false } },
    select: { dailyBudgetMicros: true },
  });
  const micros = rows.reduce((s, r) => s + (r.dailyBudgetMicros ?? BigInt(0)), BigInt(0));
  return { dailyMyr: round2(Number(micros) / 1_000_000), campaigns: rows.length };
}
const round0 = (n: number) => Math.round(n);

export type TrimSuggestion = {
  trimPct: number;          // 0..MAX_TRIM_PCT
  newDailyMyr: number;      // recommended daily budget
  dailySavedMyr: number;
  monthlySavedMyr: number;
  projConvLostPerMonth: number; // trimmed spend ÷ this campaign's cost/conv
};

/**
 * Pure: given a campaign's cost-efficiency vs the fleet benchmark, how much to
 * trim. Efficient campaigns are left alone; inefficiency scales the cut up to
 * MAX_TRIM_PCT, bounded by the visibility floor. Null cost/conv (no data) → no cut.
 */
export function suggestTrim(
  currentDailyMyr: number,
  costPerConv: number | null,
  benchmarkCostPerConv: number | null,
): TrimSuggestion {
  const none: TrimSuggestion = { trimPct: 0, newDailyMyr: round2(currentDailyMyr), dailySavedMyr: 0, monthlySavedMyr: 0, projConvLostPerMonth: 0 };
  if (!costPerConv || !benchmarkCostPerConv || currentDailyMyr <= 0) return none;

  const ratio = costPerConv / benchmarkCostPerConv;
  if (ratio <= EFFICIENT_RATIO) return none; // it's among your best spend — keep it

  // Scale trim from 0 at EFFICIENT_RATIO up to MAX_TRIM_PCT at ratio ≥ 2×.
  const scaled = ((ratio - EFFICIENT_RATIO) / (2 - EFFICIENT_RATIO)) * MAX_TRIM_PCT;
  const trimPct = Math.max(0, Math.min(MAX_TRIM_PCT, scaled));
  if (trimPct <= 0) return none;

  const newDaily = Math.max(currentDailyMyr * FLOOR_PCT, currentDailyMyr * (1 - trimPct));
  const dailySaved = currentDailyMyr - newDaily;
  const monthlySaved = dailySaved * 30;
  return {
    trimPct: round2((currentDailyMyr - newDaily) / currentDailyMyr),
    newDailyMyr: round2(newDaily),
    dailySavedMyr: round2(dailySaved),
    monthlySavedMyr: round2(monthlySaved),
    projConvLostPerMonth: round0(monthlySaved / costPerConv),
  };
}

export type OptimizerCampaign = {
  campaignId: string;
  campaignName: string;
  outletName: string | null;
  dailyBudgetMyr: number;
  costMyr: number;          // over window
  clicks: number;
  conversions: number;
  costPerConv: number | null;
  cpc: number | null;
  avgDailySpendMyr: number;
  budgetCapped: boolean;
  efficiencyRatio: number | null; // costPerConv ÷ benchmark; 1 = best
  wasteMonthlyMyr: number;        // reclaimable via negatives (Paid×Organic)
  trim: TrimSuggestion;
  reclaimableMonthlyMyr: number;  // waste + trim
  lastChange: { status: string; newDailyMyr: number; decidedAt: string } | null; // latest budget decision
};

export type OptimizerReport = {
  windowDays: number;
  benchmarkCostPerConv: number | null;
  benchmarkOutlet: string | null;
  campaigns: OptimizerCampaign[];
  summary: {
    totalMonthlySpendMyr: number;
    reclaimableWasteMyr: number;   // tier 1 — ~no conv loss
    reclaimableTrimMyr: number;    // tier 2 — with conv loss
    totalReclaimableMyr: number;
    projConvLostPerMonth: number;  // from the trims only
    searchTermsAvailable: boolean; // false ⇒ backfill not run, waste is blind
  };
};

export async function buildAdsOptimizerReport(windowDays = 30): Promise<OptimizerReport> {
  const since = new Date(Date.now() - windowDays * 86400000);

  const [campaigns, metrics, paidOrganic] = await Promise.all([
    prisma.adsCampaign.findMany({
      where: { status: { in: ENABLED_STATUSES }, account: { isManager: false } },
      select: { id: true, name: true, dailyBudgetMicros: true, outletId: true },
    }),
    prisma.adsMetricDaily.groupBy({
      by: ["campaignId"],
      where: { date: { gte: since }, campaignId: { not: null } },
      _sum: { costMicros: true, clicks: true, conversions: true },
    }),
    buildPaidOrganicReport(windowDays).catch(() => null),
  ]);

  const [outlets, changes] = await Promise.all([
    prisma.outlet.findMany({ select: { id: true, name: true } }),
    // Latest budget decision per campaign — surfaced so the page reflects an
    // already-applied cut and can suppress a duplicate suggestion.
    prisma.adsBudgetChange.findMany({
      orderBy: { decidedAt: "desc" },
      select: { campaignId: true, status: true, newDailyMicros: true, decidedAt: true },
    }),
  ]);
  const outletName = new Map(outlets.map((o) => [o.id, o.name]));

  const lastChangeByCampaign = new Map<string, OptimizerCampaign["lastChange"]>();
  for (const c of changes) {
    if (!lastChangeByCampaign.has(c.campaignId)) {
      lastChangeByCampaign.set(c.campaignId, {
        status: c.status,
        newDailyMyr: microsToMYR(c.newDailyMicros),
        decidedAt: c.decidedAt.toISOString(),
      });
    }
  }

  const metricByCampaign = new Map(metrics.map((m) => [m.campaignId as string, m._sum]));

  // Waste per campaign = owned-organic exclude candidates not yet applied.
  const wasteByCampaign = new Map<string, number>();
  if (paidOrganic) {
    for (const r of paidOrganic.rows) {
      if (r.verdict === "exclude_candidate" && r.exclusion?.status !== "applied") {
        wasteByCampaign.set(r.campaignId, (wasteByCampaign.get(r.campaignId) ?? 0) + r.estMonthlySavingMyr);
      }
    }
  }

  // First pass: raw efficiency per campaign.
  const base = campaigns.map((c) => {
    const m = metricByCampaign.get(c.id);
    const costMyr = microsToMYR(m?.costMicros ?? BigInt(0));
    const clicks = Number(m?.clicks ?? 0);
    const conversions = Number(m?.conversions ?? 0);
    const costPerConv = conversions > 0 ? costMyr / conversions : null;
    const dailyBudgetMyr = microsToMYR(c.dailyBudgetMicros ?? BigInt(0));
    const avgDailySpendMyr = windowDays > 0 ? costMyr / windowDays : 0;
    return {
      campaignId: c.id,
      campaignName: c.name,
      outletName: c.outletId ? outletName.get(c.outletId) ?? null : null,
      dailyBudgetMyr,
      costMyr: round2(costMyr),
      clicks,
      conversions: round0(conversions),
      costPerConv: costPerConv != null ? round2(costPerConv) : null,
      cpc: clicks > 0 ? round2(costMyr / clicks) : null,
      avgDailySpendMyr: round2(avgDailySpendMyr),
      budgetCapped: dailyBudgetMyr > 0 && avgDailySpendMyr >= dailyBudgetMyr * CAPPED_AT,
      wasteMonthlyMyr: round2(wasteByCampaign.get(c.id) ?? 0),
    };
  });

  // Benchmark = best (lowest) cost/conv among campaigns with enough conversions.
  const eligible = base.filter((b) => b.costPerConv != null && b.conversions >= BENCHMARK_MIN_CONV);
  const benchmark = eligible.length
    ? eligible.reduce((best, b) => (b.costPerConv! < best.costPerConv! ? b : best))
    : null;
  const benchmarkCostPerConv = benchmark?.costPerConv ?? null;

  const enriched: OptimizerCampaign[] = base.map((b) => {
    const trim = suggestTrim(b.dailyBudgetMyr, b.costPerConv, benchmarkCostPerConv);
    return {
      ...b,
      efficiencyRatio: b.costPerConv != null && benchmarkCostPerConv ? round2(b.costPerConv / benchmarkCostPerConv) : null,
      trim,
      reclaimableMonthlyMyr: round2(b.wasteMonthlyMyr + trim.monthlySavedMyr),
      lastChange: lastChangeByCampaign.get(b.campaignId) ?? null,
    };
  });

  enriched.sort((a, b) => b.reclaimableMonthlyMyr - a.reclaimableMonthlyMyr);

  const reclaimableWasteMyr = round2(enriched.reduce((s, c) => s + c.wasteMonthlyMyr, 0));
  const reclaimableTrimMyr = round2(enriched.reduce((s, c) => s + c.trim.monthlySavedMyr, 0));

  return {
    windowDays,
    benchmarkCostPerConv,
    benchmarkOutlet: benchmark?.outletName ?? benchmark?.campaignName ?? null,
    campaigns: enriched,
    summary: {
      totalMonthlySpendMyr: round2(enriched.reduce((s, c) => s + c.avgDailySpendMyr * 30, 0)),
      reclaimableWasteMyr,
      reclaimableTrimMyr,
      totalReclaimableMyr: round2(reclaimableWasteMyr + reclaimableTrimMyr),
      projConvLostPerMonth: round0(enriched.reduce((s, c) => s + c.trim.projConvLostPerMonth, 0)),
      searchTermsAvailable: !!paidOrganic && (paidOrganic.summary.termsWithSpend > 0),
    },
  };
}
