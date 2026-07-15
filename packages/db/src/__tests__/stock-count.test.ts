import { describe, it, expect } from "vitest";
import {
  baseQtyByProduct,
  countDiscrepancies,
  isCleanCount,
  evaluateCountCoverage,
} from "../stock-count";

describe("evaluateCountCoverage", () => {
  const universe = Array.from({ length: 212 }, (_, i) => `p${i}`);

  it("BLOCKS a short monthly census (the Putrajaya 49/212 case)", () => {
    const r = evaluateCountCoverage({
      frequency: "MONTHLY",
      expectedProductIds: universe,
      countedProductIds: universe.slice(0, 49),
    });
    expect(r.expected).toBe(212);
    expect(r.counted).toBe(49);
    expect(r.missing).toBe(163);
    expect(r.belowFloor).toBe(true);
    expect(r.block).toBe(true);
    expect(r.warn).toBe(false);
    expect(r.missingProductIds).toHaveLength(163);
  });

  it("passes a near-complete monthly count (254/255 within tolerance)", () => {
    const full = Array.from({ length: 255 }, (_, i) => `p${i}`);
    const r = evaluateCountCoverage({
      frequency: "MONTHLY",
      expectedProductIds: full,
      countedProductIds: full.slice(0, 254),
    });
    expect(r.belowFloor).toBe(false);
    expect(r.block).toBe(false);
  });

  it("WARNS but never blocks a short daily/weekly count", () => {
    const daily = evaluateCountCoverage({
      frequency: "DAILY",
      expectedProductIds: universe,
      countedProductIds: universe.slice(0, 10),
    });
    expect(daily.block).toBe(false);
    expect(daily.warn).toBe(true);

    const weekly = evaluateCountCoverage({
      frequency: "WEEKLY",
      expectedProductIds: universe,
      countedProductIds: universe.slice(0, 5),
    });
    expect(weekly.block).toBe(false);
    expect(weekly.warn).toBe(true);
  });

  it("passes when there is no baseline to judge against (first-ever count)", () => {
    const r = evaluateCountCoverage({
      frequency: "MONTHLY",
      expectedProductIds: [],
      countedProductIds: ["a", "b", "c"],
    });
    expect(r.expected).toBe(0);
    expect(r.coverage).toBe(1);
    expect(r.block).toBe(false);
    expect(r.warn).toBe(false);
  });

  it("ignores extra counted products not in the expected universe", () => {
    const r = evaluateCountCoverage({
      frequency: "MONTHLY",
      expectedProductIds: ["a", "b", "c", "d"],
      countedProductIds: ["a", "b", "c", "d", "x", "y"], // x,y are new products
    });
    expect(r.coverage).toBe(1);
    expect(r.belowFloor).toBe(false);
  });

  it("respects a custom minCoverage", () => {
    const r = evaluateCountCoverage({
      frequency: "MONTHLY",
      expectedProductIds: ["a", "b", "c", "d"],
      countedProductIds: ["a", "b", "c"], // 75%
      minCoverage: 0.7,
    });
    expect(r.coverage).toBe(0.75);
    expect(r.belowFloor).toBe(false);
  });
});

describe("baseQtyByProduct", () => {
  it("multiplies the counted package qty by its conversion factor", () => {
    // The reported bug: 22 packets of black napkin, 50 pcs per packet.
    // Must store 1100 base units, not a raw 22.
    const totals = baseQtyByProduct([
      { productId: "napkin", countedQty: 22, conversionFactor: 50 },
    ]);
    expect(totals.get("napkin")).toBe(1100);
  });

  it("treats a missing/undefined conversion factor as 1 (base UOM)", () => {
    const totals = baseQtyByProduct([
      { productId: "milk", countedQty: 7 },
      { productId: "sugar", countedQty: 3, conversionFactor: undefined },
    ]);
    expect(totals.get("milk")).toBe(7);
    expect(totals.get("sugar")).toBe(3);
  });

  it("treats a zero or negative conversion factor as 1 (guards bad data)", () => {
    const totals = baseQtyByProduct([
      { productId: "a", countedQty: 4, conversionFactor: 0 },
      { productId: "b", countedQty: 4, conversionFactor: -3 },
    ]);
    expect(totals.get("a")).toBe(4);
    expect(totals.get("b")).toBe(4);
  });

  it("sums multiple package lines for the same product into one base total", () => {
    // Same product counted in two packages: 2 cartons (×24) + 5 bottles (×1).
    const totals = baseQtyByProduct([
      { productId: "cola", countedQty: 2, conversionFactor: 24 },
      { productId: "cola", countedQty: 5, conversionFactor: 1 },
    ]);
    expect(totals.get("cola")).toBe(53);
  });

  it("ignores lines with a null counted qty (not yet counted)", () => {
    const totals = baseQtyByProduct([
      { productId: "x", countedQty: null, conversionFactor: 10 },
    ]);
    expect(totals.has("x")).toBe(false);
  });

  it("accepts Decimal-like string/object quantities and factors", () => {
    const totals = baseQtyByProduct([
      { productId: "y", countedQty: "3", conversionFactor: "12" },
      { productId: "z", countedQty: { toString: () => "1.5" }, conversionFactor: { toString: () => "2" } },
    ]);
    expect(totals.get("y")).toBe(36);
    expect(totals.get("z")).toBe(3);
  });
});

describe("countDiscrepancies / isCleanCount", () => {
  it("flags only counted items whose known baseline differs", () => {
    expect(
      countDiscrepancies([
        { expectedQty: 10, countedQty: 10 }, // match
        { expectedQty: 10, countedQty: 8 }, // variance
        { expectedQty: null, countedQty: 5 }, // no baseline → can't flag
      ]),
    ).toBe(1);
  });

  it("treats a count with no baselines as clean (auto-approve)", () => {
    expect(isCleanCount([{ expectedQty: null, countedQty: 5 }])).toBe(true);
  });
});
