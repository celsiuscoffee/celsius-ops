import { describe, it, expect } from "vitest";
import {
  baseQtyByProduct,
  countDiscrepancies,
  isCleanCount,
  evaluateCountCoverage,
  evaluateCountFreshness,
  evaluateCountSchedule,
  isMeaningfulVariance,
  findProductVariances,
} from "../stock-count";

describe("evaluateCountFreshness", () => {
  const start = "2026-07-29T10:00:00Z";
  const plus = (h: number) => new Date(Date.parse(start) + h * 3_600_000).toISOString();

  it("passes a count finished the same session", () => {
    const r = evaluateCountFreshness({ createdAt: start, now: plus(3) });
    expect(r.stale).toBe(false);
    expect(r.expired).toBe(false);
    expect(r.staleNote).toBeNull();
  });

  it("still passes an evening count closed next morning", () => {
    // 18h window exists precisely so this case isn't punished.
    const r = evaluateCountFreshness({ createdAt: start, now: plus(17) });
    expect(r.stale).toBe(false);
    expect(r.expired).toBe(false);
  });

  it("warns, but does not expire, between 18h and a full day", () => {
    const r = evaluateCountFreshness({ createdAt: start, now: plus(20) });
    expect(r.stale).toBe(true);
    expect(r.expired).toBe(false);
    expect(r.staleNote).toMatch(/stale count/i);
  });

  it("expires a count open more than one day (the owner's rule)", () => {
    expect(evaluateCountFreshness({ createdAt: start, now: plus(24) }).expired).toBe(false);
    expect(evaluateCountFreshness({ createdAt: start, now: plus(25) }).expired).toBe(true);
  });

  it("expires every real Putrajaya case (2, 6, 9 and 25 days open)", () => {
    for (const days of [2, 6, 9, 25]) {
      const r = evaluateCountFreshness({ createdAt: start, now: plus(days * 24) });
      expect(r.expired).toBe(true);
      expect(r.stale).toBe(true);
      expect(r.daysOpen).toBe(days);
    }
  });

  it("reports how long the count was open", () => {
    const r = evaluateCountFreshness({ createdAt: start, now: plus(48) });
    expect(Math.round(r.hoursOpen)).toBe(48);
    expect(r.daysOpen).toBe(2);
    expect(r.staleNote).toMatch(/2d/);
  });

  it("never expires on unparseable dates or clock skew", () => {
    // A finalize must not fail because a clock ran backwards.
    expect(evaluateCountFreshness({ createdAt: "nonsense", now: start }).expired).toBe(false);
    expect(evaluateCountFreshness({ createdAt: plus(5), now: start }).expired).toBe(false);
  });

  it("honours custom windows", () => {
    const r = evaluateCountFreshness({ createdAt: start, now: plus(10), staleHours: 8, expireHours: 9 });
    expect(r.stale).toBe(true);
    expect(r.expired).toBe(true);
  });
});

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

  it("WARNS but never blocks a short DAILY count", () => {
    // The daily sheet is a deliberately short list of fast movers, so a small
    // count is expected, not a defect.
    const daily = evaluateCountCoverage({
      frequency: "DAILY",
      expectedProductIds: universe,
      countedProductIds: universe.slice(0, 10),
    });
    expect(daily.block).toBe(false);
    expect(daily.warn).toBe(true);
  });

  it("BLOCKS a short WEEKLY count — weekly is a full census too", () => {
    // Since 2026-08-06 the weekly sheet lists every product, so a 5/212 weekly
    // is as wrong as a short monthly and must not slip through with a warning.
    const weekly = evaluateCountCoverage({
      frequency: "WEEKLY",
      expectedProductIds: universe,
      countedProductIds: universe.slice(0, 5),
    });
    expect(weekly.block).toBe(true);
    expect(weekly.warn).toBe(false);
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

describe("evaluateCountSchedule", () => {
  // 2026-08-06 is a Thursday; 2026-08-31 is the last day of August.
  const on = (frequency: "DAILY" | "WEEKLY" | "MONTHLY", date: string) =>
    evaluateCountSchedule({ frequency, date });

  it("never flags a daily count — the daily sheet runs every day", () => {
    expect(on("DAILY", "2026-08-03T04:00:00Z").offSchedule).toBe(false);
    expect(on("DAILY", "2026-08-31T04:00:00Z").offSchedule).toBe(false);
  });

  it("passes a weekly count on Thursday, flags every other weekday", () => {
    expect(on("WEEKLY", "2026-08-06T04:00:00Z").onSchedule).toBe(true); // Thu
    expect(on("WEEKLY", "2026-08-03T04:00:00Z").offSchedule).toBe(true); // Mon
    expect(on("WEEKLY", "2026-08-08T04:00:00Z").offSchedule).toBe(true); // Sat
  });

  it("passes a monthly count on the last day of the month or the 1st", () => {
    expect(on("MONTHLY", "2026-08-31T04:00:00Z").onSchedule).toBe(true); // last day
    expect(on("MONTHLY", "2026-09-01T04:00:00Z").onSchedule).toBe(true); // grace day
    expect(on("MONTHLY", "2026-02-28T04:00:00Z").onSchedule).toBe(true); // short month
  });

  it("flags the counts that caused this guard — 3, 4 and 5 August monthlies", () => {
    for (const d of ["2026-08-03T04:00:00Z", "2026-08-04T03:59:00Z", "2026-08-05T16:00:00Z"]) {
      const r = on("MONTHLY", d);
      expect(r.offSchedule).toBe(true);
      expect(r.offScheduleNote).toContain("off-schedule");
    }
  });

  it("asks the weekday question in Malaysian time, not UTC", () => {
    // 2026-08-06T17:00Z is Fri 01:00 in Kuala Lumpur — a Thursday-evening count
    // in UTC terms, but the store's Friday. It must read as off-schedule.
    expect(on("WEEKLY", "2026-08-06T17:00:00Z").offSchedule).toBe(true);
    // 2026-08-05T20:00Z is Thu 04:00 MYT — the store's Thursday.
    expect(on("WEEKLY", "2026-08-05T20:00:00Z").onSchedule).toBe(true);
  });

  it("treats month-end in local time too", () => {
    // 2026-08-31T18:00Z = 1 Sep 02:00 MYT — still inside the grace day.
    expect(on("MONTHLY", "2026-08-31T18:00:00Z").onSchedule).toBe(true);
    // 2026-09-01T18:00Z = 2 Sep MYT — past it.
    expect(on("MONTHLY", "2026-09-01T18:00:00Z").offSchedule).toBe(true);
  });

  it("passes rather than blocks when the date can't be read", () => {
    const r = evaluateCountSchedule({ frequency: "MONTHLY", date: "not-a-date" });
    expect(r.onSchedule).toBe(true);
    expect(r.offScheduleNote).toBeNull();
  });

  it("honours a configured weekly weekday", () => {
    // Wednesday = 3. 2026-08-05 is a Wednesday.
    expect(evaluateCountSchedule({ frequency: "WEEKLY", date: "2026-08-05T04:00:00Z", weeklyDow: 3 }).onSchedule).toBe(true);
    expect(evaluateCountSchedule({ frequency: "WEEKLY", date: "2026-08-05T04:00:00Z" }).offSchedule).toBe(true);
  });
});

describe("isMeaningfulVariance", () => {
  it("ignores weighing noise on a large balance", () => {
    // 2g out on a 1kg bag is the scale, not shrinkage.
    expect(isMeaningfulVariance(1000, 998)).toBe(false);
  });

  it("flags a gap beyond the 2% band", () => {
    expect(isMeaningfulVariance(1000, 900)).toBe(true);
    expect(isMeaningfulVariance(1000, 1100)).toBe(true);
  });

  it("needs BOTH the band and the absolute floor to be exceeded", () => {
    // 1 unit out of 10 is 10% — over the band, but under the 1-unit floor is
    // where rounding lives, so a difference of exactly 1 stays quiet.
    expect(isMeaningfulVariance(10, 9)).toBe(false);
    expect(isMeaningfulVariance(10, 8)).toBe(true);
  });

  it("does not flag an exact match", () => {
    expect(isMeaningfulVariance(500, 500)).toBe(false);
    expect(isMeaningfulVariance(0, 0)).toBe(false);
  });

  it("flags stock appearing against a zero balance, once past the floor", () => {
    expect(isMeaningfulVariance(0, 0.5)).toBe(false);
    expect(isMeaningfulVariance(0, 5)).toBe(true);
  });

  it("honours a custom tolerance", () => {
    expect(isMeaningfulVariance(1000, 950)).toBe(true);
    expect(isMeaningfulVariance(1000, 950, { tolerance: 0.1 })).toBe(false);
  });
});

describe("findProductVariances", () => {
  const expected = new Map([["a", 1000], ["b", 500], ["c", 20]]);

  it("returns only the products whose gap is meaningful", () => {
    const counted = new Map([["a", 998], ["b", 400], ["c", 20]]);
    const v = findProductVariances(expected, counted);
    expect(v.map((x) => x.productId)).toEqual(["b"]);
    expect(v[0].diff).toBe(-100);
  });

  it("skips products with no baseline — a first count is not a discrepancy", () => {
    const counted = new Map([["a", 1000], ["newProduct", 999]]);
    expect(findProductVariances(expected, counted)).toHaveLength(0);
  });

  it("ignores expected products that were not counted at all", () => {
    // Coverage is the guard for missing products, not variance.
    expect(findProductVariances(expected, new Map([["a", 1000]]))).toHaveLength(0);
  });
});
