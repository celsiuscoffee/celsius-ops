import { describe, it, expect } from "vitest";
import {
  monthlyCycleEndMs,
  cycleEndMsFor,
  cycleStillOpen,
  daysRemaining,
  lastEndedCycle,
} from "./cycle-window";

// 15 Sep 2026, 17:40 MYT — the afternoon the owner asked for this block.
const NOW = Date.parse("2026-09-15T09:40:00Z");

describe("monthlyCycleEndMs", () => {
  it("ends a month at the last instant of its last day, in MYT", () => {
    expect(monthlyCycleEndMs(2026, 8)).toBe(Date.parse("2026-08-31T23:59:59+08:00"));
    expect(monthlyCycleEndMs(2026, 9)).toBe(Date.parse("2026-09-30T23:59:59+08:00"));
  });

  it("knows month lengths, February and leap years included", () => {
    expect(monthlyCycleEndMs(2026, 2)).toBe(Date.parse("2026-02-28T23:59:59+08:00"));
    expect(monthlyCycleEndMs(2028, 2)).toBe(Date.parse("2028-02-29T23:59:59+08:00"));
  });

  it("refuses a month it cannot date rather than guessing", () => {
    expect(monthlyCycleEndMs(2026, 0)).toBeNull();
    expect(monthlyCycleEndMs(2026, 13)).toBeNull();
    expect(monthlyCycleEndMs(NaN, 8)).toBeNull();
    expect(monthlyCycleEndMs(2026, 8.5)).toBeNull();
  });
});

describe("cycleStillOpen", () => {
  it("blocks a future month and the month in progress", () => {
    // The whole point: December cannot be computed in September.
    expect(cycleStillOpen(monthlyCycleEndMs(2026, 12), NOW)).toBe(true);
    expect(cycleStillOpen(monthlyCycleEndMs(2026, 10), NOW)).toBe(true);
    expect(cycleStillOpen(monthlyCycleEndMs(2026, 9), NOW)).toBe(true); // in progress
  });

  it("allows a month that has ended", () => {
    expect(cycleStillOpen(monthlyCycleEndMs(2026, 8), NOW)).toBe(false);
    expect(cycleStillOpen(monthlyCycleEndMs(2026, 1), NOW)).toBe(false);
    expect(cycleStillOpen(monthlyCycleEndMs(2025, 12), NOW)).toBe(false);
  });

  it("opens August the instant MYT midnight passes, not 08:00 local", () => {
    const augEnd = monthlyCycleEndMs(2026, 8) as number;
    expect(cycleStillOpen(augEnd, augEnd - 1000)).toBe(true);
    expect(cycleStillOpen(augEnd, augEnd + 1000)).toBe(false);
    // A UTC-based comparison would still block here; MYT does not.
    expect(cycleStillOpen(augEnd, Date.parse("2026-09-01T00:30:00+08:00"))).toBe(false);
  });

  it("never blocks a cycle it cannot date", () => {
    expect(cycleStillOpen(null, NOW)).toBe(false);
  });
});

describe("cycleEndMsFor", () => {
  it("prefers an explicit period_end — that is how weekly runs are dated", () => {
    expect(cycleEndMsFor({ period_end: "2026-08-30" })).toBe(Date.parse("2026-08-30T23:59:59+08:00"));
  });

  it("falls back to month/year for a monthly run", () => {
    expect(cycleEndMsFor({ period_year: 2026, period_month: 8 })).toBe(monthlyCycleEndMs(2026, 8));
  });

  it("returns null when the run carries neither", () => {
    expect(cycleEndMsFor({})).toBeNull();
    expect(cycleEndMsFor({ period_end: null, period_year: null, period_month: null })).toBeNull();
  });
});

describe("daysRemaining", () => {
  it("counts whole days up to the cycle end", () => {
    expect(daysRemaining(monthlyCycleEndMs(2026, 9) as number, NOW)).toBe(16);
  });

  it("never reports 0 days left while the cycle is open", () => {
    // "0 days left" in the error message would read as though it had ended.
    const end = monthlyCycleEndMs(2026, 9) as number;
    expect(daysRemaining(end, end - 1000)).toBe(1);
  });
});

describe("lastEndedCycle", () => {
  it("defaults the picker to the month that just ended, not the current one", () => {
    expect(lastEndedCycle(NOW)).toEqual({ year: 2026, month: 8 });
  });

  it("rolls back across January into the previous year", () => {
    expect(lastEndedCycle(Date.parse("2026-01-10T00:00:00+08:00"))).toEqual({ year: 2025, month: 12 });
  });

  it("uses the MYT date, so it flips on the 1st local", () => {
    // 00:30 MYT on 1 Sep is still 31 Aug in UTC — a UTC-based default would
    // still be pointing at July.
    expect(lastEndedCycle(Date.parse("2026-09-01T00:30:00+08:00"))).toEqual({ year: 2026, month: 8 });
  });
});
