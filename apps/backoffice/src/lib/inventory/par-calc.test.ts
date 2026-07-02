import { describe, it, expect } from "vitest";
import { classifyByDailyValue, VALUE_CLASS_PARAMS } from "./par-calc";

describe("classifyByDailyValue", () => {
  it("splits a spread of items into A/B/C by cumulative daily-value share", () => {
    // 40+40 = 80% → A; 15 → B; 4+1 → C
    const out = classifyByDailyValue([
      { productId: "beans", dailyValue: 40 },
      { productId: "milk", dailyValue: 40 },
      { productId: "syrup", dailyValue: 15 },
      { productId: "cups", dailyValue: 4 },
      { productId: "napkins", dailyValue: 1 },
    ]);
    expect(out).toEqual({ beans: "A", milk: "A", syrup: "B", cups: "C", napkins: "C" });
  });

  it("keeps a dominant item in class A even when it alone exceeds the 80% cut", () => {
    const out = classifyByDailyValue([
      { productId: "beans", dailyValue: 85 },
      { productId: "milk", dailyValue: 10 },
      { productId: "cups", dailyValue: 5 },
    ]);
    // beans carries 85% by itself — judged by the share BEFORE it (0%), so A.
    expect(out.beans).toBe("A");
    expect(out.milk).toBe("B");
    expect(out.cups).toBe("C");
  });

  it("sends zero-value (unpriced) items to C regardless of position", () => {
    const out = classifyByDailyValue([
      { productId: "priced", dailyValue: 10 },
      { productId: "unpriced", dailyValue: 0 },
    ]);
    expect(out.priced).toBe("A");
    expect(out.unpriced).toBe("C");
  });

  it("classifies everything as C when nothing has a value", () => {
    const out = classifyByDailyValue([
      { productId: "a", dailyValue: 0 },
      { productId: "b", dailyValue: 0 },
    ]);
    expect(out).toEqual({ a: "C", b: "C" });
  });

  it("class params keep A coverage tighter than C (the value cap invariant)", () => {
    expect(VALUE_CLASS_PARAMS.A.coverageDays).toBeLessThan(VALUE_CLASS_PARAMS.B.coverageDays);
    expect(VALUE_CLASS_PARAMS.B.coverageDays).toBeLessThan(VALUE_CLASS_PARAMS.C.coverageDays);
    expect(VALUE_CLASS_PARAMS.A.maxLevelMultiplier).toBeLessThan(VALUE_CLASS_PARAMS.C.maxLevelMultiplier);
  });
});
