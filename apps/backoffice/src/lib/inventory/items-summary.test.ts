import { describe, it, expect } from "vitest";
import { summariseItems } from "./items-summary";

const item = (group: string, freq: string, shelf: number | null, suppliers: string[]) =>
  ({ group, checkFrequency: freq, shelfLifeDays: shelf, suppliers: suppliers.map((name) => ({ name })) });

describe("summariseItems", () => {
  it("does not count the ad-hoc placeholder as a supplier", () => {
    const s = summariseItems([item("Dairy", "DAILY", 7, ["Ad-hoc Purchase"]), item("Dairy", "WEEKLY", null, ["Dutch Lady", "Ad-hoc Purchase"])]);
    expect(s.noSupplier).toBe(1);
    expect(s.oneSupplier).toBe(1);
  });

  it("counts groups, check frequency and missing shelf life", () => {
    const s = summariseItems([item("Dairy", "DAILY", 7, ["A", "B"]), item("Syrup", "MONTHLY", null, ["A"]), item("Syrup", "WEEKLY", 0, [])]);
    expect(s).toMatchObject({ total: 3, groups: 2, daily: 1, weekly: 1, noShelfLife: 2, noSupplier: 1, oneSupplier: 1 });
  });
});
