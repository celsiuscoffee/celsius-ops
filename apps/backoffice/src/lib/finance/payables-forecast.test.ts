import { describe, it, expect } from "vitest";
import { remainingAmount, expandOccurrences, bucketPayables, type PayableItem } from "./payables-forecast";

describe("remainingAmount", () => {
  it("uses amountPaid as the source of truth when set", () => {
    expect(remainingAmount({ amount: 1000, amountPaid: 400, depositAmount: null, status: "PARTIALLY_PAID" })).toBe(600);
    // amountPaid wins even on DEPOSIT_PAID rows (post-migration shape)
    expect(remainingAmount({ amount: 1000, amountPaid: 300, depositAmount: 300, status: "DEPOSIT_PAID" })).toBe(700);
  });

  it("falls back to depositAmount only for legacy DEPOSIT_PAID rows", () => {
    expect(remainingAmount({ amount: 1000, amountPaid: 0, depositAmount: 250, status: "DEPOSIT_PAID" })).toBe(750);
    // A deposit recorded on a non-deposit status doesn't reduce the balance
    expect(remainingAmount({ amount: 1000, amountPaid: 0, depositAmount: 250, status: "PENDING" })).toBe(1000);
    expect(remainingAmount({ amount: 500, amountPaid: null, depositAmount: null, status: "PENDING" })).toBe(500);
  });

  it("never goes negative on overpayment", () => {
    expect(remainingAmount({ amount: 100, amountPaid: 150, depositAmount: null, status: "PARTIALLY_PAID" })).toBe(0);
  });
});

describe("expandOccurrences", () => {
  it("emits monthly occurrences inside the window", () => {
    const dates = expandOccurrences(
      { nextDueDate: new Date("2026-08-01T00:00:00Z"), cadence: "MONTHLY" },
      "2026-08-01",
      "2026-10-15",
    );
    expect(dates).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
  });

  it("catches up a stale nextDueDate into the window", () => {
    const dates = expandOccurrences(
      { nextDueDate: new Date("2026-03-05T00:00:00Z"), cadence: "MONTHLY" },
      "2026-08-01",
      "2026-09-30",
    );
    expect(dates).toEqual(["2026-08-05", "2026-09-05"]);
  });

  it("respects quarterly and yearly cadences", () => {
    expect(
      expandOccurrences({ nextDueDate: new Date("2026-08-10T00:00:00Z"), cadence: "QUARTERLY" }, "2026-08-01", "2027-02-28"),
    ).toEqual(["2026-08-10", "2026-11-10", "2027-02-10"]);
    expect(
      expandOccurrences({ nextDueDate: new Date("2026-09-01T00:00:00Z"), cadence: "YEARLY" }, "2026-08-01", "2026-12-31"),
    ).toEqual(["2026-09-01"]);
  });

  it("returns nothing when the next due date is past the window", () => {
    expect(
      expandOccurrences({ nextDueDate: new Date("2026-12-01T00:00:00Z"), cadence: "MONTHLY" }, "2026-08-01", "2026-08-31"),
    ).toEqual([]);
  });
});

describe("bucketPayables", () => {
  const item = (over: Partial<PayableItem>): PayableItem => ({
    id: "x", source: "invoice", dueDate: "2026-08-01", payee: "ACME", ref: null,
    category: "ingredients", outletId: null, amount: 100, status: "PENDING", overdue: false,
    ...over,
  });

  it("groups per due day with a category split, sorted by date", () => {
    const byDate = bucketPayables([
      item({ id: "a", dueDate: "2026-08-02", amount: 50, category: "rent" }),
      item({ id: "b", dueDate: "2026-08-01", amount: 100 }),
      item({ id: "c", dueDate: "2026-08-01", amount: 25.5, category: "rent" }),
      item({ id: "d", dueDate: null }), // undated rows never land in a day bucket
    ]);
    expect(byDate.map((d) => d.date)).toEqual(["2026-08-01", "2026-08-02"]);
    expect(byDate[0].total).toBe(125.5);
    expect(byDate[0].count).toBe(2);
    expect(byDate[0].byCategory).toEqual({ ingredients: 100, rent: 25.5 });
    expect(byDate[1].total).toBe(50);
  });
});
