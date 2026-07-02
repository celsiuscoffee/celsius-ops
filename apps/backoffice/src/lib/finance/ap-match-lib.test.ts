import { describe, it, expect } from "vitest";
import { digitRuns, invoiceRefInDesc, subsetSumIdx } from "./ap-match-lib";

describe("ap-match-lib", () => {
  it("extracts digit runs from bank descriptions", () => {
    expect(digitRuns("celsius coffee putracountry bread baker* inv-006545, 006577")).toEqual(["6545", "6577"]);
    expect(digitRuns("yow seng sdn bhd*ysiv-0801")).toEqual(["801"]);
    expect(digitRuns("no digits here")).toEqual([]);
  });

  it("matches invoice numbers against description digit runs", () => {
    const runs = digitRuns("inv 006545, 006577, 006556, 006593");
    expect(invoiceRefInDesc("INV-006545", runs)).toBe(true);
    expect(invoiceRefInDesc("006593", runs)).toBe(true);
    expect(invoiceRefInDesc("INV-999999", runs)).toBe(false);
    // short/absent numbers never confirm
    expect(invoiceRefInDesc("12", runs)).toBe(false);
    expect(invoiceRefInDesc(null, runs)).toBe(false);
  });

  it("finds the invoice subset summing to a combined payment", () => {
    // Country Bread case: one transfer paying 4 invoices
    const cents = [70425, 55010, 88450, 46800, 120000];
    const target = 70425 + 55010 + 46800;
    const idx = subsetSumIdx(cents, target);
    expect(idx).not.toBeNull();
    expect(idx!.map((i) => cents[i]).reduce((a, b) => a + b, 0)).toBe(target);
  });

  it("never returns a single-invoice subset and handles no-solution", () => {
    expect(subsetSumIdx([50000, 30000], 50000)).toBeNull(); // size-1 is the single-match pass's job
    expect(subsetSumIdx([100, 200, 300], 999)).toBeNull();
  });

  it("tolerates 1-2 sen rounding drift", () => {
    const idx = subsetSumIdx([10001, 20001], 30000);
    expect(idx).not.toBeNull();
  });
});
