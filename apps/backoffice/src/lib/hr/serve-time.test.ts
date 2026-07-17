import { describe, it, expect } from "vitest";
import { calibrateRate, BARISTA_SERVE_TARGET_MIN, KITCHEN_SERVE_TARGET_MIN, MIN_SERVE_SAMPLE } from "./serve-time";

// Base rates and clamps mirror the generator's wiring.
const BARISTA = { baseRate: 8, targetMin: BARISTA_SERVE_TARGET_MIN, floor: 4, cap: 14 };
const KITCHEN = { baseRate: 6, targetMin: KITCHEN_SERVE_TARGET_MIN, floor: 3, cap: 8 };
const SAMPLE = MIN_SERVE_SAMPLE * 4;

describe("calibrateRate", () => {
  it("breach: kitchen p90 20min vs 15 target cuts the rate proportionally → more heads", () => {
    const c = calibrateRate({ ...KITCHEN, p90ServeMin: 20, sample: SAMPLE });
    expect(c.reason).toBe("breach");
    expect(c.rate).toBeCloseTo(4.5, 1); // 6 × (15/20)
    expect(c.rate).toBeLessThan(KITCHEN.baseRate);
  });

  it("breach: barista p90 25min vs 10 target hits the 0.6 factor clamp, not below", () => {
    const c = calibrateRate({ ...BARISTA, p90ServeMin: 25, sample: SAMPLE });
    expect(c.factor).toBe(0.6); // 10/25 = 0.4 → clamped
    expect(c.rate).toBeCloseTo(4.8, 1);
    expect(c.rate).toBeGreaterThanOrEqual(BARISTA.floor);
  });

  it("comfortable: p90 well under target nudges the rate up ~10% (leaner)", () => {
    const c = calibrateRate({ ...BARISTA, p90ServeMin: 6, sample: SAMPLE }); // ≤ 70% of 10
    expect(c.reason).toBe("comfortable");
    expect(c.rate).toBeCloseTo(8.8, 1);
  });

  it("deadband: p90 between 70% and 100% of target leaves the rate alone (no flapping)", () => {
    const c = calibrateRate({ ...KITCHEN, p90ServeMin: 13, sample: SAMPLE }); // 87% of 15
    expect(c.reason).toBe("on-target");
    expect(c.rate).toBe(KITCHEN.baseRate);
  });

  it("thin sample or no measurement → base rate stands", () => {
    expect(calibrateRate({ ...KITCHEN, p90ServeMin: 40, sample: MIN_SERVE_SAMPLE - 1 }).rate).toBe(KITCHEN.baseRate);
    expect(calibrateRate({ ...BARISTA, p90ServeMin: null, sample: SAMPLE }).rate).toBe(BARISTA.baseRate);
    expect(calibrateRate({ ...BARISTA, p90ServeMin: 0, sample: SAMPLE }).reason).toBe("no-data");
  });

  it("result always respects the [floor, cap] clamps", () => {
    // Extreme breach can't go below floor…
    expect(calibrateRate({ ...KITCHEN, baseRate: 4, p90ServeMin: 60, sample: SAMPLE }).rate).toBeGreaterThanOrEqual(KITCHEN.floor);
    // …and comfort can't exceed the cap.
    expect(calibrateRate({ ...BARISTA, baseRate: 13.5, p90ServeMin: 5, sample: SAMPLE }).rate).toBeLessThanOrEqual(BARISTA.cap);
  });
});
