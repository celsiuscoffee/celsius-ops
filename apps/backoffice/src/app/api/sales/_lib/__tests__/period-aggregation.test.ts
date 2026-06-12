import { describe, it, expect } from "vitest";
import {
  bucketEventsIntoPeriods,
  aggregatePeriod,
  formatPeriodLabel,
  type CompareEvent,
} from "../period-aggregation";

// Characterization tests for the /api/sales/compare math — these pin
// CURRENT behavior (including its quirks) so the data layer can move
// to SQL with this suite as the acceptance gate.

const ev = (ts: string, total: number, channel: CompareEvent["channel"] = "dine_in"): CompareEvent => ({
  ts,
  total,
  channel,
});

describe("bucketEventsIntoPeriods — MYT bucketing", () => {
  it("converts UTC timestamps to MYT date and hour (the midnight trap)", () => {
    // 17:30 UTC = 01:30 MYT the NEXT day.
    const [b] = bucketEventsIntoPeriods(
      [ev("2026-06-10T17:30:00Z", 10)],
      [{ from: "2026-06-11", to: "2026-06-11" }],
    );
    expect(b.txns).toHaveLength(1);
    expect(b.txns[0].dateStr).toBe("2026-06-11");
    expect(b.txns[0].hour).toBe(1);
  });

  it("the same UTC event does NOT land on its UTC date", () => {
    const [b] = bucketEventsIntoPeriods(
      [ev("2026-06-10T17:30:00Z", 10)],
      [{ from: "2026-06-10", to: "2026-06-10" }],
    );
    expect(b.txns).toHaveLength(0);
  });

  it("accepts +08:00 offsets directly", () => {
    const [b] = bucketEventsIntoPeriods(
      [ev("2026-06-10T09:15:00+08:00", 10)],
      [{ from: "2026-06-10", to: "2026-06-10" }],
    );
    expect(b.txns[0].dateStr).toBe("2026-06-10");
    expect(b.txns[0].hour).toBe(9);
  });

  it("period bounds are inclusive on both ends", () => {
    const events = [ev("2026-06-10T10:00:00+08:00", 1), ev("2026-06-12T10:00:00+08:00", 2)];
    const [b] = bucketEventsIntoPeriods(events, [{ from: "2026-06-10", to: "2026-06-12" }]);
    expect(b.txns).toHaveLength(2);
  });

  it("overlapping periods each receive the event (comparison semantics)", () => {
    const buckets = bucketEventsIntoPeriods(
      [ev("2026-06-10T10:00:00+08:00", 10)],
      [
        { from: "2026-06-01", to: "2026-06-30" },
        { from: "2026-06-10", to: "2026-06-10" },
      ],
    );
    expect(buckets[0].txns).toHaveLength(1);
    expect(buckets[1].txns).toHaveLength(1);
  });
});

describe("aggregatePeriod", () => {
  // One MYT day: breakfast dine-in 10.50, breakfast takeaway 8.00,
  // lunch delivery 25.25, and a 23:xx supper-after-hours sale 5.00
  // that belongs to NO round.
  const dayEvents = [
    ev("2026-06-10T09:05:00+08:00", 10.5, "dine_in"),
    ev("2026-06-10T09:40:00+08:00", 8.0, "takeaway"),
    ev("2026-06-10T12:30:00+08:00", 25.25, "delivery"),
    ev("2026-06-10T23:10:00+08:00", 5.0, "dine_in"),
  ];
  const [bucket] = bucketEventsIntoPeriods(dayEvents, [{ from: "2026-06-10", to: "2026-06-10" }]);
  const agg = aggregatePeriod(bucket);

  it("summary: revenue, orders, AOV (2dp rounding)", () => {
    expect(agg.summary).toEqual({ revenue: 48.75, orders: 4, aov: 12.19 }); // 48.75/4 = 12.1875 → 12.19
  });

  it("rounds: per-round revenue/orders/aov with channel splits", () => {
    const breakfast = agg.rounds.find((r) => r.key === "breakfast")!;
    expect(breakfast.revenue).toBe(18.5);
    expect(breakfast.orders).toBe(2);
    expect(breakfast.aov).toBe(9.25);
    expect(breakfast.channels.dineIn).toEqual({ revenue: 10.5, orders: 1 });
    expect(breakfast.channels.takeaway).toEqual({ revenue: 8, orders: 1 });

    const lunch = agg.rounds.find((r) => r.key === "lunch")!;
    expect(lunch).toMatchObject({ revenue: 25.25, orders: 1, aov: 25.25 });
    expect(lunch.channels.delivery).toEqual({ revenue: 25.25, orders: 1 });
  });

  it("INHERITED QUIRK: 23:00–07:59 sales count in summary but in NO round", () => {
    const roundRevenue = agg.rounds.reduce((s, r) => s + r.revenue, 0);
    expect(roundRevenue).toBe(43.75); // summary 48.75 minus the 23:10 sale
    expect(agg.hourly[23]).toEqual({ hour: 23, revenue: 5, orders: 1 }); // still in hourly
    expect(agg.dailyTotals[0].revenue).toBe(48.75); // and in the daily total
  });

  it("channel totals across the period", () => {
    expect(agg.channels.dineIn).toEqual({ revenue: 15.5, orders: 2 });
    expect(agg.channels.takeaway).toEqual({ revenue: 8, orders: 1 });
    expect(agg.channels.delivery).toEqual({ revenue: 25.25, orders: 1 });
  });

  it("hourly bins: 24 entries, sales in their MYT hour", () => {
    expect(agg.hourly).toHaveLength(24);
    expect(agg.hourly[9]).toEqual({ hour: 9, revenue: 18.5, orders: 2 });
    expect(agg.hourly[12]).toEqual({ hour: 12, revenue: 25.25, orders: 1 });
    expect(agg.hourly[0].revenue).toBe(0);
  });

  it("dailyTotals zero-fill every date in the period", () => {
    const [b3] = bucketEventsIntoPeriods(
      [ev("2026-06-11T10:00:00+08:00", 12)],
      [{ from: "2026-06-10", to: "2026-06-12" }],
    );
    const a3 = aggregatePeriod(b3);
    expect(a3.dailyTotals.map((d) => d.date)).toEqual(["2026-06-10", "2026-06-11", "2026-06-12"]);
    expect(a3.dailyTotals[0]).toMatchObject({ revenue: 0, orders: 0 });
    expect(a3.dailyTotals[1]).toMatchObject({ revenue: 12, orders: 1 });
    const brunch = a3.dailyTotals[1].rounds.find((r) => r.key === "brunch")!;
    expect(brunch).toEqual({ key: "brunch", revenue: 12, orders: 1 });
    expect(a3.dailyTotals[2].rounds.every((r) => r.revenue === 0 && r.orders === 0)).toBe(true);
  });

  it("empty period → zeroed shape, aov 0, dates still listed", () => {
    const a = aggregatePeriod({ from: "2026-06-01", to: "2026-06-02", txns: [] });
    expect(a.summary).toEqual({ revenue: 0, orders: 0, aov: 0 });
    expect(a.rounds.every((r) => r.revenue === 0 && r.orders === 0 && r.aov === 0)).toBe(true);
    expect(a.dailyTotals).toHaveLength(2);
  });

  it("floating-point revenue sums round at the edges only", () => {
    const [b] = bucketEventsIntoPeriods(
      [ev("2026-06-10T10:00:00+08:00", 0.1), ev("2026-06-10T10:30:00+08:00", 0.2)],
      [{ from: "2026-06-10", to: "2026-06-10" }],
    );
    const a = aggregatePeriod(b);
    expect(a.summary.revenue).toBe(0.3); // not 0.30000000000000004
    expect(a.summary.aov).toBe(0.15);
  });
});

describe("formatPeriodLabel", () => {
  it("single day → 'Tue 7 Apr'", () => {
    expect(formatPeriodLabel("2026-04-07", "2026-04-07")).toBe("Tue 7 Apr");
  });

  it("full calendar month → 'Apr 2026'", () => {
    expect(formatPeriodLabel("2026-04-01", "2026-04-30")).toBe("Apr 2026");
  });

  it("same-month range → '7-13 Apr'", () => {
    expect(formatPeriodLabel("2026-04-07", "2026-04-13")).toBe("7-13 Apr");
  });

  it("cross-month range → '28 Mar - 3 Apr'", () => {
    expect(formatPeriodLabel("2026-03-28", "2026-04-03")).toBe("28 Mar - 3 Apr");
  });
});
