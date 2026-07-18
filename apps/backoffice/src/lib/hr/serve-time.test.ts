import { describe, it, expect } from "vitest";
import {
  planningRate,
  describeCapacity,
  CAPACITY_HEADROOM,
  MIN_CAPACITY_SAMPLE_HOURS,
  BARISTA_SERVE_TARGET_MIN,
} from "./serve-time";

// Measured capacity replaces the old p90 proportional controller (owner
// correction 2026-07-17: staff work overlapping — serve targets are latency
// promises, not per-item labour costs). planningRate turns a measured p80
// items-per-clocked-in-head into the roster's planning rate.
describe("planningRate", () => {
  it("plans at 85% of demonstrated capacity when the sample is trustworthy", () => {
    // Putrajaya live shape: barista p80 ≈ 11.1 items/head/hr over 85 hours.
    const p = planningRate({ baseRate: 8, measuredP80: 11.1, sampleHours: 85 });
    expect(p.basis).toBe("measured");
    expect(p.rate).toBeCloseTo(Math.round(11.1 * CAPACITY_HEADROOM * 10) / 10, 5);
    expect(p.rate).toBeGreaterThan(8); // crews proved MORE capable than assumed
  });

  it("falls back to the base rate on a thin sample", () => {
    const p = planningRate({ baseRate: 8, measuredP80: 14, sampleHours: MIN_CAPACITY_SAMPLE_HOURS - 1 });
    expect(p.basis).toBe("base");
    expect(p.rate).toBe(8);
  });

  it("falls back to the base rate when there is no measurement", () => {
    const p = planningRate({ baseRate: 6, measuredP80: null, sampleHours: 0 });
    expect(p.basis).toBe("base");
    expect(p.rate).toBe(6);
  });

  it("a freak-low sample can never drop the rate below 75% of base", () => {
    const p = planningRate({ baseRate: 8, measuredP80: 2, sampleHours: 50 });
    expect(p.rate).toBe(6); // 8 x 0.75
  });

  it("a freak-high sample is capped at 2.5x base", () => {
    const p = planningRate({ baseRate: 6, measuredP80: 40, sampleHours: 50 });
    expect(p.rate).toBe(15); // 6 x 2.5
  });

  it("describeCapacity names the basis honestly", () => {
    const measured = planningRate({ baseRate: 8, measuredP80: 11.1, sampleHours: 85 });
    expect(describeCapacity("barista", measured, BARISTA_SERVE_TARGET_MIN)).toContain("measured 11.1 items/head/hr");
    const base = planningRate({ baseRate: 8, measuredP80: null, sampleHours: 3 });
    expect(describeCapacity("barista", base, BARISTA_SERVE_TARGET_MIN)).toContain("base rate 8/hr");
  });
});
