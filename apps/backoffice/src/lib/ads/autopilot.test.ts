import { describe, it, expect } from "vitest";
import {
  decideCampaign,
  guardFromIndexes,
  capCuts,
  FLOOR_DAILY_MYR,
  OBSERVE_DAYS,
  ROLLBACK_HOLD_DAYS,
  PROBE_OBSERVE_DAYS,
  SETTLE_HOLD_DAYS,
  RAISE_CAP_OF_BASELINE,
  type CampaignState,
  type GuardSignal,
} from "./autopilot";
import { classifyTermIntent, selectAutoExclusions, shouldAutoExclude } from "./term-rules";

const NOW = new Date("2026-07-20T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000);

const healthy: GuardSignal = { rawIndex: 1.01, adjIndex: 1.0, breach: false };
const breached: GuardSignal = { rawIndex: 0.91, adjIndex: 0.93, breach: true };

const campaign = (over: Partial<CampaignState> = {}): CampaignState => ({
  campaignId: "c1",
  campaignName: "Celsius Test",
  outletId: "o1",
  dailyBudgetMyr: 100,
  baselineDailyMyr: 100,
  efficiencyRatio: 1.0,
  lastApplied: null,
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
    expect(guardFromIndexes(null, [1, 1])).toEqual({ rawIndex: null, adjIndex: null, breach: false });
  });
});

describe("decideCampaign", () => {
  it("never cuts without a revenue guard", () => {
    const d = decideCampaign(campaign({ outletId: null }), healthy, NOW);
    expect(d.action).toBe("hold");
  });

  it("cuts 8% when healthy, observed, and efficient", () => {
    const d = decideCampaign(campaign(), healthy, NOW);
    expect(d.action).toBe("cut");
    expect(d.newDailyMyr).toBe(92);
  });

  it("cuts 12% when cost/conv is far off fleet-best", () => {
    const d = decideCampaign(campaign({ efficiencyRatio: 1.5 }), healthy, NOW);
    expect(d.action).toBe("cut");
    expect(d.newDailyMyr).toBe(88);
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
    const lift: GuardSignal = { rawIndex: 1.06, adjIndex: 1.05, breach: false };
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

  it("only own-brand and non-cafe food auto-exclude", () => {
    expect(shouldAutoExclude("own_brand")).toBe(true);
    expect(shouldAutoExclude("non_cafe_food")).toBe(true);
    expect(shouldAutoExclude("competitor_brand")).toBe(false);
    expect(shouldAutoExclude("dessert_bakery")).toBe(false);
    expect(shouldAutoExclude("cafe_intent")).toBe(false);
    expect(shouldAutoExclude("other")).toBe(false);
  });

  it("selectAutoExclusions respects min cost, prior decisions, and the per-campaign cap", () => {
    const spend = [
      { campaignId: "c1", searchTerm: "restaurants near me", costMyr: 72 },
      { campaignId: "c1", searchTerm: "food near me", costMyr: 14.5 },
      { campaignId: "c1", searchTerm: "Celsius Coffee", costMyr: 5 },
      { campaignId: "c1", searchTerm: "nasi ayam", costMyr: 1.2 }, // below min cost
      { campaignId: "c1", searchTerm: "cafe near me", costMyr: 110 }, // cafe intent — never
      { campaignId: "c1", searchTerm: "kedai makan near me", costMyr: 7.9 },
    ];
    const decided = new Set(["c1 food near me"]); // human already decided (any status)
    const picked = selectAutoExclusions(spend, decided, { maxPerCampaign: 2 });
    expect(picked.map((p) => p.searchTerm)).toEqual(["restaurants near me", "kedai makan near me"]);
  });
});
