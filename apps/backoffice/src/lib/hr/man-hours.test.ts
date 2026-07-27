import { describe, it, expect } from "vitest";
import { computeDailyManHours } from "./man-hours";

// Shared planning inputs for a 12h-open outlet at 18% target, 3-head floor,
// 18 items/man-hour, RM12 blended rate.
const base = {
  itemsPerManHour: 18,
  serviceMinHeads: 3,
  openHours: 12,
  targetPct: 0.18,
  blendedRate: 12,
};

describe("computeDailyManHours", () => {
  it("demand-bound day: required tracks item volume, comfortably affordable", () => {
    // 900 items ÷ 18 = 50h demand; floor 36h → required 50h.
    // Revenue 5000 × 18% ÷ 12 = 75h affordable → gap negative (fits).
    const r = computeDailyManHours({ date: "2026-07-18", forecastItems: 900, forecastRevenue: 5000, ...base });
    expect(r.throughputHours).toBe(50);
    expect(r.floorHours).toBe(36);
    expect(r.requiredHours).toBe(50);
    expect(r.floorBound).toBe(false);
    expect(r.affordableHours).toBe(75);
    expect(r.gapHours).toBeLessThan(0); // affordable > required → both goals met
  });

  it("quiet day: service FLOOR sets the requirement and can't be paid at target", () => {
    // 180 items ÷ 18 = 10h demand, below the 36h floor → required 36h, floorBound.
    // Revenue 1200 × 18% ÷ 12 = 18h affordable → 18h gap (the Tamarind case:
    // the floor, not demand, breaks the budget — a revenue problem).
    const r = computeDailyManHours({ date: "2026-07-14", forecastItems: 180, forecastRevenue: 1200, ...base });
    expect(r.throughputHours).toBe(10);
    expect(r.requiredHours).toBe(36);
    expect(r.floorBound).toBe(true);
    expect(r.affordableHours).toBe(18);
    expect(r.gapHours).toBe(18);
  });

  it("busy but low-ticket: demand exceeds what target revenue pays for", () => {
    // 1260 items ÷ 18 = 70h demand; floor 36h → required 70h, demand-bound.
    // Revenue 4000 × 18% ÷ 12 = 60h affordable → 10h gap: covering the volume
    // costs more than 18% because the average ticket is low.
    const r = computeDailyManHours({ date: "2026-07-19", forecastItems: 1260, forecastRevenue: 4000, ...base });
    expect(r.requiredHours).toBe(70);
    expect(r.floorBound).toBe(false);
    expect(r.affordableHours).toBe(60);
    expect(r.gapHours).toBe(10);
  });

  it("guards divide-by-zero on productivity and blended rate", () => {
    const r = computeDailyManHours({ date: "2026-07-20", forecastItems: 500, forecastRevenue: 3000, ...base, itemsPerManHour: 0, blendedRate: 0 });
    expect(r.throughputHours).toBe(0);
    expect(r.affordableHours).toBe(0);
    expect(r.requiredHours).toBe(r.floorHours); // falls back to the floor
  });
});
