import { describe, it, expect } from "vitest";
import { hourProfile, DEAD_HOURS, AD_WINDOW, errMessage } from "./sync-ad-creative";

// The 2026-07-29 run wrote ZERO rows for all three campaigns with
// "Cannot read properties of undefined (reading 'slice')". google-ads-api
// rejects with { errors: [{ message }] } and no top-level .message, so
// (err as Error).message.slice() threw INSIDE the catch block, escaped the
// per-kind handler, and one unavailable resource killed the whole campaign.
// The error path is the one path that must never throw.
describe("errMessage", () => {
  it("reads the google-ads-api shape that broke the first run", () => {
    const err = { errors: [{ message: "Metric not found" }, { message: "Bad field" }] };
    expect(errMessage(err)).toBe("Metric not found | Bad field");
  });

  it("never throws on a value with no .message", () => {
    expect(() => errMessage({ weird: true })).not.toThrow();
    expect(() => errMessage(undefined)).not.toThrow();
    expect(() => errMessage(null)).not.toThrow();
    expect(() => errMessage("plain string")).not.toThrow();
    expect(() => errMessage(42)).not.toThrow();
  });

  it("still handles an ordinary Error", () => {
    expect(errMessage(new Error("boom"))).toBe("boom");
  });

  it("survives a circular object rather than throwing while reporting", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => errMessage(circular)).not.toThrow();
    expect(errMessage(circular)).toBeTruthy();
  });

  it("truncates so one huge payload cannot bloat the sync log", () => {
    expect(errMessage(new Error("x".repeat(1000))).length).toBe(300);
  });

  it("always returns a non-empty string", () => {
    for (const v of [undefined, null, {}, [], 0, "", NaN]) {
      expect(errMessage(v).length).toBeGreaterThan(0);
    }
  });
});

// Owner-approved serving window, 2026-07-29. Distinct from DEAD_HOURS: that is
// "the till is provably silent"; this is "still worth buying a click", which
// needs a conversion runway for the customer to decide and travel.
describe("AD_WINDOW", () => {
  it("opens 07:30 — before the 07:46 first sale, so ads reach people on the way in", () => {
    expect(AD_WINDOW.startHour).toBe(7);
    expect(AD_WINDOW.startMinute).toBe(30);
  });

  it("closes 22:00, NOT 21:30 — 21:30-22:29 still carries ~RM12.2k of trade", () => {
    expect(AD_WINDOW.endHour).toBe(22);
    expect(AD_WINDOW.endMinute).toBe(0);
  });

  it("stops before the real 22:30 cliff (62 -> 13 -> 1 txns per 15 min)", () => {
    // A 30-minute runway: an ad at 21:59 can still yield a 22:15 arrival.
    expect(AD_WINDOW.endHour * 60 + AD_WINDOW.endMinute).toBeLessThan(22 * 60 + 30);
  });
});

// The dead window is measured from the till, not from Outlet.openTime/closeTime.
// Config says 08:00-22:00; the tills say first sale ~07:46, last ~22:47, and the
// 22:00 hour carries 184 real transactions. Only 23:00-06:59 is provably dead.
describe("DEAD_HOURS", () => {
  it("excludes 07:00 and 22:00 — both are trading hours in the till data", () => {
    expect(DEAD_HOURS).not.toContain(7);
    expect(DEAD_HOURS).not.toContain(22);
  });
  it("covers exactly the eight hours with zero recorded transactions", () => {
    expect([...DEAD_HOURS].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 23]);
  });
});

describe("hourProfile", () => {
  const row = (hour: number, costMyr: number) => ({ hour, costMyr, clicks: 1, impressions: 10 });

  it("prices the dead window so the schedule fix can be justified or dropped", () => {
    const p = hourProfile([row(3, 2), row(4, 1), row(13, 40), row(22, 7)], 7);
    expect(p.deadCostMyr).toBe(3);
    expect(p.totalCostMyr).toBe(50);
    expect(p.deadPct).toBe(6);
    expect(p.deadCostPerDayMyr).toBe(0.43);
  });

  it("reports zero — the honest answer when nobody searches at 3am", () => {
    const p = hourProfile([row(9, 20), row(14, 30)], 7);
    expect(p.deadCostMyr).toBe(0);
    expect(p.deadPct).toBe(0);
  });

  it("counts 22:00 spend as LIVE, not dead — the error the config would have caused", () => {
    const p = hourProfile([row(22, 12)], 7);
    expect(p.deadCostMyr).toBe(0);
    expect(p.byHour[22].costMyr).toBe(12);
  });

  it("keeps all 24 slots and ignores unparseable hours", () => {
    const p = hourProfile([row(-1, 99), row(10, 5)], 7);
    expect(Object.keys(p.byHour)).toHaveLength(24);
    expect(p.totalCostMyr).toBe(5);
  });

  it("does not divide by zero on an empty window", () => {
    const p = hourProfile([], 0);
    expect(p.deadCostPerDayMyr).toBe(0);
    expect(p.deadPct).toBe(0);
  });
});
