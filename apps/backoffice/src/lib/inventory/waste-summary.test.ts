import { describe, it, expect } from "vitest";
import { summariseWaste, type WasteRow } from "./waste-summary";

const now = Date.parse("2026-11-17T04:00:00Z"); // 12 PM MYT, 17 Nov
const r = (iso: string, product: string, cost: number | null, reason: string | null = null): WasteRow => ({ product, costAmount: cost, reason, createdAt: iso });

describe("waste key numbers", () => {
  const rows = [
    r("2026-11-16T03:00:00Z", "Fresh milk", 40, "Expired"),
    r("2026-11-15T03:00:00Z", "Croissant", 25, "Quality Issue"),
    r("2026-11-12T03:00:00Z", "Fresh milk", 35, "Expired"),
    r("2026-11-08T03:00:00Z", "Fresh milk", 50, "Spillage"),   // previous 7 days
    r("2026-10-20T03:00:00Z", "Syrup", 30, "Breakage"),         // last month
    r("2026-11-14T03:00:00Z", "Cups", null, null),              // no cost recorded
  ];
  const s = summariseWaste(rows, now);

  it("compares the last 7 days with the 7 before", () => {
    expect(s.last7).toBe(100);
    expect(s.prev7).toBe(50);
    expect(s.change7).toBeCloseTo(1);
  });
  it("totals this month and last month in Malaysia time", () => {
    expect(s.thisMonth).toBe(150);
    expect(s.lastMonth).toBe(30);
  });
  it("names the top reason and item of the last 7 days", () => {
    expect(s.topReason).toEqual({ reason: "Expired", amount: 75, share: 0.75 });
    expect(s.topItem).toEqual({ product: "Fresh milk", amount: 75 });
  });
  it("has no change and no tops when there is nothing to compare", () => {
    const e = summariseWaste([], now);
    expect(e.change7).toBeNull();
    expect(e.topReason).toBeNull();
    expect(e.topItem).toBeNull();
  });
});
