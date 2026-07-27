import { describe, it, expect } from "vitest";
import { planFlexPlacement } from "./flex-placement";

const WEEK = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25", "2026-07-26"];

describe("planFlexPlacement", () => {
  it("spreads two rovers across DIFFERENT busy days instead of stacking them", () => {
    // Thu(23) and Sat(25) are the two busiest; two rovers, 1 day each →
    // one lands on Thu, the other on Sat, never both on the same day.
    const demand = { "2026-07-23": 300, "2026-07-25": 280, "2026-07-20": 100, "2026-07-21": 100, "2026-07-22": 100, "2026-07-24": 100, "2026-07-26": 100 };
    const base = Object.fromEntries(WEEK.map((d) => [d, 5])); // equal FT crew
    const placed = planFlexPlacement({
      flex: [
        { id: "roverA", freeDays: WEEK, budget: 1 },
        { id: "roverB", freeDays: WEEK, budget: 1 },
      ],
      demandByDate: demand,
      baseHeadsByDate: base,
    });
    const days = Object.entries(placed).filter(([, ids]) => ids.length);
    expect(days.length).toBe(2); // two distinct days
    for (const [, ids] of days) expect(ids.length).toBe(1); // never stacked
    expect(new Set(Object.keys(placed))).toEqual(new Set(["2026-07-23", "2026-07-25"]));
  });

  it("fills an under-covered busy day before piling onto an already-staffed one", () => {
    // Thu has lots of demand but is already thick with FT; Sat has less demand
    // but a thin crew → demand-per-head sends the head to Sat.
    const placed = planFlexPlacement({
      flex: [{ id: "afique", freeDays: WEEK, budget: 1 }],
      demandByDate: { "2026-07-23": 300, "2026-07-25": 200 },
      baseHeadsByDate: { "2026-07-23": 10, "2026-07-25": 3 },
    });
    // Sat: 200/4 = 50 vs Thu: 300/11 ≈ 27 → Sat wins.
    expect(placed["2026-07-25"]).toEqual(["afique"]);
    expect(placed["2026-07-23"]).toBeUndefined();
  });

  it("places a shared FT (Afique) up to their budget across their free days", () => {
    const placed = planFlexPlacement({
      flex: [{ id: "afique", freeDays: ["2026-07-20", "2026-07-22", "2026-07-25"], budget: 2 }],
      demandByDate: Object.fromEntries(WEEK.map((d) => [d, 100])),
      baseHeadsByDate: Object.fromEntries(WEEK.map((d) => [d, 4])),
    });
    const total = Object.values(placed).flat().filter((id) => id === "afique").length;
    expect(total).toBe(2); // exactly their budget
    for (const ids of Object.values(placed)) expect(ids.filter((x) => x === "afique").length).toBeLessThanOrEqual(1); // one shift/day
  });

  it("budget 0 places nobody (tight mode drops the flex head)", () => {
    const placed = planFlexPlacement({
      flex: [{ id: "roverA", freeDays: WEEK, budget: 0 }],
      demandByDate: Object.fromEntries(WEEK.map((d) => [d, 100])),
      baseHeadsByDate: Object.fromEntries(WEEK.map((d) => [d, 4])),
    });
    expect(Object.values(placed).flat().length).toBe(0);
  });

  it("never exceeds free days when budget > availability", () => {
    const placed = planFlexPlacement({
      flex: [{ id: "roverA", freeDays: ["2026-07-20"], budget: 2 }],
      demandByDate: { "2026-07-20": 100 },
      baseHeadsByDate: { "2026-07-20": 4 },
    });
    expect(Object.values(placed).flat()).toEqual(["roverA"]); // only the one free day
  });

  it("higher mode budget => more total heads deployed (Tight < Safe)", () => {
    const common = {
      demandByDate: Object.fromEntries(WEEK.map((d) => [d, 100 + Number(d.slice(-1))])),
      baseHeadsByDate: Object.fromEntries(WEEK.map((d) => [d, 5])),
    };
    const tight = planFlexPlacement({ flex: [{ id: "r1", freeDays: WEEK, budget: 1 }, { id: "afique", freeDays: WEEK, budget: 0 }], ...common });
    const safe = planFlexPlacement({ flex: [{ id: "r1", freeDays: WEEK, budget: 2 }, { id: "afique", freeDays: WEEK, budget: 5 }], ...common });
    expect(Object.values(safe).flat().length).toBeGreaterThan(Object.values(tight).flat().length);
  });
});
