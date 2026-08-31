import { describe, it, expect } from "vitest";
import {
  decideCampaign,
  guardFromIndexes,
  capCuts,
  selectPauseProbe,
  spaceDisturbances,
  ownerDirective,
  cashScoreboard,
  FLEET_SPACING_DAYS,
  FLOOR_DAILY_MYR,
  OBSERVE_DAYS,
  ROLLBACK_HOLD_DAYS,
  PROBE_OBSERVE_DAYS,
  SETTLE_HOLD_DAYS,
  RAISE_CAP_OF_BASELINE,
  PAUSE_PROBE_DAYS,
  type CampaignState,
  type GuardSignal,
} from "./autopilot";
import { classifyTermIntent, selectAutoExclusions, selectSeedExclusions, shouldAutoExclude, negativeThemeRoot, exclusionPhrase } from "./term-rules";
import { planConsolidation } from "./consolidate-negatives";
import { findLeaks, planSlotSwap, scoreNegatives } from "./verify-exclusions";

const NOW = new Date("2026-07-20T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000);

const healthy: GuardSignal = { rawIndex: 1.01, adjIndex: 1.0, anchorIndex: 1.0, momIndex: null, forecastDailyMyr: 250, breach: false };
// Gap ~9% of RM250/day ≈ RM22.5/day — within what an RM8/day cut could
// plausibly cause (8 ÷ 0.6 × 2 ≈ RM26.7), so rollbacks still fire on it.
const breached: GuardSignal = { rawIndex: 0.91, adjIndex: 0.93, anchorIndex: 0.94, momIndex: null, forecastDailyMyr: 250, breach: true };

const campaign = (over: Partial<CampaignState> = {}): CampaignState => ({
  campaignId: "c1",
  campaignName: "Celsius Test",
  outletId: "o1",
  dailyBudgetMyr: 100,
  baselineDailyMyr: 100,
  efficiencyRatio: 1.0,
  lastApplied: null,
  isPaused: false,
  hasBeenPauseProbed: false,
  pendingWasteDailyMyr: 0,
  ...over,
});

describe("guardFromIndexes", () => {
  it("no breach when actual tracks forecast and fleet", () => {
    expect(guardFromIndexes(1.0, [0.99, 1.02]).breach).toBe(false);
  });
  it("breaches on raw index below 0.95 even if fleet fell too", () => {
    // Everyone fell 10% (common shock): adj ≈ 1, but raw 0.9 still breaches —
    // we never keep cutting into an outlet that is genuinely below forecast.
    const g = guardFromIndexes(0.9, [0.9, 0.9]);
    expect(g.adjIndex).toBeCloseTo(1.0, 2);
    expect(g.breach).toBe(true);
  });
  it("breaches on fleet-adjusted underperformance", () => {
    // Outlet at 0.96 while the others sit at 1.05 → adj ≈ 0.914.
    const g = guardFromIndexes(0.96, [1.05, 1.06]);
    expect(g.breach).toBe(true);
  });
  it("null when no forecast", () => {
    expect(guardFromIndexes(null, [1, 1])).toEqual({ rawIndex: null, adjIndex: null, anchorIndex: null, momIndex: null, forecastDailyMyr: null, breach: false });
  });

  it("breaches on cumulative anchor drift even when the trailing forecast looks fine (boiling frog)", () => {
    // Trailing index 1.0 (baseline has absorbed the slow damage), fleet fine —
    // but the outlet now takes only 90% of its pre-descent share of fleet revenue.
    const g = guardFromIndexes(1.0, [1.0, 1.0], 0.9);
    expect(g.breach).toBe(true);
    const ok = guardFromIndexes(1.0, [1.0, 1.0], 0.97);
    expect(ok.breach).toBe(false);
  });
});

describe("guardFromIndexes — payday-cycle robustness (owner 2026-07-27)", () => {
  it("suppresses a raw-only breach when the payday-aligned view is healthy (the Tamarind case)", () => {
    // Week-over-week Tamarind read -12% because Jul 13-19 and Jul 20-26 sit at
    // different points in the 25th-payday cycle; month-over-month it was -1.5%.
    // Payday hits the whole fleet at once, so every sibling dips too and the
    // fleet-adjusted index stays ~1.0 — a genuinely raw-ONLY breach.
    const g = guardFromIndexes(0.9, [0.9, 0.9], 1.0, 2300, 0.985);
    expect(g.breach).toBe(false);
    expect(g.calendarArtifact).toBe(true);
    expect(g.momIndex).toBe(0.99);
  });

  it("still breaches on raw weakness when month-over-month confirms it", () => {
    const g = guardFromIndexes(0.9, [0.9, 0.9], 1.0, 2300, 0.88);
    expect(g.breach).toBe(true);
    expect(g.calendarArtifact).toBeUndefined();
  });

  it("never suppresses a RELATIVE breach — fleet-adjusted weakness is real", () => {
    // adj/anchor already cancel payday (one salary calendar fleet-wide), so a
    // healthy MoM must not excuse them.
    const adj = guardFromIndexes(0.96, [1.06, 1.07], 1.0, 2300, 1.0);
    expect(adj.breach).toBe(true);
    expect(adj.calendarArtifact).toBeUndefined();
    const anchor = guardFromIndexes(0.99, [1.0, 1.0], 0.9, 2300, 1.0);
    expect(anchor.breach).toBe(true);
  });

  it("without a month-over-month signal, behaviour is unchanged", () => {
    expect(guardFromIndexes(0.9, [0.9, 0.9], 1.0, 2300, null).breach).toBe(true);
    expect(guardFromIndexes(1.0, [1.0, 1.0], 1.0, 2300, null).breach).toBe(false);
  });
});

describe("decideCampaign", () => {
  it("never cuts without a revenue guard", () => {
    const d = decideCampaign(campaign({ outletId: null }), healthy, NOW);
    expect(d.action).toBe("hold");
  });

  it("cuts STEP_PCT (12%) when healthy, observed, and efficient", () => {
    const d = decideCampaign(campaign(), healthy, NOW);
    expect(d.action).toBe("cut");
    expect(d.newDailyMyr).toBe(88);
  });

  it("waste-matched cut takes priority: removes exactly the excluded-term spend", () => {
    // Putrajaya-shaped: RM12.9/day of junk terms excluded since the last change
    const d = decideCampaign(campaign({ pendingWasteDailyMyr: 12.9 }), healthy, NOW);
    expect(d.action).toBe("cut");
    expect(d.newDailyMyr).toBe(87.1);
    expect(d.reason).toMatch(/^autopilot step-down \(waste-matched\)/);
  });

  it("waste-matched cut is capped at 20% of the budget", () => {
    const d = decideCampaign(campaign({ pendingWasteDailyMyr: 35 }), healthy, NOW);
    expect(d.action).toBe("cut");
    expect(d.newDailyMyr).toBe(80);
  });

  it("negligible pending waste falls back to the blind percentage step", () => {
    const d = decideCampaign(campaign({ pendingWasteDailyMyr: 0.3 }), healthy, NOW);
    expect(d.action).toBe("cut");
    expect(d.newDailyMyr).toBe(88);
    expect(d.reason).not.toMatch(/waste-matched/);
  });

  it("waste-matched cuts skip the observation window (paired with exclusions, not an experiment)", () => {
    const d = decideCampaign(
      campaign({
        pendingWasteDailyMyr: 12.9,
        lastApplied: { decidedAt: daysAgo(5), prevDailyMyr: 110, newDailyMyr: 100, reason: "autopilot step-down" },
      }),
      healthy,
      NOW,
    );
    expect(d.action).toBe("cut");
    expect(d.newDailyMyr).toBe(87.1);
    expect(d.reason).toMatch(/waste-matched/);
  });

  it("waste-matched cuts never fire into a weak till", () => {
    const d = decideCampaign(campaign({ pendingWasteDailyMyr: 12.9 }), breached, NOW);
    expect(d.action).not.toBe("cut");
  });

  it("cuts STEP_PCT_INEFFICIENT (18%) when cost/conv is far off fleet-best", () => {
    const d = decideCampaign(campaign({ efficiencyRatio: 1.5 }), healthy, NOW);
    expect(d.action).toBe("cut");
    expect(d.newDailyMyr).toBe(82);
  });

  it("holds while a recent change is still being observed", () => {
    const d = decideCampaign(
      campaign({ lastApplied: { decidedAt: daysAgo(OBSERVE_DAYS - 4), prevDailyMyr: 110, newDailyMyr: 100, reason: "autopilot step-down" } }),
      healthy,
      NOW,
    );
    expect(d.action).toBe("hold");
  });

  it("never cuts below the floor", () => {
    const d = decideCampaign(campaign({ dailyBudgetMyr: FLOOR_DAILY_MYR + 1 }), healthy, NOW);
    expect(d.action).toBe("cut");
    expect(d.newDailyMyr).toBe(FLOOR_DAILY_MYR);
    const atFloor = decideCampaign(campaign({ dailyBudgetMyr: FLOOR_DAILY_MYR }), healthy, NOW);
    expect(atFloor.action).toBe("hold");
  });

  it("rolls back the last cut on a guard breach", () => {
    const d = decideCampaign(
      campaign({ dailyBudgetMyr: 92, lastApplied: { decidedAt: daysAgo(15), prevDailyMyr: 100, newDailyMyr: 92, reason: "autopilot step-down 8%" } }),
      breached,
      NOW,
    );
    expect(d.action).toBe("rollback");
    expect(d.newDailyMyr).toBe(100);
    expect(d.reason).toMatch(/^autopilot rollback/);
  });

  it("does not cut into weakness when there is no recent cut to blame", () => {
    const d = decideCampaign(campaign(), breached, NOW);
    expect(d.action).toBe("hold");
    expect(d.reason).toMatch(/not cutting into weakness/);
  });

  it("plausibility bound: an implausibly large gap holds instead of rolling back (the Tamarind case)", () => {
    // Flat-but-below-trend outlet: gap 6% of RM2,300/day ≈ RM138/day, while the
    // RM15.24/day descent could cause at most ~RM51/day at margin — hold + flag.
    const tamarindGuard: GuardSignal = { rawIndex: 0.96, adjIndex: 0.94, anchorIndex: 0.96, momIndex: null, forecastDailyMyr: 2300, breach: true };
    const d = decideCampaign(
      campaign({
        dailyBudgetMyr: 84.96,
        baselineDailyMyr: 100.2,
        lastApplied: { decidedAt: daysAgo(12), prevDailyMyr: 100.2, newDailyMyr: 84.96, reason: "budget cut" },
      }),
      tamarindGuard,
      NOW,
    );
    expect(d.action).toBe("hold");
    expect(d.reason).toMatch(/another cause/);
  });

  it("holds after a rollback, then probes UP (response proven), never re-cuts the proven level", () => {
    const rolledBack = campaign({
      dailyBudgetMyr: 100,
      lastApplied: { decidedAt: daysAgo(ROLLBACK_HOLD_DAYS - 10), prevDailyMyr: 92, newDailyMyr: 100, reason: "autopilot rollback: guard breach" },
    });
    expect(decideCampaign(rolledBack, healthy, NOW).action).toBe("hold");
    const holdOver = campaign({
      dailyBudgetMyr: 100,
      baselineDailyMyr: 100,
      lastApplied: { decidedAt: daysAgo(ROLLBACK_HOLD_DAYS + 1), prevDailyMyr: 92, newDailyMyr: 100, reason: "autopilot rollback: guard breach" },
    });
    const d = decideCampaign(holdOver, healthy, NOW);
    expect(d.action).toBe("raise");
    expect(d.newDailyMyr).toBe(115);
    expect(d.reason).toMatch(/^autopilot raise/);
  });

  it("does not re-rollback: a breach right after a rollback holds instead", () => {
    const d = decideCampaign(
      campaign({ lastApplied: { decidedAt: daysAgo(7), prevDailyMyr: 92, newDailyMyr: 100, reason: "autopilot rollback: guard breach" } }),
      breached,
      NOW,
    );
    expect(d.action).toBe("hold");
  });

  it("does not probe up into a weak till even after the hold", () => {
    const d = decideCampaign(
      campaign({ lastApplied: { decidedAt: daysAgo(ROLLBACK_HOLD_DAYS + 1), prevDailyMyr: 92, newDailyMyr: 100, reason: "autopilot rollback: guard breach" } }),
      breached,
      NOW,
    );
    expect(d.action).toBe("hold");
  });
});

describe("decideCampaign — probe-up phase (spend must prove itself)", () => {
  const raised = (over: Partial<CampaignState> = {}) =>
    campaign({
      dailyBudgetMyr: 115,
      baselineDailyMyr: 100,
      lastApplied: { decidedAt: daysAgo(PROBE_OBSERVE_DAYS + 1), prevDailyMyr: 100, newDailyMyr: 115, reason: "autopilot raise: probing" },
      ...over,
    });

  it("holds while a raise is under observation", () => {
    const d = decideCampaign(
      raised({ lastApplied: { decidedAt: daysAgo(10), prevDailyMyr: 100, newDailyMyr: 115, reason: "autopilot raise: probing" } }),
      healthy,
      NOW,
    );
    expect(d.action).toBe("hold");
  });

  it("reverts a raise that showed no till lift and settles", () => {
    // healthy-but-flat (1.01/1.00) is NOT lift — the raise must pay, not just not-hurt
    const d = decideCampaign(raised(), healthy, NOW);
    expect(d.action).toBe("revert");
    expect(d.newDailyMyr).toBe(100);
    expect(d.reason).toMatch(/^autopilot revert/);
  });

  it("reverts immediately on a guard breach during a raise", () => {
    const d = decideCampaign(
      raised({ lastApplied: { decidedAt: daysAgo(7), prevDailyMyr: 100, newDailyMyr: 115, reason: "autopilot raise: probing" } }),
      breached,
      NOW,
    );
    expect(d.action).toBe("revert");
    expect(d.newDailyMyr).toBe(100);
  });

  it("keeps a raise with proven lift and probes further, up to the baseline cap", () => {
    const lift: GuardSignal = { rawIndex: 1.06, adjIndex: 1.05, anchorIndex: 1.04, momIndex: null, forecastDailyMyr: 250, breach: false };
    const d = decideCampaign(raised(), lift, NOW);
    expect(d.action).toBe("raise");
    expect(d.newDailyMyr).toBe(100 * RAISE_CAP_OF_BASELINE); // 132.25 capped to 125
    const atCap = decideCampaign(raised({ dailyBudgetMyr: 125 }), lift, NOW);
    expect(atCap.action).toBe("hold");
    expect(atCap.reason).toMatch(/raise cap/);
  });

  it("settles after a revert, then re-enters descent", () => {
    const settled = campaign({
      dailyBudgetMyr: 100,
      lastApplied: { decidedAt: daysAgo(SETTLE_HOLD_DAYS - 5), prevDailyMyr: 115, newDailyMyr: 100, reason: "autopilot revert: no lift" },
    });
    expect(decideCampaign(settled, healthy, NOW).action).toBe("hold");
    const reSearch = campaign({
      dailyBudgetMyr: 100,
      lastApplied: { decidedAt: daysAgo(SETTLE_HOLD_DAYS + 1), prevDailyMyr: 115, newDailyMyr: 100, reason: "autopilot revert: no lift" },
    });
    expect(decideCampaign(reSearch, healthy, NOW).action).toBe("cut");
  });
});

describe("pause probe", () => {
  const guards = { o1: healthy, o2: healthy, o3: healthy };

  it("selectPauseProbe pauses only the worst clearly-inefficient never-probed campaign", () => {
    const states = [
      campaign({ campaignId: "sa", outletId: "o1", efficiencyRatio: 1.0 }),
      campaign({ campaignId: "pj", outletId: "o2", efficiencyRatio: 1.24 }),
      campaign({ campaignId: "tam", outletId: "o3", efficiencyRatio: 1.54 }),
    ];
    const decisions = states.map((s) => decideCampaign(s, guards[s.outletId as keyof typeof guards], NOW));
    const out = selectPauseProbe(decisions, states, guards);
    expect(out.find((d) => d.campaignId === "tam")?.action).toBe("pause");
    // Putrajaya (1.24 < 1.3) and Shah Alam stay on the gradual descent.
    expect(out.find((d) => d.campaignId === "pj")?.action).toBe("cut");
    expect(out.find((d) => d.campaignId === "sa")?.action).toBe("cut");
  });

  it("never starts a second probe while one is running, never re-probes, never probes into weakness", () => {
    const states = [
      campaign({ campaignId: "tam", outletId: "o3", efficiencyRatio: 1.54 }),
      campaign({ campaignId: "pj", outletId: "o2", efficiencyRatio: 1.4 }),
    ];
    const decisions = states.map((s) => decideCampaign(s, healthy, NOW));
    // a probe already running (autopilot-paused) blocks the next one…
    expect(
      selectPauseProbe(
        decisions,
        [
          { ...states[0], isPaused: true, lastApplied: { decidedAt: daysAgo(3), prevDailyMyr: 85, newDailyMyr: 85, reason: "autopilot pause: probe start" } },
          states[1],
        ],
        guards,
      ).every((d) => d.action !== "pause"),
    ).toBe(true);
    // …but a HUMAN-paused sibling (e.g. Nilai, paused long ago) must not
    expect(
      selectPauseProbe(decisions, [{ ...states[0], isPaused: true, lastApplied: null }, states[1]], guards).some(
        (d) => d.action === "pause",
      ),
    ).toBe(true);
    // already probed before
    expect(
      selectPauseProbe(decisions, states.map((s) => ({ ...s, hasBeenPauseProbed: true })), guards).every((d) => d.action !== "pause"),
    ).toBe(true);
    // absolute weakness (own raw index below forecast floor) at every outlet
    expect(
      selectPauseProbe(decisions, states, { o2: breached, o3: breached }).every((d) => d.action !== "pause"),
    ).toBe(true);
  });

  it("a RELATIVE-only breach does not block the probe (owner: switch Tamarind off for a baseline)", () => {
    // Own till at forecast (raw 0.96) but fleet-adj breached because a sibling ran hot.
    const relativeOnly: GuardSignal = { rawIndex: 0.96, adjIndex: 0.94, anchorIndex: 0.96, momIndex: null, forecastDailyMyr: 2300, breach: true };
    const states = [
      campaign({
        campaignId: "tam",
        outletId: "o3",
        dailyBudgetMyr: 100.2,
        baselineDailyMyr: 100.2,
        efficiencyRatio: 1.54,
        lastApplied: { decidedAt: daysAgo(1), prevDailyMyr: 84.96, newDailyMyr: 100.2, reason: "autopilot rollback: guard breach" },
      }),
    ];
    const decisions = states.map((s) => decideCampaign(s, relativeOnly, NOW));
    const out = selectPauseProbe(decisions, states, { o3: relativeOnly });
    expect(out[0].action).toBe("pause");
  });

  it("holds a paused campaign until the probe window completes", () => {
    const d = decideCampaign(
      campaign({
        isPaused: true,
        lastApplied: { decidedAt: daysAgo(10), prevDailyMyr: 85, newDailyMyr: 85, reason: "autopilot pause: probe start" },
        pauseProbe: { index: 0.97, adjIndex: 0.98 },
      }),
      healthy,
      NOW,
    );
    expect(d.action).toBe("hold");
    expect(d.reason).toMatch(/pause probe running/);
  });

  it("restores at the prior budget when the pause dented the till (ads generate cash)", () => {
    const d = decideCampaign(
      campaign({
        dailyBudgetMyr: 85,
        isPaused: true,
        lastApplied: { decidedAt: daysAgo(PAUSE_PROBE_DAYS + 1), prevDailyMyr: 85, newDailyMyr: 85, reason: "autopilot pause: probe start" },
        pauseProbe: { index: 0.92, adjIndex: 0.93 },
      }),
      healthy,
      NOW,
    );
    expect(d.action).toBe("restore");
    expect(d.newDailyMyr).toBe(85);
    expect(d.reason).toMatch(/ads generate cash/);
  });

  it("restores at the floor when the pause showed no detectable till effect", () => {
    const d = decideCampaign(
      campaign({
        dailyBudgetMyr: 85,
        isPaused: true,
        lastApplied: { decidedAt: daysAgo(PAUSE_PROBE_DAYS + 1), prevDailyMyr: 85, newDailyMyr: 85, reason: "autopilot pause: probe start" },
        pauseProbe: { index: 1.0, adjIndex: 1.0 },
      }),
      healthy,
      NOW,
    );
    expect(d.action).toBe("restore");
    expect(d.newDailyMyr).toBe(FLOOR_DAILY_MYR);
    expect(d.reason).toMatch(/no detectable till effect/);
  });

  it("holds — never floors — when the probe index could not be measured", () => {
    // A forecast failure at verdict time is a measurement outage, not evidence.
    // The old behaviour fell through to the floor verdict on index null, i.e. a
    // transient query error would have slashed the budget "on no detectable
    // effect" it never measured. Both the missing-object and null-index shapes
    // must hold and let tomorrow's run re-measure.
    for (const pauseProbe of [undefined, { index: null, adjIndex: null }]) {
      const d = decideCampaign(
        campaign({
          dailyBudgetMyr: 85,
          isPaused: true,
          lastApplied: { decidedAt: daysAgo(PAUSE_PROBE_DAYS + 1), prevDailyMyr: 85, newDailyMyr: 85, reason: "autopilot pause: probe start" },
          pauseProbe,
        }),
        healthy,
        NOW,
      );
      expect(d.action).toBe("hold");
      expect(d.reason).toMatch(/could not be measured/);
    }
  });

  it("leaves a human-paused campaign alone", () => {
    const d = decideCampaign(campaign({ isPaused: true, lastApplied: null }), healthy, NOW);
    expect(d.action).toBe("hold");
    expect(d.reason).toMatch(/not by the autopilot/);
  });
});

// The 2026-07-19 hard-cut directive was REMOVED on 2026-08-15 (loop QA P8.1).
// Its expiry test was `dailyBudgetMyr <= 55 → null`, which held only while the
// budget stayed under RM55 — it re-armed on any future raise. These pin that a
// campaign back above RM55 is now judged on the till like any other, so a
// probe-up (Shah Alam's is due ~Oct 7) is never slammed back to a fixed number.
describe("no fixed-target hard cut survives", () => {
  const adCampaign = (over: Partial<CampaignState> = {}) =>
    campaign({ campaignId: "pj", campaignName: "Celsius Putrajaya", dailyBudgetMyr: 89.44, ...over });

  it("does not chop an above-RM55 campaign to RM55 on a healthy till", () => {
    const d = decideCampaign(adCampaign(), healthy, NOW);
    expect(d.newDailyMyr).not.toBe(55);
    expect(d.reason).not.toMatch(/hard-cut/);
  });

  it("judges a raised campaign on the till, not on its name", () => {
    // Same budget, listed vs unlisted name: the old directive keyed off the
    // campaign name, so these two diverged. They must now agree.
    const listed = decideCampaign(adCampaign(), healthy, NOW);
    const unlisted = decideCampaign(adCampaign({ campaignName: "Celsius Coffee KL" }), healthy, NOW);
    expect(listed.action).toBe(unlisted.action);
    expect(listed.newDailyMyr).toBe(unlisted.newDailyMyr);
  });
});

describe("cashScoreboard (RM7k/mo target)", () => {
  it("scores cuts and margin on till drift against the target", () => {
    // Fleet at RM265.86/day vs RM300.20 baseline → RM1,030/mo cuts.
    // Till up RM100/day vs anchor → RM1,800/mo at 60% margin.
    const s = cashScoreboard(265.86, 9000, 9100);
    expect(s.cutsMonthlyMyr).toBeCloseTo(1030.2, 1);
    expect(s.salesMonthlyMyr).toBeCloseTo(1800, 1);
    expect(s.netMonthlyMyr).toBeCloseTo(2830.2, 1);
    expect(s.targetMonthlyMyr).toBe(5000);
    expect(s.pctOfTarget).toBe(57);
  });

  it("a till decline counts NEGATIVE — net cash is the objective, not gross savings", () => {
    const s = cashScoreboard(265.86, 9000, 8800);
    expect(s.salesMonthlyMyr).toBeCloseTo(-3600, 1);
    expect(s.netMonthlyMyr).toBeLessThan(0);
  });

  it("no anchor yet → sales side null, cuts still scored", () => {
    const s = cashScoreboard(280, null, 9000);
    expect(s.salesMonthlyMyr).toBeNull();
    expect(s.cutsMonthlyMyr).toBeCloseTo(606, 0);
  });
});

describe("ownerDirective (2026-08-25: probe-up Shah Alam + Putrajaya, evaluated raises)", () => {
  const AUG25 = new Date("2026-08-25T19:01:00Z");
  const shahAlam = (over: Partial<CampaignState> = {}) =>
    campaign({
      campaignId: "sa",
      campaignName: "Celsius Coffee Shah Alam",
      dailyBudgetMyr: 53.98,
      baselineDailyMyr: 100.2,
      lastApplied: { decidedAt: daysAgo(40), prevDailyMyr: 84.96, newDailyMyr: 100.2, reason: "autopilot rollback: guard breach" },
      ...over,
    });
  const putrajaya = (over: Partial<CampaignState> = {}) =>
    campaign({
      campaignId: "pj",
      campaignName: "Celsius Putrajaya",
      dailyBudgetMyr: 43.36,
      baselineDailyMyr: 100,
      lastApplied: { decidedAt: daysAgo(9), prevDailyMyr: 38.16, newDailyMyr: 43.36, reason: "owner directive 2026-08-16 (undo the Aug 12 cut)" },
      ...over,
    });

  it("Shah Alam: starts the probe-up early out of the rollback hold, as an EVALUATED raise", () => {
    const d = ownerDirective(shahAlam(), healthy, AUG25);
    expect(d?.action).toBe("raise");
    expect(d?.newDailyMyr).toBe(62.08); // 53.98 × 1.15
    // Deliberately an "autopilot raise" — the evaluation branch is the
    // owner's "make sure the ads work": revert without measured lift.
    expect(d?.reason).toMatch(/^autopilot raise: owner directive 2026-08-25/);
  });

  it("Putrajaya: fires only once its guard reads clean — never raise into the breach it must outgrow", () => {
    expect(ownerDirective(putrajaya(), breached, AUG25)).toBeNull();
    const d = ownerDirective(putrajaya(), healthy, AUG25);
    expect(d?.action).toBe("raise");
    expect(d?.newDailyMyr).toBe(49.86); // 43.36 × 1.15
  });

  it("each leg is spent by its own raise, ignores other campaigns/paused, and hard-expires 2026-09-15", () => {
    expect(
      ownerDirective(
        shahAlam({ dailyBudgetMyr: 62.08, lastApplied: { decidedAt: daysAgo(1), prevDailyMyr: 53.98, newDailyMyr: 62.08, reason: "autopilot raise: owner directive 2026-08-25" } }),
        healthy, AUG25,
      ),
    ).toBeNull();
    expect(
      ownerDirective(
        putrajaya({ dailyBudgetMyr: 49.86, lastApplied: { decidedAt: daysAgo(1), prevDailyMyr: 43.36, newDailyMyr: 49.86, reason: "autopilot raise: owner directive 2026-08-25" } }),
        healthy, AUG25,
      ),
    ).toBeNull();
    expect(ownerDirective(campaign({ campaignName: "Celsius Coffee Tamarind Square" }), healthy, AUG25)).toBeNull();
    expect(ownerDirective(shahAlam({ isPaused: true }), healthy, AUG25)).toBeNull();
    expect(ownerDirective(shahAlam(), healthy, new Date("2026-09-15T00:00:01Z"))).toBeNull();
    expect(ownerDirective(putrajaya(), healthy, new Date("2026-09-15T00:00:01Z"))).toBeNull();
  });

  it("a later guard breach does NOT auto-revert the directive raise (lastKind 'other' observes, never reverts)", () => {
    const afterRaise = putrajaya({
      dailyBudgetMyr: 43.36,
      lastApplied: { decidedAt: daysAgo(2), prevDailyMyr: 38.16, newDailyMyr: 43.36, reason: "owner directive 2026-08-16 (undo the Aug 12 cut)" },
    });
    const d = decideCampaign(afterRaise, breached, NOW);
    expect(d.action).toBe("hold");
    expect(d.reason).toMatch(/no recent cut to blame/);
  });

  it("owner-directive raises are exempt from fleet spacing like owner-directive cuts", () => {
    const d = [{ campaignId: "pj", campaignName: "PJ", action: "raise" as const, newDailyMyr: 43.36, reason: "owner directive 2026-08-16 (undo the Aug 12 cut)" }];
    expect(spaceDisturbances(d, daysAgo(1), NOW)[0].action).toBe("raise");
  });
});

describe("spaceDisturbances (nightly cadence)", () => {
  it("defers new disturbances inside the spacing window but never delays safety actions", () => {
    const decisions = [
      { campaignId: "a", campaignName: "A", action: "cut" as const, newDailyMyr: 92, reason: "autopilot step-down" },
      { campaignId: "b", campaignName: "B", action: "rollback" as const, newDailyMyr: 100, reason: "autopilot rollback" },
      { campaignId: "c", campaignName: "C", action: "pause" as const, reason: "autopilot pause" },
    ];
    const spaced = spaceDisturbances(decisions, daysAgo(2), NOW);
    expect(spaced.find((d) => d.campaignId === "a")?.action).toBe("hold");
    // pauses are per-outlet-measured probes — never spaced
    expect(spaced.find((d) => d.campaignId === "c")?.action).toBe("pause");
    expect(spaced.find((d) => d.campaignId === "b")?.action).toBe("rollback");
    // waste-matched cuts are paired bookkeeping — never spaced
    const wm = [{ campaignId: "w", campaignName: "W", action: "cut" as const, newDailyMyr: 87.1, reason: "autopilot step-down (waste-matched): RM12.9/day" }];
    expect(spaceDisturbances(wm, daysAgo(1), NOW)[0].action).toBe("cut");
    // outside the window (or no history) everything passes
    expect(spaceDisturbances(decisions, daysAgo(FLEET_SPACING_DAYS + 1), NOW)).toEqual(decisions);
    expect(spaceDisturbances(decisions, null, NOW)).toEqual(decisions);
  });
});

describe("capCuts", () => {
  it("keeps the least efficient cuts and defers the rest", () => {
    const states = [
      campaign({ campaignId: "a", efficiencyRatio: 1.0 }),
      campaign({ campaignId: "b", efficiencyRatio: 2.0 }),
      campaign({ campaignId: "c", efficiencyRatio: 1.5 }),
    ];
    const decisions = states.map((s) => decideCampaign(s, healthy, NOW));
    const capped = capCuts(decisions, states, 2);
    expect(capped.find((d) => d.campaignId === "a")?.action).toBe("hold");
    expect(capped.find((d) => d.campaignId === "b")?.action).toBe("cut");
    expect(capped.find((d) => d.campaignId === "c")?.action).toBe("cut");
  });
});

describe("term intent rules", () => {
  it("classifies from the live Putrajaya term data", () => {
    expect(classifyTermIntent("celsius coffee putrajaya")).toBe("own_brand");
    expect(classifyTermIntent("zus near me")).toBe("competitor_brand");
    expect(classifyTermIntent("kenangan coffee near me")).toBe("competitor_brand");
    expect(classifyTermIntent("mykori dessert cafe near me")).toBe("competitor_brand");
    expect(classifyTermIntent("cafe near me")).toBe("cafe_intent");
    expect(classifyTermIntent("breakfast near me")).toBe("cafe_intent");
    expect(classifyTermIntent("kopitiam near me")).toBe("cafe_intent");
    expect(classifyTermIntent("restaurants near me")).toBe("non_cafe_food");
    expect(classifyTermIntent("kedai makan near me")).toBe("non_cafe_food");
    expect(classifyTermIntent("cake shop near me")).toBe("dessert_bakery");
    expect(classifyTermIntent("tempat menarik putrajaya")).toBe("other");
  });

  it("cafe whitelist beats the food blocklist", () => {
    expect(classifyTermIntent("coffee shop food court")).toBe("cafe_intent");
  });

  it("all junk classes auto-exclude; cafe intent and unknowns never do", () => {
    expect(shouldAutoExclude("own_brand")).toBe(true);
    expect(shouldAutoExclude("non_cafe_food")).toBe(true);
    expect(shouldAutoExclude("competitor_brand")).toBe(true); // owner 2026-07-18: no conquesting
    expect(shouldAutoExclude("dessert_bakery")).toBe(true);   // owner 2026-07-18
    expect(shouldAutoExclude("cafe_intent")).toBe(false);
    expect(shouldAutoExclude("other")).toBe(false);
  });

  it("classifies the Malay/local and new-brand terms from the live lists", () => {
    expect(classifyTermIntent("restoran 113 dengkil")).toBe("non_cafe_food");
    expect(classifyTermIntent("food court near presint 9 putrajaya")).toBe("non_cafe_food");
    expect(classifyTermIntent("dengkil 美食")).toBe("non_cafe_food");
    expect(classifyTermIntent("hock kee kopitiam")).toBe("competitor_brand");
    expect(classifyTermIntent("kopihut")).toBe("competitor_brand");
    expect(classifyTermIntent("cotti coffee malaysia")).toBe("competitor_brand");
    expect(classifyTermIntent("vinyl cafe")).toBe("competitor_brand");
    expect(classifyTermIntent("qbistro putrajaya")).toBe("competitor_brand");
    expect(classifyTermIntent("banana pudding cyberjaya")).toBe("dessert_bakery");
    // still kept: our own café demand, whatever the language of the rest
    expect(classifyTermIntent("kopitiam near me")).toBe("cafe_intent");
    expect(classifyTermIntent("sarapan pagi near me")).toBe("other");
    expect(classifyTermIntent("tempat best sambut birthday")).toBe("other");
  });

  it("negativeThemeRoot / exclusionPhrase collapse variants to a broad root", () => {
    expect(negativeThemeRoot("zus near me", "competitor_brand")).toBe("zus");
    expect(negativeThemeRoot("zus coffee", "competitor_brand")).toBe("zus");
    expect(negativeThemeRoot("coffee bean and tea leaf near me", "competitor_brand")).toBe("coffee bean");
    expect(negativeThemeRoot("coffee bean shah alam", "competitor_brand")).toBe("coffee bean");
    expect(negativeThemeRoot("restaurants near me", "non_cafe_food")).toBe("restaurant");
    expect(negativeThemeRoot("cake shop near me", "dessert_bakery")).toBe("cake");
    // own brand / unrecognised → keep literal
    expect(negativeThemeRoot("celsius coffee", "own_brand")).toBeNull();
    expect(exclusionPhrase("celsius coffee", "own_brand")).toBe("celsius coffee");
    expect(exclusionPhrase("zus near me", "competitor_brand")).toBe("zus");
  });

  it("selectSeedExclusions transfers fleet-proven junk AS ROOTS, respects decisions/caps, costs 0", () => {
    const fleetJunk = ["restaurants near me", "kedai makan near me", "cafe near me", "zus near me", "zus coffee", "celsius coffee"];
    const decided = new Set(["sa restaurant"]); // SA already has the 'restaurant' root
    const seeds = selectSeedExclusions(["sa", "pj"], fleetJunk, decided);
    const sa = seeds.filter((s) => s.campaignId === "sa").map((s) => s.searchTerm);
    // cafe intent never seeds; the two zus variants collapse to one root; decided root skipped
    expect(sa).toEqual(["kedai makan", "zus", "celsius coffee"]);
    const pj = seeds.filter((s) => s.campaignId === "pj").map((s) => s.searchTerm);
    expect(pj).toEqual(["restaurant", "kedai makan", "zus", "celsius coffee"]);
    expect(seeds.every((s) => s.costMyr === 0 && s.seeded)).toBe(true);
  });

  it("selectAutoExclusions consolidates to roots, sums their spend, respects min/decided/cap", () => {
    const spend = [
      { campaignId: "c1", searchTerm: "restaurants near me", costMyr: 72 },
      { campaignId: "c1", searchTerm: "restaurant near me", costMyr: 6 }, // same root → sums to 78
      { campaignId: "c1", searchTerm: "food near me", costMyr: 14.5 },
      { campaignId: "c1", searchTerm: "Celsius Coffee", costMyr: 5 },
      { campaignId: "c1", searchTerm: "nasi ayam", costMyr: 1.2 }, // root 'nasi', below min alone
      { campaignId: "c1", searchTerm: "cafe near me", costMyr: 110 }, // cafe intent — never
      { campaignId: "c1", searchTerm: "kedai makan near me", costMyr: 7.9 },
    ];
    const decided = new Set(["c1 food"]); // the 'food' root already decided
    const picked = selectAutoExclusions(spend, decided, { maxPerCampaign: 2 });
    // restaurant root (72+6=78) and kedai makan (7.9) win; food skipped; celsius/nasi below cap/min
    expect(picked.map((p) => `${p.searchTerm}:${p.costMyr}`)).toEqual(["restaurant:78", "kedai makan:7.9"]);
  });
});

describe("planConsolidation (broad roots, additive only)", () => {
  it("adds roots for subsumed literals but NEVER removes the literals", () => {
    const existing = [
      { searchTerm: "kenangan coffee", criterionResource: "r1" },
      { searchTerm: "kenangan coffee near me", criterionResource: "r2" },
      { searchTerm: "zus near me", criterionResource: "r3" },
      { searchTerm: "restaurants near me", criterionResource: "r4" },
      { searchTerm: "kedai makan", criterionResource: "r5" }, // already a root
      { searchTerm: "celsius coffee", criterionResource: "r6" }, // own brand
    ];
    const plan = planConsolidation(existing);
    expect(plan.addRoots.sort()).toEqual(["kenangan", "restaurant", "zus"].sort());
    // Regression guard (2026-07-23): removing "restaurants near me" in favour
    // of the root "restaurant" un-blocked it — Google does not stem plurals.
    expect(plan).not.toHaveProperty("removeLiterals");
  });

  it("is a no-op once everything is already a root", () => {
    const plan = planConsolidation([
      { searchTerm: "zus", criterionResource: "r1" },
      { searchTerm: "kedai makan", criterionResource: "r2" },
    ]);
    expect(plan.addRoots).toEqual([]);
  });

  it("does not re-add a root that already exists as a negative", () => {
    const plan = planConsolidation([
      { searchTerm: "zus", criterionResource: "r1" },
      { searchTerm: "zus near me", criterionResource: "r2" },
    ]);
    expect(plan.addRoots).toEqual([]);
  });
});

describe("findLeaks (negatives that aren't actually blocking)", () => {
  const applied = (searchTerm: string, appliedAt: string) => ({
    campaignId: "c1",
    searchTerm,
    appliedAt: new Date(appliedAt),
  });
  const spend = (searchTerm: string, date: string, costMyr: number) => ({
    campaignId: "c1",
    searchTerm,
    date: new Date(date),
    costMyr,
  });

  it("flags the real regression: root 'restaurant' not blocking the plural", () => {
    const leaks = findLeaks(
      [applied("restaurant", "2026-07-21")],
      [
        spend("restaurants near me", "2026-07-24", 7.36),
        spend("restaurants near me", "2026-07-25", 3.68),
        spend("restaurants", "2026-07-24", 4.43),
      ],
    );
    expect(leaks.map((l) => l.leakTerm)).toEqual(["restaurants near me", "restaurants"]);
    expect(leaks[0]).toMatchObject({ negative: "restaurant", costMyr: 11.04, days: 2 });
  });

  it("ignores spend inside the propagation grace window", () => {
    const leaks = findLeaks(
      [applied("restaurant", "2026-07-21")],
      [spend("restaurants near me", "2026-07-22", 9)], // next day = propagation
    );
    expect(leaks).toEqual([]);
  });

  it("ignores a term that is itself an applied negative", () => {
    const leaks = findLeaks(
      [applied("restaurant", "2026-07-21"), applied("restaurants near me", "2026-07-21")],
      [spend("restaurants near me", "2026-07-25", 9)],
    );
    expect(leaks).toEqual([]);
  });

  it("ignores sub-threshold noise and uncovered terms", () => {
    const leaks = findLeaks(
      [applied("restaurant", "2026-07-21")],
      [spend("restaurants", "2026-07-25", 0.4), spend("latte near me", "2026-07-25", 50)],
    );
    expect(leaks).toEqual([]);
  });

  it("attributes a leak to the most specific covering negative", () => {
    const leaks = findLeaks(
      [applied("food", "2026-07-21"), applied("food court", "2026-07-21")],
      [spend("food court putrajaya", "2026-07-25", 5)],
    );
    expect(leaks[0].negative).toBe("food court");
  });
});

describe("scoreNegatives (eviction ranking)", () => {
  it("values a consolidation root by the junk it covers, not its (absent) estimate", () => {
    const scores = scoreNegatives(
      [
        { campaignId: "c1", searchTerm: "restaurant" },
        { campaignId: "c1", searchTerm: "waffle" },
      ],
      [
        { campaignId: "c1", searchTerm: "restaurants near me", costMyr: 30 },
        { campaignId: "c1", searchTerm: "restaurant cyberjaya", costMyr: 12.05 },
        { campaignId: "c1", searchTerm: "latte", costMyr: 99 },
      ],
    );
    expect(scores.get("c1 restaurant")).toBe(42.05);
    expect(scores.get("c1 waffle")).toBe(0); // never matched → safe to evict
  });

  it("does not credit a negative with another campaign's spend", () => {
    const scores = scoreNegatives(
      [{ campaignId: "c1", searchTerm: "zus" }],
      [{ campaignId: "c2", searchTerm: "zus near me", costMyr: 50 }],
    );
    expect(scores.get("c1 zus")).toBe(0);
  });
});

describe("planSlotSwap (negative slots are a scarce budget)", () => {
  const inc = (searchTerm: string, valueMyr: number, criterionResource: string | null = "r") => ({
    searchTerm,
    valueMyr,
    criterionResource,
  });

  it("uses free slots before evicting anything", () => {
    const plan = planSlotSwap([inc("a", 10)], [{ searchTerm: "new", valueMyr: 1 }], 3);
    expect(plan.add.map((a) => a.searchTerm)).toEqual(["new"]);
    expect(plan.evict).toEqual([]);
  });

  it("evicts the cheapest incumbent for a decisively better candidate", () => {
    const plan = planSlotSwap(
      [inc("waffle", 0), inc("zus", 24)],
      [{ searchTerm: "restaurants near me", valueMyr: 160 }],
      2,
    );
    expect(plan.evict.map((e) => e.searchTerm)).toEqual(["waffle"]);
    expect(plan.add.map((a) => a.searchTerm)).toEqual(["restaurants near me"]);
  });

  it("refuses to churn when the candidate is not clearly better", () => {
    const plan = planSlotSwap([inc("zus", 24)], [{ searchTerm: "meh", valueMyr: 25 }], 1);
    expect(plan).toEqual({ add: [], evict: [] });
  });

  it("never evicts an incumbent with no removable resource", () => {
    const plan = planSlotSwap([inc("stuck", 0, null)], [{ searchTerm: "big", valueMyr: 500 }], 1);
    expect(plan).toEqual({ add: [], evict: [] });
  });
});
