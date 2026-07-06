import { describe, it, expect } from "vitest";
import { bucketCashGeneratedLines } from "./cashflow";

// Local UTC-safe date builder so the buckets don't depend on the runner's TZ
// for the assertions we care about (day/week grouping).
function d(iso: string): Date {
  return new Date(`${iso}T06:00:00`);
}

describe("bucketCashGeneratedLines", () => {
  const lines = [
    { txnDate: d("2026-07-05"), direction: "CR", amount: 1744.7, account: "2644" },
    { txnDate: d("2026-07-05"), direction: "CR", amount: 2759.48, account: "4384" },
    { txnDate: d("2026-07-05"), direction: "CR", amount: 1108.79, account: "9345" },
    { txnDate: d("2026-07-05"), direction: "DR", amount: 1142.92, account: "2644" },
    { txnDate: d("2026-07-05"), direction: "DR", amount: 512.9, account: "9345" },
    // Prior day in the same ISO week (week of Mon 2026-06-29)
    { txnDate: d("2026-07-01"), direction: "CR", amount: 100, account: "4384" },
    { txnDate: d("2026-07-01"), direction: "DR", amount: 40, account: "4384" },
  ];

  it("sums CR as cash in and DR as cash out per day", () => {
    const byDay = bucketCashGeneratedLines(lines, "DAILY");
    const jul5 = byDay.get("2026-07-05")!;
    expect(round2(jul5.cashIn)).toBe(5612.97);
    expect(round2(jul5.cashOut)).toBe(1655.82);
    expect(jul5.accounts.size).toBe(3);
    const jul1 = byDay.get("2026-07-01")!;
    expect(jul1.cashIn).toBe(100);
    expect(jul1.cashOut).toBe(40);
    expect(jul1.accounts.size).toBe(1);
  });

  it("snaps weekly buckets to the Monday that starts the ISO week", () => {
    const byWeek = bucketCashGeneratedLines(lines, "WEEKLY");
    // 2026-07-05 is a Sunday; 2026-07-01 is a Wednesday. Both fall in the
    // week starting Monday 2026-06-29.
    const week = byWeek.get("2026-06-29")!;
    expect(week).toBeDefined();
    expect(round2(week.cashIn)).toBe(5712.97); // 5612.97 + 100
    expect(round2(week.cashOut)).toBe(1695.82); // 1655.82 + 40
    expect(week.accounts.size).toBe(3);
    // Only one bucket, every line is in the same week.
    expect(byWeek.size).toBe(1);
  });

  it("keeps monthly buckets keyed by YYYY-MM", () => {
    const byMonth = bucketCashGeneratedLines(lines, "MONTHLY");
    expect(byMonth.has("2026-07")).toBe(true);
    expect(byMonth.size).toBe(1);
  });
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
