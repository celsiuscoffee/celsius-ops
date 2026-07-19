/**
 * Ads spend autopilot — drive each Smart campaign's daily budget toward the
 * level that maximizes CASH: incremental till revenue × gross margin − spend.
 * The till (unified sales sources) is the only source of truth; Google's own
 * conversion counts are never trusted as an objective.
 *
 * Owner directive 2026-07-16: no per-change human approval; trim first, then
 * find the spend that actually increases cash. Descend from today's budgets
 * (100% → lowest), never from a pause upward. The burden of proof is
 * asymmetric in cash's favor: a CUT stands unless the till proves it hurt;
 * a RAISE reverts unless the till proves it helped.
 *
 * Per-campaign state machine (nightly, inside ads-daily; actions self-paced —
 * per-campaign observation windows + a fleet-wide FLEET_SPACING_DAYS stagger
 * for new disturbances, while safety actions fire the first night the till
 * says so), with all state derived from the ads_budget_change ledger — no new
 * tables:
 *
 *   DESCEND   — waste-matched first: while the campaign carries excluded-term
 *               spend not yet taken out of the budget, each cut removes
 *               exactly that measured amount (café-intent funding untouched);
 *               only once no unpaid waste remains does the blind 8% step
 *               (12% when cost/conv >1.3× fleet-best) resume. Every ≥14
 *               observed days, max MAX_CUTS_PER_RUN campaigns per run, never
 *               below the floor.
 *   ROLLBACK  — if the guard breaches after a recent cut, restore the previous
 *               budget and hold ROLLBACK_HOLD_DAYS. The breach is evidence the
 *               marginal spend WAS generating till revenue.
 *   PROBE UP  — after that hold, the campaign has proven response, so test the
 *               other direction: raise PROBE_UP_PCT above the restored level
 *               (capped at RAISE_CAP_OF_BASELINE × the pre-descent baseline)
 *               and observe PROBE_OBSERVE_DAYS.
 *   EVALUATE  — keep the raise only on detectable till lift (fleet-adjusted
 *               index ≥ RAISE_KEEP_ADJ_MIN and raw ≥ 1); then it may probe up
 *               again. No lift → revert to the pre-raise level and SETTLE.
 *   SETTLE    — cutting below hurt, raising above bought nothing: that budget
 *               is the cash optimum. Hold SETTLE_HOLD_DAYS, then re-enter
 *               DESCEND (demand shifts; the optimum is re-searched slowly).
 *
 *   PAUSE PROBE — the descent's step sizes (8–15% of a ~RM100/day budget) move
 *               the till by well under 1% — individually unreadable at
 *               ~RM2.5-3k/day outlets. The only experiment the till can read
 *               is a FULL pause (~5-6% expected effect if the spend is merely
 *               break-even). Owner-approved 2026-07-16: the autopilot pauses
 *               ONE clearly-inefficient campaign (cost/conv >1.3× fleet-best,
 *               never probed before, one at a time fleet-wide) for
 *               PAUSE_PROBE_DAYS, the others keep running as controls, then
 *               auto-restores with a verdict: till dropped → ads generate
 *               cash, resume at the prior budget and let the descent find the
 *               floor; no detectable drop → the campaign is below break-even
 *               wholesale, restore at the hard floor and redeploy the cash.
 *   GUARD     — per outlet: last 14 full days of actual till revenue ÷ the
 *               same-window forecast (per-weekday, recency-weighted,
 *               holiday-aware — the labour gate's forecaster, built from
 *               history PRECEDING the window, so it is a clean
 *               counterfactual), then divided by the median of the OTHER ads
 *               outlets' indexes so a fleet-wide shock (weather, festive dip)
 *               doesn't read as an ad effect. Additionally ANCHORED against
 *               the outlet's share of fleet revenue in the 28 days before the
 *               descent began — the trailing forecast alone normalizes slow
 *               cumulative damage (boiling frog); the fixed anchor makes
 *               drift detectable even when no single step is. No guard
 *               signal → never act.
 *   EXCLUDE   — auto-apply negative keyword themes for clearly-useless terms
 *               (own brand + non-café food intent; see term-rules.ts) so the
 *               remaining budget buys better clicks before the next step
 *               measures it.
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
import { pauseCampaign, enableCampaign } from "./pause-campaign";
import { applyTermExclusion } from "./exclude-term";
import { selectAutoExclusions, selectSeedExclusions, type ExclusionCandidate } from "./term-rules";
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
// Plausibility bound (owner-approved 2026-07-18, after the Tamarind false
// positive): only blame the descent for a revenue gap it could plausibly have
// caused. The cumulative cut's break-even till effect is (cut ÷ margin);
// beyond FACTOR× that, the gap has another cause — hold and flag instead of
// rolling back. The fixed anchor still guards genuine cumulative drift.
export const ROLLBACK_PLAUSIBILITY_FACTOR = 2;
export const MAX_CUTS_PER_RUN = 2;       // stagger: worst campaigns first, rest next Monday
export const FLOOR_DAILY_MYR = Number(process.env.ADS_AUTOPILOT_FLOOR_MYR || 20);

// Probe-up phase (the "increase cash" search — only ever entered after a
// rollback PROVED the outlet's till responds to this campaign's spend):
export const PROBE_UP_PCT = 0.15;        // raise size; big enough to have a chance of showing at the till
export const PROBE_OBSERVE_DAYS = 28;    // raises get twice the observation of cuts
export const RAISE_KEEP_ADJ_MIN = 1.02;  // keep a raise only on detectable fleet-adjusted lift…
export const RAISE_KEEP_RAW_MIN = 1.0;   // …with raw actual ≥ forecast too
export const RAISE_CAP_OF_BASELINE = 1.25; // never exceed 1.25× the highest budget ever ledgered
export const SETTLE_HOLD_DAYS = 90;      // proven optimum: re-search only quarterly
// Gross margin used to state each move's break-even in the reason strings.
export const GROSS_MARGIN = Number(process.env.ADS_GROSS_MARGIN || 0.6);

// Waste-matched cuts (owner 2026-07-16: "remove the keywords that are not
// worth, and reduce the budget based on the keywords removed... this way we
// reduce the risk of reducing budget for keywords that potentially increase
// sales"). When a campaign carries excluded-term spend not yet reflected in
// its budget, the next cut removes exactly that measured amount instead of a
// blind percentage — café-intent funding stays untouched. Blind percentage
// descent only resumes once no unpaid waste remains.
export const WASTE_MATCH_MIN_DAILY_MYR = 0.5; // below this, not worth a budget mutation
export const WASTE_MATCH_MAX_PCT = 0.2;       // never remove more than 20% of the budget in one matched cut
// Smart campaigns cap negative keyword themes (~25/campaign). Treat the slots
// as a scarce budget: highest measured-cost junk gets them first, seeds only
// fill what's left, and we stop before the API starts rejecting.
export const MAX_NEGATIVES_PER_CAMPAIGN = 25;

// Pause probe — the only till-readable experiment at this spend:revenue ratio.
// SHELVED by owner 2026-07-19 ("let tamarind follow the others") after the
// probe was starved two nights running — all outlets stay on the gradual
// descent. The machinery is kept and can be re-enabled with
// ADS_AUTOPILOT_PAUSE_PROBE=on if a causal baseline is wanted later.
export const PAUSE_PROBE_ENABLED = process.env.ADS_AUTOPILOT_PAUSE_PROBE === "on";
export const PAUSE_PROBE_DAYS = 28;      // full pause length before auto-restore
// The cron runs nightly; this fleet-wide gap staggers NEW disturbances
// (cut/raise/pause) so the loop keeps its ~weekly rhythm without waiting for
// a fixed weekday. Safety actions (rollback/revert/restore) are never spaced.
export const FLEET_SPACING_DAYS = 6;
// Fixed-anchor drift guard: current share of fleet revenue ÷ the share in the
// 28 days before the first ledgered budget change. Slightly looser than the
// per-step thresholds because shares are noisier than forecasts.
export const ANCHOR_WINDOW_DAYS = 28;
export const ANCHOR_MIN = 0.93;

const DAY_MS = 86400000;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Pure guard math ─────────────────────────────────────────────────────────

export type GuardSignal = {
  rawIndex: number | null;    // actual ÷ forecast over the observation window
  adjIndex: number | null;    // rawIndex ÷ median(other outlets' rawIndex)
  anchorIndex: number | null; // current share of fleet revenue ÷ pre-descent share (cumulative-drift detector)
  forecastDailyMyr: number | null; // outlet's forecast till revenue per day (converts % gaps to ringgit)
  breach: boolean;
};

export function guardFromIndexes(
  rawIndex: number | null,
  otherIndexes: number[],
  anchorIndex: number | null = null,
  forecastDailyMyr: number | null = null,
): GuardSignal {
  if (rawIndex == null || !Number.isFinite(rawIndex)) {
    return { rawIndex: null, adjIndex: null, anchorIndex: null, forecastDailyMyr: null, breach: false };
  }
  const others = otherIndexes.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  let adjIndex: number | null = null;
  if (others.length) {
    const mid = Math.floor(others.length / 2);
    const median = others.length % 2 ? others[mid] : (others[mid - 1] + others[mid]) / 2;
    if (median > 0) adjIndex = rawIndex / median;
  }
  const anchor = anchorIndex != null && Number.isFinite(anchorIndex) ? round2(anchorIndex) : null;
  const breach =
    rawIndex < GUARD_RAW_MIN ||
    (adjIndex != null && adjIndex < GUARD_ADJ_MIN) ||
    (anchor != null && anchor < ANCHOR_MIN);
  return {
    rawIndex: round2(rawIndex),
    adjIndex: adjIndex != null ? round2(adjIndex) : null,
    anchorIndex: anchor,
    forecastDailyMyr: forecastDailyMyr != null && Number.isFinite(forecastDailyMyr) ? round2(forecastDailyMyr) : null,
    breach,
  };
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
  baselineDailyMyr: number; // highest budget ever ledgered (pre-descent level) — the raise cap anchor
  efficiencyRatio: number | null; // cost/conv ÷ fleet-best (1 = best)
  lastApplied: LastAppliedChange | null;
  isPaused: boolean;
  hasBeenPauseProbed: boolean; // any 'autopilot pause' row ever — each campaign is probed at most once
  // Daily spend of terms excluded AFTER this campaign's last budget change —
  // waste already removed from matching but not yet from the budget. Sized
  // from the exclusion ledger's measured est_monthly_saving_myr.
  pendingWasteDailyMyr: number;
  // Till index over the pause window so far (forecast built from PRE-pause
  // history) — only set while a probe is running; drives the restore verdict.
  pauseProbe?: { index: number | null; adjIndex: number | null };
};

export type AutopilotDecision = {
  campaignId: string;
  campaignName: string;
  action: "cut" | "rollback" | "raise" | "revert" | "pause" | "restore" | "hold";
  newDailyMyr?: number;
  reason: string;
};

// The ledger reason's prefix IS the state machine's memory — no new tables.
type LastKind = "step-down" | "rollback" | "raise" | "revert" | "pause" | "restore" | "other" | null;
function lastKind(c: LastAppliedChange | null): LastKind {
  if (!c) return null;
  const r = c.reason ?? "";
  if (r.startsWith("autopilot rollback")) return "rollback";
  if (r.startsWith("autopilot raise")) return "raise";
  if (r.startsWith("autopilot revert")) return "revert";
  if (r.startsWith("autopilot step-down")) return "step-down";
  if (r.startsWith("autopilot pause")) return "pause";
  if (r.startsWith("autopilot restore")) return "restore";
  return "other"; // human/manual change — observe it like a step, never auto-revert it
}

// Monthly cash framing for reason strings: a cut banks its delta; a raise must
// earn delta ÷ margin at the till to pay for itself.
const monthly = (deltaDaily: number) => round2(Math.abs(deltaDaily) * 30);

export function decideCampaign(c: CampaignState, guard: GuardSignal, now: Date): AutopilotDecision {
  const base = { campaignId: c.campaignId, campaignName: c.campaignName };
  if (!c.outletId || guard.rawIndex == null) {
    return { ...base, action: "hold", reason: "no revenue guard for this campaign (missing outlet mapping or forecast) — never act blind" };
  }

  const la = c.lastApplied;
  const kind = lastKind(la);
  const daysSince = la ? (now.getTime() - la.decidedAt.getTime()) / DAY_MS : Infinity;
  const guardDetail = `till-revenue index ${guard.rawIndex}${guard.adjIndex != null ? ` (fleet-adj ${guard.adjIndex})` : ""}${guard.anchorIndex != null ? `, anchor ${guard.anchorIndex}` : ""} over last ${OBSERVE_DAYS}d`;

  // ── Paused campaign: either our probe (restore on schedule) or human's ───
  if (c.isPaused) {
    if (kind !== "pause") {
      return { ...base, action: "hold", reason: "campaign is paused but not by the autopilot — leaving it alone" };
    }
    if (daysSince < PAUSE_PROBE_DAYS) {
      return { ...base, action: "hold", reason: `pause probe running (${Math.round(daysSince)}d/${PAUSE_PROBE_DAYS}d, pause-window till index ${c.pauseProbe?.index ?? "n/a"})` };
    }
    const p = c.pauseProbe;
    const dropDetected =
      p?.index != null && (p.index < GUARD_RAW_MIN || (p.adjIndex != null && p.adjIndex < GUARD_ADJ_MIN));
    if (dropDetected) {
      return {
        ...base,
        action: "restore",
        newDailyMyr: round2(c.dailyBudgetMyr),
        reason: `autopilot restore: pause probe VERDICT — ads generate cash (pause-window till index ${p!.index}${p!.adjIndex != null ? `, fleet-adj ${p!.adjIndex}` : ""}); resuming at RM${round2(c.dailyBudgetMyr)}/day, gradual descent will find the floor`,
      };
    }
    return {
      ...base,
      action: "restore",
      newDailyMyr: FLOOR_DAILY_MYR,
      reason: `autopilot restore: pause probe VERDICT — no detectable till effect (pause-window index ${p?.index ?? "n/a"}${p?.adjIndex != null ? `, fleet-adj ${p.adjIndex}` : ""}); campaign is below break-even wholesale — restoring at the floor RM${FLOOR_DAILY_MYR}/day (~RM${monthly(c.dailyBudgetMyr - FLOOR_DAILY_MYR)}/mo freed)`,
    };
  }

  // ── Raise under evaluation: burden of proof is on the spend ──────────────
  if (kind === "raise") {
    if (guard.breach || (daysSince >= PROBE_OBSERVE_DAYS &&
        !((guard.adjIndex ?? guard.rawIndex) >= RAISE_KEEP_ADJ_MIN && guard.rawIndex >= RAISE_KEEP_RAW_MIN))) {
      const back = round2(la!.prevDailyMyr ?? c.dailyBudgetMyr);
      return {
        ...base,
        action: "revert",
        newDailyMyr: back,
        reason: `autopilot revert: raise to RM${round2(la!.newDailyMyr)}/day showed no till lift (${guardDetail}) — back to RM${back}/day; this level is the cash optimum, settling ${SETTLE_HOLD_DAYS}d`,
      };
    }
    if (daysSince < PROBE_OBSERVE_DAYS) {
      return { ...base, action: "hold", reason: `observing raise (${Math.round(daysSince)}d/${PROBE_OBSERVE_DAYS}d, ${guardDetail})` };
    }
    // Lift proven — keep the raise and probe one step further (cap permitting).
    return probeUp(c, guard, `raise to RM${round2(la!.newDailyMyr)}/day PAID: ${guardDetail}`);
  }

  // ── Settled at a proven optimum: re-search only slowly ───────────────────
  if (kind === "revert" && daysSince < SETTLE_HOLD_DAYS) {
    return { ...base, action: "hold", reason: `settled at cash optimum RM${round2(c.dailyBudgetMyr)}/day (${Math.ceil(SETTLE_HOLD_DAYS - daysSince)}d before re-search)` };
  }

  // ── Post-rollback: hold, then search UPWARD (response is proven) ─────────
  if (kind === "rollback") {
    if (daysSince < ROLLBACK_HOLD_DAYS) {
      return { ...base, action: "hold", reason: `post-rollback hold (${Math.ceil(ROLLBACK_HOLD_DAYS - daysSince)}d left)` };
    }
    if (guard.breach) {
      return { ...base, action: "hold", reason: `revenue still below forecast (${guardDetail}) — not raising into weakness` };
    }
    return probeUp(c, guard, `descent floor proved this campaign moves the till`);
  }

  // ── Descent (default): cuts stand unless the till proves they hurt ───────
  if (guard.breach) {
    const wasCut = la?.prevDailyMyr != null && la.prevDailyMyr > la.newDailyMyr;
    if (la && wasCut && daysSince <= ROLLBACK_MAX_AGE_DAYS) {
      // Plausibility bound: could the descent even have caused a gap this
      // big? Cumulative depth ÷ margin is the most revenue the cut spend
      // could have been generating; a gap far beyond it has another cause.
      const worstIndex = Math.min(guard.rawIndex, guard.adjIndex ?? guard.rawIndex, guard.anchorIndex ?? guard.rawIndex);
      const gapDaily = guard.forecastDailyMyr != null ? (1 - worstIndex) * guard.forecastDailyMyr : null;
      const cumulativeCutDaily = Math.max(0, c.baselineDailyMyr - c.dailyBudgetMyr);
      const plausibleDaily = (cumulativeCutDaily / GROSS_MARGIN) * ROLLBACK_PLAUSIBILITY_FACTOR;
      if (gapDaily != null && cumulativeCutDaily > 0 && gapDaily > plausibleDaily) {
        return {
          ...base,
          action: "hold",
          reason: `guard breach (${guardDetail}) but the ~RM${round2(gapDaily)}/day shortfall is far beyond what the RM${round2(cumulativeCutDaily)}/day descent could cause (≤RM${round2(plausibleDaily)}/day at ${Math.round(GROSS_MARGIN * 100)}% margin) — not blaming the cut; holding and flagging for another cause`,
        };
      }
      return {
        ...base,
        action: "rollback",
        newDailyMyr: round2(la.prevDailyMyr!),
        reason: `autopilot rollback: ${guardDetail} — restoring RM${round2(la.prevDailyMyr!)}/day (was cut to RM${round2(la.newDailyMyr)} ${Math.round(daysSince)}d ago); descent floor found, holding ${ROLLBACK_HOLD_DAYS}d`,
      };
    }
    return { ...base, action: "hold", reason: `revenue below forecast (${guardDetail}) but no recent cut to blame — not cutting into weakness` };
  }

  // Waste-matched cut: remove exactly the spend of terms already excluded but
  // not yet taken out of the budget. Zero-risk to café-intent keywords by
  // construction, so it is NOT an experiment — it skips the observation
  // window (owner 2026-07-17: "why can't we cut it now rather than wait?")
  // and pairs with the exclusions the same night. The guard above still
  // blocks it when the till is weak, and rollback still covers it.
  if (c.pendingWasteDailyMyr >= WASTE_MATCH_MIN_DAILY_MYR && c.dailyBudgetMyr > FLOOR_DAILY_MYR) {
    const amount = Math.min(c.pendingWasteDailyMyr, c.dailyBudgetMyr * WASTE_MATCH_MAX_PCT);
    const newDaily = round2(Math.max(FLOOR_DAILY_MYR, c.dailyBudgetMyr - amount));
    if (newDaily < c.dailyBudgetMyr) {
      return {
        ...base,
        action: "cut",
        newDailyMyr: newDaily,
        reason: `autopilot step-down (waste-matched): RM${round2(c.pendingWasteDailyMyr)}/day of excluded junk-term spend removed from the budget (RM${round2(c.dailyBudgetMyr)}→RM${newDaily}/day, banks ~RM${monthly(c.dailyBudgetMyr - newDaily)}/mo) — café-intent funding untouched; ${guardDetail} healthy`,
      };
    }
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
    reason: `autopilot step-down ${Math.round(step * 100)}% (RM${round2(c.dailyBudgetMyr)}→RM${newDaily}/day, banks ~RM${monthly(c.dailyBudgetMyr - newDaily)}/mo): ${guardDetail} healthy${inefficient ? `, cost/conv ${c.efficiencyRatio}× fleet-best` : ""}`,
  };
}

function probeUp(c: CampaignState, guard: GuardSignal, why: string): AutopilotDecision {
  const base = { campaignId: c.campaignId, campaignName: c.campaignName };
  const cap = round2(c.baselineDailyMyr * RAISE_CAP_OF_BASELINE);
  const target = round2(Math.min(cap, c.dailyBudgetMyr * (1 + PROBE_UP_PCT)));
  if (target <= c.dailyBudgetMyr) {
    return { ...base, action: "hold", reason: `at raise cap (RM${cap}/day = ${RAISE_CAP_OF_BASELINE}× baseline) — holding proven level RM${round2(c.dailyBudgetMyr)}/day` };
  }
  const extraMonthly = monthly(target - c.dailyBudgetMyr);
  const breakEven = round2(extraMonthly / GROSS_MARGIN);
  return {
    ...base,
    action: "raise",
    newDailyMyr: target,
    reason: `autopilot raise: ${why} — probing RM${round2(c.dailyBudgetMyr)}→RM${target}/day (+RM${extraMonthly}/mo spend; needs ≥RM${breakEven}/mo till lift to pay at ${Math.round(GROSS_MARGIN * 100)}% margin; reverts after ${PROBE_OBSERVE_DAYS}d without evidence)`,
  };
}

// Parenthesized step-downs — "(waste-matched)" and "(owner directive …)" —
// are paired bookkeeping / explicit human calls, not experiments: exempt from
// the cut cap and the fleet stagger, and they don't reset the spacing clock.
// Blind steps ("autopilot step-down 8% …") carry no parenthesis.
const isWasteMatched = (d: AutopilotDecision) => d.reason.startsWith("autopilot step-down (");

/**
 * One-time owner directives. 2026-07-19: "let tamarind follow the others.
 * start with the prev cut (rm80+)" — the Jul 17 rollback was a proven false
 * positive, so Tamarind resumes the fleet's gradual descent at its
 * pre-rollback level. Self-expiring: fires only while the campaign's last
 * applied change is still that rollback; once this step-down lands it can
 * never fire again.
 */
export function ownerDirective(c: CampaignState): AutopilotDecision | null {
  if (
    c.campaignName.includes("Tamarind") &&
    !c.isPaused &&
    lastKind(c.lastApplied) === "rollback" &&
    c.dailyBudgetMyr > 85
  ) {
    return {
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      action: "cut",
      newDailyMyr: 84.96,
      reason:
        "autopilot step-down (owner directive 2026-07-19): the Jul 17 rollback was a false positive (till flat in absolute RM) — resume the gradual descent at the prior cut level RM84.96/day",
    };
  }
  return null;
}

/** Stagger the descent: keep at most `max` BLIND cuts, least-efficient campaigns first. */
export function capCuts(decisions: AutopilotDecision[], states: CampaignState[], max = MAX_CUTS_PER_RUN): AutopilotDecision[] {
  const eff = new Map(states.map((s) => [s.campaignId, s.efficiencyRatio ?? 1]));
  const cuts = decisions
    .filter((d) => d.action === "cut" && !isWasteMatched(d))
    .sort((a, b) => (eff.get(b.campaignId) ?? 1) - (eff.get(a.campaignId) ?? 1));
  const deferred = new Set(cuts.slice(max).map((d) => d.campaignId));
  return decisions.map((d) =>
    deferred.has(d.campaignId)
      ? { ...d, action: "hold" as const, newDailyMyr: undefined, reason: `cut ready but deferred (max ${max} cuts/run) — next run` }
      : d,
  );
}

/**
 * Pure: nightly-cadence stagger. If any autopilot disturbance (step-down,
 * raise, pause) was applied fleet-wide within FLEET_SPACING_DAYS, defer new
 * disturbances to keep the loop's ~weekly rhythm; same-run batches (all
 * decided before any is applied) pass together. Safety actions and holds are
 * untouched — a rollback must never wait for spacing.
 */
export function spaceDisturbances(
  decisions: AutopilotDecision[],
  lastDisturbanceAt: Date | null,
  now: Date,
): AutopilotDecision[] {
  if (!lastDisturbanceAt) return decisions;
  const days = (now.getTime() - lastDisturbanceAt.getTime()) / DAY_MS;
  if (days >= FLEET_SPACING_DAYS) return decisions;
  // Pauses are not spaced: the probe is measured per-outlet against its own
  // pre-pause forecast, the controls' small cuts move their tills <1%, and
  // the owner ordered the baseline — only blind cuts and raises stagger.
  return decisions.map((d) =>
    (d.action === "cut" && !isWasteMatched(d)) || d.action === "raise"
      ? {
          campaignId: d.campaignId,
          campaignName: d.campaignName,
          action: "hold" as const,
          reason: `ready to ${d.action} but fleet changed ${Math.round(days)}d ago — spacing ${FLEET_SPACING_DAYS}d between disturbances`,
        }
      : d,
  );
}

/**
 * Pure: start a pause probe when warranted — ONE campaign fleet-wide at a
 * time, only a clearly-inefficient one (cost/conv > INEFFICIENT_RATIO ×
 * fleet-best), never re-probed, never started into an ABSOLUTELY weak till
 * (own raw index < GUARD_RAW_MIN). A merely RELATIVE breach (fleet-adjusted
 * or anchor, with the outlet's own till at forecast) does NOT block the
 * probe — owner 2026-07-18 ("for tamarind, let's just switch it off so we
 * can have a baseline") after the fleet-adj gate wrongly deferred the probe
 * at a flat-revenue outlet whose sibling was simply running hot. The chosen
 * campaign's decision is replaced with a pause; every other campaign keeps
 * its decision (the gradual descent elsewhere doubles as the probe's
 * control group).
 */
export function selectPauseProbe(
  decisions: AutopilotDecision[],
  states: CampaignState[],
  guards: Record<string, GuardSignal>,
): AutopilotDecision[] {
  // One PROBE at a time — but only a probe (autopilot-paused) blocks the next
  // one. A campaign a human paused long ago (e.g. Nilai) is not a running
  // experiment and must never starve the queue.
  if (states.some((s) => s.isPaused && lastKind(s.lastApplied) === "pause")) return decisions;
  const candidates = states
    .filter((s) => !s.hasBeenPauseProbed)
    .filter((s) => s.efficiencyRatio != null && s.efficiencyRatio > INEFFICIENT_RATIO)
    .filter((s) => {
      const g = s.outletId ? guards[s.outletId] : undefined;
      return !!g && g.rawIndex != null && g.rawIndex >= GUARD_RAW_MIN;
    })
    .sort((a, b) => (b.efficiencyRatio ?? 0) - (a.efficiencyRatio ?? 0));
  const target = candidates[0];
  if (!target) return decisions;
  return decisions.map((d) =>
    d.campaignId === target.campaignId
      ? {
          campaignId: d.campaignId,
          campaignName: d.campaignName,
          action: "pause" as const,
          reason: `autopilot pause: probe start — cost/conv ${target.efficiencyRatio}× fleet-best; RM${round2(target.dailyBudgetMyr)}/day off for ${PAUSE_PROBE_DAYS}d (till should drop ~5-6% if this spend is break-even, more if profitable); other outlets keep descending as controls; auto-restores with a verdict`,
        }
      : d,
  );
}

// ── IO: build state, decide, act ────────────────────────────────────────────

const addDays = (ymd: string, days: number): string => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const mytDate = (d: Date): string => new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10);

/**
 * Actual till revenue + counterfactual forecast for one outlet over an
 * arbitrary window. The forecast is built ONLY from history preceding the
 * window, so mid-window budget changes cannot contaminate their own baseline.
 */
async function windowActualForecast(
  outlet: { id: string; loyaltyOutletId: string | null },
  startYmd: string,
  endYmd: string,
): Promise<{ actual: number; forecast: number }> {
  const histStart = addDays(startYmd, -FORECAST_WEEKS * 7);
  const histEnd = addDays(startYmd, -1);

  const series = await dailyRevenueSeries(outlet, histStart, endYmd);
  const history: Array<{ date: string; revenue: number }> = [];
  for (let d = histStart; d <= histEnd; d = addDays(d, 1)) history.push({ date: d, revenue: series.get(d) ?? 0 });
  const windowDates: string[] = [];
  for (let d = startYmd; d <= endYmd; d = addDays(d, 1)) windowDates.push(d);

  const { data: hols } = await hrSupabaseAdmin
    .from("hr_public_holidays")
    .select("date, name")
    .gte("date", histStart)
    .lte("date", endYmd);
  const holidays = ((hols ?? []) as Array<{ date: string; name: string }>).map((h) => ({ date: h.date, name: h.name }));

  const fc = buildWeekForecast({ weekDates: windowDates, history, holidays });
  const actual = windowDates.reduce((s, d) => s + (series.get(d) ?? 0), 0);
  return { actual, forecast: fc.weekly };
}

/** Plain actual till revenue over a window (for the anchor's share-of-fleet math). */
async function windowActual(
  outlet: { id: string; loyaltyOutletId: string | null },
  startYmd: string,
  endYmd: string,
): Promise<number> {
  const series = await dailyRevenueSeries(outlet, startYmd, endYmd);
  let sum = 0;
  for (const v of series.values()) sum += v;
  return sum;
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
      // Paused campaigns stay in scope — a running pause probe must be seen so
      // it can be restored on schedule.
      where: { status: { in: [...ENABLED_STATUSES, "3", "PAUSED"] }, account: { isManager: false } },
      select: { id: true, name: true, outletId: true, dailyBudgetMicros: true, status: true },
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
  const maxLevelByCampaign = new Map<string, number>(); // highest budget ever ledgered
  const pauseProbedCampaigns = new Set<string>();       // any 'autopilot pause' row ever
  let firstChangeAt: Date | null = null;                // descent start — the anchor's fixed reference
  let lastDisturbanceAt: Date | null = null;            // newest autopilot cut/raise/pause (fleet spacing)
  for (const ch of changes) {
    if (!lastByCampaign.has(ch.campaignId)) {
      lastByCampaign.set(ch.campaignId, {
        decidedAt: ch.decidedAt,
        prevDailyMyr: ch.prevDailyMicros != null ? microsToMYR(ch.prevDailyMicros) : null,
        newDailyMyr: microsToMYR(ch.newDailyMicros),
        reason: ch.reason,
      });
    }
    const seen = Math.max(
      ch.prevDailyMicros != null ? microsToMYR(ch.prevDailyMicros) : 0,
      microsToMYR(ch.newDailyMicros),
    );
    maxLevelByCampaign.set(ch.campaignId, Math.max(maxLevelByCampaign.get(ch.campaignId) ?? 0, seen));
    if (ch.reason?.startsWith("autopilot pause")) pauseProbedCampaigns.add(ch.campaignId);
    if (!firstChangeAt || ch.decidedAt < firstChangeAt) firstChangeAt = ch.decidedAt;
    // Spacing-exempt actions (parenthesized step-downs: waste-matched, owner
    // directives) must not reset the spacing clock either — nightly waste
    // sweeps would otherwise starve blind cuts and raises forever.
    if (
      ((ch.reason?.startsWith("autopilot step-down") &&
        !ch.reason.startsWith("autopilot step-down (")) ||
        ch.reason?.startsWith("autopilot raise") ||
        ch.reason?.startsWith("autopilot pause")) &&
      (!lastDisturbanceAt || ch.decidedAt > lastDisturbanceAt)
    ) {
      lastDisturbanceAt = ch.decidedAt;
    }
  }

  // Revenue guard per distinct outlet behind a campaign.
  const outletIds = [...new Set(campaigns.map((c) => c.outletId).filter((x): x is string => !!x))];
  const outlets = await prisma.outlet.findMany({
    where: { id: { in: outletIds } },
    select: { id: true, loyaltyOutletId: true },
  });
  const yesterday = addDays(mytDate(now), -1); // last FULL day (MYT)
  const guardStart = addDays(yesterday, -(OBSERVE_DAYS - 1));

  const rawIndexByOutlet = new Map<string, number | null>();
  const actualNowByOutlet = new Map<string, number>();
  const forecastDailyByOutlet = new Map<string, number | null>();
  for (const o of outlets) {
    const w = await windowActualForecast(o, guardStart, yesterday).catch(() => null);
    rawIndexByOutlet.set(o.id, w && w.forecast > 0 ? w.actual / w.forecast : null);
    actualNowByOutlet.set(o.id, w?.actual ?? 0);
    forecastDailyByOutlet.set(o.id, w && w.forecast > 0 ? w.forecast / OBSERVE_DAYS : null);
  }

  // Fixed-anchor drift check: this outlet's share of fleet revenue now vs the
  // 28 days before the first ledgered budget change (pre-descent). Catches
  // slow cumulative damage the trailing forecast normalizes away.
  const anchorIndexByOutlet = new Map<string, number | null>();
  if (firstChangeAt && outlets.length > 1) {
    const aEnd = addDays(mytDate(firstChangeAt), -1);
    const aStart = addDays(aEnd, -(ANCHOR_WINDOW_DAYS - 1));
    const anchorActual = new Map<string, number>();
    for (const o of outlets) {
      anchorActual.set(o.id, await windowActual(o, aStart, aEnd).catch(() => 0));
    }
    const anchorTotal = [...anchorActual.values()].reduce((s, v) => s + v, 0);
    const nowTotal = [...actualNowByOutlet.values()].reduce((s, v) => s + v, 0);
    for (const o of outlets) {
      const aShare = anchorTotal > 0 ? (anchorActual.get(o.id) ?? 0) / anchorTotal : 0;
      const nShare = nowTotal > 0 ? (actualNowByOutlet.get(o.id) ?? 0) / nowTotal : 0;
      anchorIndexByOutlet.set(o.id, aShare > 0 ? nShare / aShare : null);
    }
  }

  const guards: Record<string, GuardSignal> = {};
  for (const [oid, raw] of rawIndexByOutlet) {
    const others = [...rawIndexByOutlet.entries()]
      .filter(([k, v]) => k !== oid && v != null)
      .map(([, v]) => v as number);
    guards[oid] = guardFromIndexes(raw, others, anchorIndexByOutlet.get(oid) ?? null, forecastDailyByOutlet.get(oid) ?? null);
  }
  const noGuard: GuardSignal = { rawIndex: null, adjIndex: null, anchorIndex: null, forecastDailyMyr: null, breach: false };

  // Waste applied to matching but not yet to the budget: sum the measured
  // spend of exclusions applied AFTER each campaign's last budget change.
  const appliedExclusions = await prisma.adsTermExclusion.findMany({
    where: { status: "applied", appliedAt: { not: null } },
    select: { campaignId: true, appliedAt: true, estMonthlySavingMyr: true },
  });
  const pendingWasteByCampaign = new Map<string, number>();
  for (const x of appliedExclusions) {
    const lastChange = lastByCampaign.get(x.campaignId)?.decidedAt;
    if (lastChange && x.appliedAt! <= lastChange) continue; // already paid for by a cut
    const daily = Number(x.estMonthlySavingMyr ?? 0) / 30;
    pendingWasteByCampaign.set(x.campaignId, (pendingWasteByCampaign.get(x.campaignId) ?? 0) + daily);
  }

  // Exclusions run BEFORE budget decisions so tonight's exclusions and the
  // matching budget cut land in the SAME run (exclude → cut, paired). In
  // armed mode only successfully-applied exclusions count toward the cut.
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const [termRows, decided] = await Promise.all([
    prisma.adsSearchTermDaily.groupBy({
      by: ["campaignId", "searchTerm"],
      where: { date: { gte: since } },
      _sum: { costMicros: true },
    }),
    prisma.adsTermExclusion.findMany({ select: { campaignId: true, searchTerm: true, status: true } }),
  ]);
  // 'failed' rows are retryable (a transient API error must not permanently
  // burn a term); applied + human-rejected rows are standing decisions.
  const alreadyDecided = new Set(
    decided.filter((e) => e.status !== "failed").map((e) => `${e.campaignId} ${e.searchTerm.toLowerCase()}`),
  );
  // Negative-theme slots left per campaign (Smart campaign cap).
  const slotsLeft = new Map<string, number>();
  for (const c of campaigns) slotsLeft.set(c.id, MAX_NEGATIVES_PER_CAMPAIGN);
  for (const e of decided) {
    if (e.status === "applied") slotsLeft.set(e.campaignId, (slotsLeft.get(e.campaignId) ?? MAX_NEGATIVES_PER_CAMPAIGN) - 1);
  }
  const exclusions: AutopilotRunResult["exclusions"] = selectAutoExclusions(
    termRows.map((r) => ({
      campaignId: r.campaignId,
      searchTerm: r.searchTerm,
      costMyr: microsToMYR(r._sum.costMicros ?? BigInt(0)),
    })),
    alreadyDecided,
  ).filter((x) => {
    const left = slotsLeft.get(x.campaignId) ?? 0;
    if (left <= 0) return false; // cost-sorted, so what's dropped is the cheapest junk
    slotsLeft.set(x.campaignId, left - 1);
    return true;
  });
  for (const x of exclusions) {
    if (mode === "armed") {
      const res = await applyTermExclusion({
        campaignId: x.campaignId,
        searchTerm: x.searchTerm,
        decidedBy: "ads-autopilot",
        estMonthlySavingMyr: round2(x.costMyr),
        reason: `autopilot: ${x.intent} intent (RM${round2(x.costMyr)}/30d)`,
      });
      Object.assign(x, res.ok ? { applied: true } : { applied: false, error: res.error });
      if (!res.ok) continue;
    }
    alreadyDecided.add(`${x.campaignId} ${x.searchTerm}`);
    pendingWasteByCampaign.set(
      x.campaignId,
      (pendingWasteByCampaign.get(x.campaignId) ?? 0) + x.costMyr / 30,
    );
  }

  // Seed fleet-proven junk to campaigns that lack their own term data yet
  // (e.g. Shah Alam until its search-term history accumulates): every term
  // actually excluded from measured spend anywhere in the fleet becomes a
  // negative everywhere. Cost 0 — improves spend quality now, never sizes a
  // waste-matched cut. Paused campaigns are skipped (probe in flight).
  const fleetJunkTerms = [
    ...exclusions.filter((x) => x.applied !== false).map((x) => x.searchTerm),
    ...decided.filter((e) => e.status === "applied").map((e) => e.searchTerm),
  ];
  const isPausedCampaign = (s: string) => !ENABLED_STATUSES.includes(s);
  const seeds = campaigns
    .filter((c) => !isPausedCampaign(c.status))
    .flatMap((c) =>
      selectSeedExclusions([c.id], fleetJunkTerms, alreadyDecided, Math.max(0, slotsLeft.get(c.id) ?? 0)),
    );
  for (const x of seeds) {
    slotsLeft.set(x.campaignId, (slotsLeft.get(x.campaignId) ?? 1) - 1);
    if (mode === "armed") {
      const res = await applyTermExclusion({
        campaignId: x.campaignId,
        searchTerm: x.searchTerm,
        decidedBy: "ads-autopilot",
        estMonthlySavingMyr: null,
        reason: `autopilot: seeded fleet-wide junk (${x.intent}; proven wasteful at a sibling campaign)`,
      });
      Object.assign(x, res.ok ? { applied: true } : { applied: false, error: res.error });
    }
    exclusions.push(x);
  }

  const isPausedStatus = (s: string) => !ENABLED_STATUSES.includes(s);
  const states: CampaignState[] = campaigns.map((c) => {
    const current = microsToMYR(c.dailyBudgetMicros ?? BigInt(0));
    return {
      campaignId: c.id,
      campaignName: c.name,
      outletId: c.outletId,
      dailyBudgetMyr: current,
      baselineDailyMyr: Math.max(current, maxLevelByCampaign.get(c.id) ?? 0),
      efficiencyRatio: effByCampaign.get(c.id) ?? null,
      lastApplied: lastByCampaign.get(c.id) ?? null,
      isPaused: isPausedStatus(c.status),
      hasBeenPauseProbed: pauseProbedCampaigns.has(c.id),
      pendingWasteDailyMyr: pendingWasteByCampaign.get(c.id) ?? 0,
    };
  });

  // A running pause probe gets its own measurement window (pause start →
  // yesterday) with the forecast built from PRE-pause history, plus the other
  // outlets' index over the SAME window as the control.
  for (const s of states) {
    if (!s.isPaused || lastKind(s.lastApplied) !== "pause" || !s.outletId) continue;
    const outlet = outlets.find((o) => o.id === s.outletId);
    if (!outlet) continue;
    const pStart = addDays(mytDate(s.lastApplied!.decidedAt), 1); // first fully-paused day
    if (pStart > yesterday) continue;
    const w = await windowActualForecast(outlet, pStart, yesterday).catch(() => null);
    const index = w && w.forecast > 0 ? w.actual / w.forecast : null;
    const others: number[] = [];
    for (const o of outlets) {
      if (o.id === s.outletId) continue;
      const ow = await windowActualForecast(o, pStart, yesterday).catch(() => null);
      if (ow && ow.forecast > 0) others.push(ow.actual / ow.forecast);
    }
    const sig = guardFromIndexes(index, others);
    s.pauseProbe = { index: sig.rawIndex, adjIndex: sig.adjIndex };
  }

  const baseDecisions = states.map((s) => {
    const directive = ownerDirective(s);
    return directive ?? decideCampaign(s, s.outletId ? guards[s.outletId] ?? noGuard : noGuard, now);
  });
  const withProbe = PAUSE_PROBE_ENABLED ? selectPauseProbe(capCuts(baseDecisions, states), states, guards) : capCuts(baseDecisions, states);
  const decisions: AutopilotRunResult["decisions"] = spaceDisturbances(withProbe, lastDisturbanceAt, now);

  if (mode === "armed") {
    for (const d of decisions) {
      if (d.action === "hold") continue;
      if (d.action === "pause") {
        const res = await pauseCampaign(d.campaignId, d.reason, "ads-autopilot");
        Object.assign(d, res.ok ? { applied: true } : { applied: false, error: res.error });
        continue;
      }
      if (d.action === "restore") {
        const res = await enableCampaign(d.campaignId, d.reason, "ads-autopilot");
        Object.assign(d, res.ok ? { applied: true } : { applied: false, error: res.error });
        // "No detectable effect" verdict also drops the budget to the floor.
        const st = states.find((s) => s.campaignId === d.campaignId);
        if (res.ok && d.newDailyMyr != null && st && d.newDailyMyr < st.dailyBudgetMyr) {
          const bres = await applyBudgetChange({
            campaignId: d.campaignId,
            newDailyMyr: d.newDailyMyr,
            decidedBy: "ads-autopilot",
            reason: d.reason,
          });
          if (!bres.ok) Object.assign(d, { applied: false, error: bres.error });
        }
        continue;
      }
      if (d.newDailyMyr == null) continue;
      const res = await applyBudgetChange({
        campaignId: d.campaignId,
        newDailyMyr: d.newDailyMyr,
        decidedBy: "ads-autopilot",
        reason: d.reason,
      });
      Object.assign(d, res.ok ? { applied: true } : { applied: false, error: res.error });
    }
    // Exclusions were already applied BEFORE the budget decisions (paired
    // exclude → cut, same run) — see the block above the state build.
  }

  const acted = decisions.filter((d) => d.action !== "hold");
  await logAgentAction({
    agentKey: AGENT_KEY,
    kind: mode === "armed" ? "budget_change" : "proposal",
    summary:
      `${mode}: ${acted.length ? acted.map((d) => `${d.campaignName} ${d.action}${d.newDailyMyr != null ? `→RM${d.newDailyMyr}/day` : ""}`).join("; ") : "all campaigns hold"}; ` +
      `${exclusions.length} term exclusion(s)`,
    refTable: "ads_budget_change",
    meta: { decisions, exclusions: exclusions.slice(0, 30), guards },
  });

  return { mode, decisions, exclusions, guards };
}
