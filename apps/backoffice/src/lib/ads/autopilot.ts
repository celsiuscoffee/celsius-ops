/**
 * Ads spend autopilot — descend each Smart campaign's daily budget from its
 * current level toward the lowest spend that does NOT reduce till revenue.
 *
 * Owner directive 2026-07-16: no per-change human approval. The control loop
 * (weekly, inside ads-daily on Mondays) is:
 *
 *   1. GUARD  — per outlet, compare the last 14 full days of actual till
 *      revenue against the same-window forecast (per-weekday, recency-weighted,
 *      holiday-aware — the labour gate's forecaster, built from history that
 *      PRECEDES the window, so it is a clean counterfactual). The raw index is
 *      then divided by the median of the OTHER ads outlets' indexes so a
 *      fleet-wide shock (weather, festive dip) doesn't read as an ad effect.
 *   2. ROLLBACK — if the guard breaches after a recent cut, restore the
 *      previous budget (one step back up) and hold that campaign for 8 weeks.
 *      The descent found its floor.
 *   3. STEP DOWN — otherwise, if the last change is ≥14 days old, cut 8%
 *      (12% when the campaign's cost/conv is >1.3× fleet-best), never below
 *      the hard floor, at most MAX_CUTS_PER_RUN campaigns per run.
 *   4. EXCLUDE — auto-apply negative keyword themes for clearly-useless terms
 *      (own brand + non-café food intent; see term-rules.ts) so the remaining
 *      budget buys better clicks before the next step measures it.
 *
 * Kill switch: agent_registry key `ads_autopilot` (fail-safe off — a missing
 * row means the autopilot does nothing). shadow = full decision pass, logged,
 * zero mutations; armed = decisions applied to Google Ads. Every applied
 * change lands in the existing ads_budget_change / ads_term_exclusion ledgers
 * with decidedBy "ads-autopilot", so the /ads/optimizer page and undo paths
 * keep working unchanged.
 */

import { prisma } from "@/lib/prisma";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { buildWeekForecast, FORECAST_WEEKS } from "@/lib/hr/revenue-forecast";
import { dailyRevenueSeries } from "@/lib/hr/labour-gate";
import { getAgentMode, logAgentAction, touchAgentRun, type AgentMode } from "@/lib/agents/substrate";
import { buildAdsOptimizerReport, ENABLED_STATUSES } from "./optimizer";
import { applyBudgetChange } from "./set-budget";
import { applyTermExclusion } from "./exclude-term";
import { selectAutoExclusions, type ExclusionCandidate } from "./term-rules";
import { microsToMYR } from "./client";

export const AGENT_KEY = "ads_autopilot";

// ── Policy knobs ────────────────────────────────────────────────────────────
export const OBSERVE_DAYS = 14;          // min days between changes to one campaign
export const STEP_PCT = 0.08;            // normal step down
export const STEP_PCT_INEFFICIENT = 0.12; // when cost/conv > INEFFICIENT_RATIO × fleet-best
export const INEFFICIENT_RATIO = 1.3;
export const GUARD_RAW_MIN = 0.95;       // actual/forecast below this = breach
export const GUARD_ADJ_MIN = 0.97;       // fleet-adjusted index below this = breach
export const ROLLBACK_HOLD_DAYS = 56;    // after a rollback, hold 8 weeks
export const ROLLBACK_MAX_AGE_DAYS = 45; // only blame (and undo) a reasonably recent cut
export const MAX_CUTS_PER_RUN = 2;       // stagger: worst campaigns first, rest next Monday
export const FLOOR_DAILY_MYR = Number(process.env.ADS_AUTOPILOT_FLOOR_MYR || 20);

const DAY_MS = 86400000;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Pure guard math ─────────────────────────────────────────────────────────

export type GuardSignal = {
  rawIndex: number | null; // actual ÷ forecast over the observation window
  adjIndex: number | null; // rawIndex ÷ median(other outlets' rawIndex)
  breach: boolean;
};

export function guardFromIndexes(rawIndex: number | null, otherIndexes: number[]): GuardSignal {
  if (rawIndex == null || !Number.isFinite(rawIndex)) return { rawIndex: null, adjIndex: null, breach: false };
  const others = otherIndexes.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  let adjIndex: number | null = null;
  if (others.length) {
    const mid = Math.floor(others.length / 2);
    const median = others.length % 2 ? others[mid] : (others[mid - 1] + others[mid]) / 2;
    if (median > 0) adjIndex = rawIndex / median;
  }
  const breach = rawIndex < GUARD_RAW_MIN || (adjIndex != null && adjIndex < GUARD_ADJ_MIN);
  return { rawIndex: round2(rawIndex), adjIndex: adjIndex != null ? round2(adjIndex) : null, breach };
}

// ── Pure per-campaign decision ──────────────────────────────────────────────

export type LastAppliedChange = {
  decidedAt: Date;
  prevDailyMyr: number | null;
  newDailyMyr: number;
  reason: string | null;
};

export type CampaignState = {
  campaignId: string; // ads_campaign.id (our PK)
  campaignName: string;
  outletId: string | null;
  dailyBudgetMyr: number;
  efficiencyRatio: number | null; // cost/conv ÷ fleet-best (1 = best)
  lastApplied: LastAppliedChange | null;
};

export type AutopilotDecision = {
  campaignId: string;
  campaignName: string;
  action: "cut" | "rollback" | "hold";
  newDailyMyr?: number;
  reason: string;
};

const isAutopilotRollback = (c: LastAppliedChange | null) =>
  !!c?.reason?.startsWith("autopilot rollback");

export function decideCampaign(c: CampaignState, guard: GuardSignal, now: Date): AutopilotDecision {
  const base = { campaignId: c.campaignId, campaignName: c.campaignName };
  if (!c.outletId || guard.rawIndex == null) {
    return { ...base, action: "hold", reason: "no revenue guard for this campaign (missing outlet mapping or forecast) — never cut blind" };
  }

  const daysSince = c.lastApplied ? (now.getTime() - c.lastApplied.decidedAt.getTime()) / DAY_MS : Infinity;

  if (isAutopilotRollback(c.lastApplied) && daysSince < ROLLBACK_HOLD_DAYS) {
    return { ...base, action: "hold", reason: `post-rollback hold (${Math.ceil(ROLLBACK_HOLD_DAYS - daysSince)}d left)` };
  }

  const guardDetail = `till-revenue index ${guard.rawIndex}${guard.adjIndex != null ? ` (fleet-adj ${guard.adjIndex})` : ""} over last ${OBSERVE_DAYS}d`;

  if (guard.breach) {
    const la = c.lastApplied;
    const wasCut = la?.prevDailyMyr != null && la.prevDailyMyr > la.newDailyMyr;
    if (la && wasCut && !isAutopilotRollback(la) && daysSince <= ROLLBACK_MAX_AGE_DAYS) {
      return {
        ...base,
        action: "rollback",
        newDailyMyr: round2(la.prevDailyMyr!),
        reason: `autopilot rollback: ${guardDetail} — restoring RM${round2(la.prevDailyMyr!)}/day (was cut to RM${round2(la.newDailyMyr)} ${Math.round(daysSince)}d ago); descent floor found, holding ${ROLLBACK_HOLD_DAYS}d`,
      };
    }
    return { ...base, action: "hold", reason: `revenue below forecast (${guardDetail}) but no recent cut to blame — not cutting into weakness` };
  }

  if (daysSince < OBSERVE_DAYS) {
    return { ...base, action: "hold", reason: `observing last change (${Math.round(daysSince)}d/${OBSERVE_DAYS}d)` };
  }

  if (c.dailyBudgetMyr <= FLOOR_DAILY_MYR) {
    return { ...base, action: "hold", reason: `at floor (RM${FLOOR_DAILY_MYR}/day)` };
  }

  const inefficient = c.efficiencyRatio != null && c.efficiencyRatio > INEFFICIENT_RATIO;
  const step = inefficient ? STEP_PCT_INEFFICIENT : STEP_PCT;
  const newDaily = round2(Math.max(FLOOR_DAILY_MYR, c.dailyBudgetMyr * (1 - step)));
  return {
    ...base,
    action: "cut",
    newDailyMyr: newDaily,
    reason: `autopilot step-down ${Math.round(step * 100)}% (RM${round2(c.dailyBudgetMyr)}→RM${newDaily}/day): ${guardDetail} healthy${inefficient ? `, cost/conv ${c.efficiencyRatio}× fleet-best` : ""}`,
  };
}

/** Stagger the descent: keep at most `max` cuts, least-efficient campaigns first. */
export function capCuts(decisions: AutopilotDecision[], states: CampaignState[], max = MAX_CUTS_PER_RUN): AutopilotDecision[] {
  const eff = new Map(states.map((s) => [s.campaignId, s.efficiencyRatio ?? 1]));
  const cuts = decisions
    .filter((d) => d.action === "cut")
    .sort((a, b) => (eff.get(b.campaignId) ?? 1) - (eff.get(a.campaignId) ?? 1));
  const deferred = new Set(cuts.slice(max).map((d) => d.campaignId));
  return decisions.map((d) =>
    deferred.has(d.campaignId)
      ? { ...d, action: "hold" as const, newDailyMyr: undefined, reason: `cut ready but deferred (max ${max} cuts/run) — next Monday` }
      : d,
  );
}

// ── IO: build state, decide, act ────────────────────────────────────────────

const addDays = (ymd: string, days: number): string => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const mytToday = (now: Date): string => new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);

/** Actual ÷ forecast till-revenue index for one outlet over the trailing window. */
async function outletRevenueIndex(
  outlet: { id: string; loyaltyOutletId: string | null },
  now: Date,
): Promise<number | null> {
  const windowEnd = addDays(mytToday(now), -1); // last FULL day (MYT)
  const windowStart = addDays(windowEnd, -(OBSERVE_DAYS - 1));
  const histStart = addDays(windowStart, -FORECAST_WEEKS * 7);
  const histEnd = addDays(windowStart, -1);

  const series = await dailyRevenueSeries(outlet, histStart, windowEnd);
  const history: Array<{ date: string; revenue: number }> = [];
  for (let d = histStart; d <= histEnd; d = addDays(d, 1)) history.push({ date: d, revenue: series.get(d) ?? 0 });
  const windowDates: string[] = [];
  for (let d = windowStart; d <= windowEnd; d = addDays(d, 1)) windowDates.push(d);

  const { data: hols } = await hrSupabaseAdmin
    .from("hr_public_holidays")
    .select("date, name")
    .gte("date", histStart)
    .lte("date", windowEnd);
  const holidays = ((hols ?? []) as Array<{ date: string; name: string }>).map((h) => ({ date: h.date, name: h.name }));

  const fc = buildWeekForecast({ weekDates: windowDates, history, holidays });
  if (!(fc.weekly > 0)) return null;
  const actual = windowDates.reduce((s, d) => s + (series.get(d) ?? 0), 0);
  return actual / fc.weekly;
}

export type AutopilotRunResult = {
  mode: AgentMode;
  decisions: Array<AutopilotDecision & { applied?: boolean; error?: string }>;
  exclusions: Array<ExclusionCandidate & { applied?: boolean; error?: string }>;
  guards: Record<string, GuardSignal>;
};

export async function runAdsAutopilot(now = new Date()): Promise<AutopilotRunResult> {
  const mode = await getAgentMode(AGENT_KEY);
  if (mode === "off") return { mode, decisions: [], exclusions: [], guards: {} };
  await touchAgentRun(AGENT_KEY);

  const [campaigns, report, changes] = await Promise.all([
    prisma.adsCampaign.findMany({
      where: { status: { in: ENABLED_STATUSES }, account: { isManager: false } },
      select: { id: true, name: true, outletId: true, dailyBudgetMicros: true },
    }),
    buildAdsOptimizerReport(30),
    prisma.adsBudgetChange.findMany({
      where: { status: "applied" },
      orderBy: { decidedAt: "desc" },
      select: { campaignId: true, decidedAt: true, prevDailyMicros: true, newDailyMicros: true, reason: true },
    }),
  ]);
  const effByCampaign = new Map(report.campaigns.map((c) => [c.campaignId, c.efficiencyRatio]));
  const lastByCampaign = new Map<string, LastAppliedChange>();
  for (const ch of changes) {
    if (!lastByCampaign.has(ch.campaignId)) {
      lastByCampaign.set(ch.campaignId, {
        decidedAt: ch.decidedAt,
        prevDailyMyr: ch.prevDailyMicros != null ? microsToMYR(ch.prevDailyMicros) : null,
        newDailyMyr: microsToMYR(ch.newDailyMicros),
        reason: ch.reason,
      });
    }
  }

  // Revenue guard per distinct outlet behind a campaign.
  const outletIds = [...new Set(campaigns.map((c) => c.outletId).filter((x): x is string => !!x))];
  const outlets = await prisma.outlet.findMany({
    where: { id: { in: outletIds } },
    select: { id: true, loyaltyOutletId: true },
  });
  const rawIndexByOutlet = new Map<string, number | null>();
  for (const o of outlets) {
    rawIndexByOutlet.set(o.id, await outletRevenueIndex(o, now).catch(() => null));
  }
  const guards: Record<string, GuardSignal> = {};
  for (const [oid, raw] of rawIndexByOutlet) {
    const others = [...rawIndexByOutlet.entries()]
      .filter(([k, v]) => k !== oid && v != null)
      .map(([, v]) => v as number);
    guards[oid] = guardFromIndexes(raw, others);
  }
  const noGuard: GuardSignal = { rawIndex: null, adjIndex: null, breach: false };

  const states: CampaignState[] = campaigns.map((c) => ({
    campaignId: c.id,
    campaignName: c.name,
    outletId: c.outletId,
    dailyBudgetMyr: microsToMYR(c.dailyBudgetMicros ?? BigInt(0)),
    efficiencyRatio: effByCampaign.get(c.id) ?? null,
    lastApplied: lastByCampaign.get(c.id) ?? null,
  }));

  const decisions: AutopilotRunResult["decisions"] = capCuts(
    states.map((s) => decideCampaign(s, s.outletId ? guards[s.outletId] ?? noGuard : noGuard, now)),
    states,
  );

  // Auto-exclusions from the last 30 days of term spend.
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const [termRows, decided] = await Promise.all([
    prisma.adsSearchTermDaily.groupBy({
      by: ["campaignId", "searchTerm"],
      where: { date: { gte: since } },
      _sum: { costMicros: true },
    }),
    prisma.adsTermExclusion.findMany({ select: { campaignId: true, searchTerm: true } }),
  ]);
  const alreadyDecided = new Set(decided.map((e) => `${e.campaignId} ${e.searchTerm.toLowerCase()}`));
  const exclusions: AutopilotRunResult["exclusions"] = selectAutoExclusions(
    termRows.map((r) => ({
      campaignId: r.campaignId,
      searchTerm: r.searchTerm,
      costMyr: microsToMYR(r._sum.costMicros ?? BigInt(0)),
    })),
    alreadyDecided,
  );

  if (mode === "armed") {
    for (const d of decisions) {
      if (d.action === "hold" || d.newDailyMyr == null) continue;
      const res = await applyBudgetChange({
        campaignId: d.campaignId,
        newDailyMyr: d.newDailyMyr,
        decidedBy: "ads-autopilot",
        reason: d.reason,
      });
      Object.assign(d, res.ok ? { applied: true } : { applied: false, error: res.error });
    }
    for (const x of exclusions) {
      const res = await applyTermExclusion({
        campaignId: x.campaignId,
        searchTerm: x.searchTerm,
        decidedBy: "ads-autopilot",
        estMonthlySavingMyr: round2(x.costMyr),
        reason: `autopilot: ${x.intent} intent (RM${round2(x.costMyr)}/30d)`,
      });
      Object.assign(x, res.ok ? { applied: true } : { applied: false, error: res.error });
    }
  }

  const acted = decisions.filter((d) => d.action !== "hold");
  await logAgentAction({
    agentKey: AGENT_KEY,
    kind: mode === "armed" ? "budget_change" : "proposal",
    summary:
      `${mode}: ${acted.length ? acted.map((d) => `${d.campaignName} ${d.action}→RM${d.newDailyMyr}/day`).join("; ") : "all campaigns hold"}; ` +
      `${exclusions.length} term exclusion(s)`,
    refTable: "ads_budget_change",
    meta: { decisions, exclusions: exclusions.slice(0, 30), guards },
  });

  return { mode, decisions, exclusions, guards };
}
