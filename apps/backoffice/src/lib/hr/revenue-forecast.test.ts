import { describe, it, expect } from "vitest";
import { buildWeekForecast } from "./revenue-forecast";

// Target week: Mon 2026-07-20 … Sun 2026-07-26.
const WEEK = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25", "2026-07-26"];

// 28 days of history ending the day before the week (2026-06-22 … 2026-07-19).
function history(revenueFor: (date: string, dow: number, weeksBack: number) => number) {
  const out: Array<{ date: string; revenue: number }> = [];
  const startMs = Date.parse("2026-07-20T00:00:00Z");
  for (let back = 1; back <= 28; back++) {
    const d = new Date(startMs - back * 86400000);
    const date = d.toISOString().slice(0, 10);
    const weeksBack = Math.ceil(back / 7);
    out.push({ date, revenue: revenueFor(date, d.getUTCDay(), weeksBack) });
  }
  return out;
}

describe("buildWeekForecast", () => {
  it("flat history → each day forecasts that level; weekly = 7×", () => {
    const r = buildWeekForecast({ weekDates: WEEK, history: history(() => 100), holidays: [] });
    for (const d of r.byDate) expect(d.forecast).toBeCloseTo(100, 5);
    expect(r.weekly).toBeCloseTo(700, 4);
    expect(r.byDate.every((d) => d.basis === "weekday-history")).toBe(true);
  });

  it("recency weighting follows a rising trend (above the flat mean, below the peak)", () => {
    // Oldest→newest weeks: 50,100,150,200. Flat mean = 125; recency-weighted ≈ 146.
    const rev = (_date: string, _dow: number, weeksBack: number) => [0, 200, 150, 100, 50][weeksBack];
    const r = buildWeekForecast({ weekDates: WEEK, history: history(rev), holidays: [] });
    const mon = r.byDate.find((d) => d.date === "2026-07-20")!;
    expect(mon.forecast).toBeGreaterThan(135);
    expect(mon.forecast).toBeLessThan(160);
  });

  it("weekend vs weekday is reflected per day", () => {
    const rev = (_d: string, dow: number) => (dow === 0 || dow === 6 ? 300 : 100);
    const r = buildWeekForecast({ weekDates: WEEK, history: history(rev), holidays: [] });
    expect(r.byDate.find((d) => d.date === "2026-07-25")!.forecast).toBeCloseTo(300, 4); // Sat
    expect(r.byDate.find((d) => d.date === "2026-07-26")!.forecast).toBeCloseTo(300, 4); // Sun
    expect(r.byDate.find((d) => d.date === "2026-07-22")!.forecast).toBeCloseTo(100, 4); // Wed
  });

  it("a holiday spike in history does NOT inflate that weekday's normal baseline", () => {
    // Every day 100, except one Tuesday in history is a holiday with a 1000 spike.
    const holDate = "2026-07-14"; // a Tuesday in the window
    const rev = (date: string) => (date === holDate ? 1000 : 100);
    const r = buildWeekForecast({ weekDates: WEEK, history: history(rev), holidays: [{ date: holDate, name: "Spike" }] });
    const tue = r.byDate.find((d) => d.date === "2026-07-21")!; // target-week Tuesday (not a holiday)
    expect(tue.isHoliday).toBe(false);
    expect(tue.forecast).toBeCloseTo(100, 4); // baseline unpolluted by the spike
  });

  it("a holiday in the target week is scaled by the historical holiday ratio", () => {
    // Baseline 100 every day; the one history holiday ran at 200 → ratio ≈ 2.
    const histHol = "2026-07-14";
    const rev = (date: string) => (date === histHol ? 200 : 100);
    const targetHol = "2026-07-23"; // Thursday in the target week
    const r = buildWeekForecast({
      weekDates: WEEK,
      history: history(rev),
      holidays: [{ date: histHol, name: "Past PH" }, { date: targetHol, name: "Upcoming PH" }],
    });
    const thu = r.byDate.find((d) => d.date === targetHol)!;
    expect(thu.isHoliday).toBe(true);
    expect(thu.basis).toBe("holiday-adjusted");
    expect(thu.forecast).toBeGreaterThan(170); // ~200, well above the 100 normal
    expect(r.holidayNote).toContain("Upcoming PH");
  });

  it("no history → zeros flagged as no-history", () => {
    const r = buildWeekForecast({ weekDates: WEEK, history: [], holidays: [] });
    expect(r.weekly).toBe(0);
    expect(r.byDate.every((d) => d.basis === "no-history" && d.forecast === 0)).toBe(true);
  });
});
