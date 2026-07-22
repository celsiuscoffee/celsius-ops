import { describe, it, expect } from "vitest";
import { allocateDiscount } from "./ar";
import type { EodChannelSplit } from "../types";

const split = (p: Partial<EodChannelSplit>): EodChannelSplit => ({
  cashQr: 0, card: 0, voucher: 0, grabfood: 0, gastrohub: 0, other: 0, ...p,
});
const sum = (o: Partial<Record<keyof EodChannelSplit, number>>) =>
  Math.round(Object.values(o).reduce((s, v) => s + (v ?? 0), 0) * 100) / 100;

describe("allocateDiscount", () => {
  it("splits in proportion to each channel's sales", () => {
    const out = allocateDiscount(split({ cashQr: 750, card: 250 }), 100);
    expect(out.cashQr).toBe(75);
    expect(out.card).toBe(25);
  });

  it("ties to the discount exactly even when the shares do not divide", () => {
    // 100/3 per channel rounds to 33.33 x3 = 99.99; the residual must land
    // somewhere or the journal's credits would not equal its debits.
    const out = allocateDiscount(split({ cashQr: 100, card: 100, grabfood: 100 }), 100);
    expect(sum(out)).toBe(100);
  });

  it("puts the rounding residual on the largest channel", () => {
    const out = allocateDiscount(split({ cashQr: 100, card: 100, grabfood: 101 }), 100);
    expect(sum(out)).toBe(100);
    expect(out.grabfood).toBeGreaterThan(out.cashQr!);
  });

  it("ignores channels with no sales", () => {
    const out = allocateDiscount(split({ cashQr: 500, card: 0 }), 50);
    expect(out.card).toBeUndefined();
    expect(out.cashQr).toBe(50);
  });

  it("returns nothing when there is no discount or no sales", () => {
    expect(allocateDiscount(split({ cashQr: 500 }), 0)).toEqual({});
    expect(allocateDiscount(split({}), 50)).toEqual({});
  });
});
