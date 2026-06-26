import { describe, it, expect } from "vitest";
import { toBaseQty, buildVarianceRow, round2 } from "./usage-variance";

describe("toBaseQty", () => {
  const conv = new Map<string, number>([["pkg-1L", 1000]]);
  it("multiplies package qty by conversion factor", () => {
    expect(toBaseQty(2, "pkg-1L", conv)).toBe(2000); // 2 × 1L = 2000 ml
  });
  it("leaves base-unit (null package) qty untouched", () => {
    expect(toBaseQty(500, null, conv)).toBe(500);
    expect(toBaseQty(500, undefined, conv)).toBe(500);
  });
  it("falls back to 1× when conversion is missing or invalid", () => {
    expect(toBaseQty(7, "pkg-unknown", conv)).toBe(7);
    expect(toBaseQty(7, "pkg-zero", new Map([["pkg-zero", 0]]))).toBe(7);
  });
});

describe("buildVarianceRow", () => {
  it("computes a positive (over-used) variance and costs it", () => {
    // expected 5000 g, actual 5400 g, cost RM0.035/g
    const r = buildVarianceRow({
      productId: "p1", productName: "Beans", baseUom: "g",
      actualQty: 5400, expectedQty: 5000, costPerBase: 0.035,
    });
    expect(r.varianceQty).toBe(400);
    expect(r.expectedCost).toBe(175); // 5000 × 0.035
    expect(r.varianceCost).toBe(14); // 400 × 0.035
    expect(r.variancePercent).toBe(8); // 14 / 175
    expect(r.flags).toContain("OVER_USED");
    expect(r.flags).toContain("HIGH_VARIANCE"); // 8% ≥ 5%
  });

  it("flags NO_COST when costPerBase is zero and leaves percent null on zero expected", () => {
    const r = buildVarianceRow({
      productId: "p2", productName: "Mystery", baseUom: "g",
      actualQty: 100, expectedQty: 0, costPerBase: 0,
    });
    expect(r.flags).toContain("NO_COST");
    expect(r.variancePercent).toBeNull(); // expectedCost 0 → undefined %
    expect(r.varianceCost).toBe(0);
  });

  it("marks under-used and does not flag a small variance", () => {
    const r = buildVarianceRow({
      productId: "p3", productName: "Milk", baseUom: "ml",
      actualQty: 9900, expectedQty: 10000, costPerBase: 0.002,
    });
    expect(r.varianceQty).toBe(-100);
    expect(r.flags).toContain("UNDER_USED");
    expect(r.flags).not.toContain("HIGH_VARIANCE"); // 1% and RM0.20
  });
});

describe("round2", () => {
  it("rounds to two decimals", () => {
    expect(round2(1.005 * 100)).toBe(100.5);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});
