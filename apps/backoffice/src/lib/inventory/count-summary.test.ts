import { describe, it, expect } from "vitest";
import { summariseCounts, unresolvedIn, type CountRow } from "./count-summary";

const NOW = Date.parse("2026-11-17T04:00:00Z");
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const item = (expectedQty: number | null, countedQty: number | null, packageConversion = 1, varianceReason: string | null = null) =>
  ({ expectedQty, countedQty, packageConversion, varianceReason });

describe("summariseCounts", () => {
  it("compares counted packs against expected base units", () => {
    // 2 packs of 1000 g against 2000 g expected is a match, not a 1998 g gap.
    const rows: CountRow[] = [{ outlet: "A", countDate: ago(1), createdAt: ago(1), items: [item(2000, 2, 1000)] }];
    const s = summariseCounts(rows, NOW);
    expect(s.accuracy).toEqual({ matched: 1, compared: 1, share: 1 });
    expect(s.waiting.counts).toBe(0);
  });

  it("counts the week, the outlets, and the discrepancies waiting for a reason", () => {
    const rows: CountRow[] = [
      { outlet: "A", countDate: ago(1), createdAt: ago(1), items: [item(10, 8), item(5, 5), item(3, 2, 1, "Expired")] },
      { outlet: "A", countDate: ago(3), createdAt: ago(3), items: [item(10, 10)] },
      { outlet: "B", countDate: ago(9), createdAt: ago(9), items: [item(4, 1)] },
    ];
    const s = summariseCounts(rows, NOW);
    expect(s.week).toEqual({ counts: 2, outlets: 1 });
    expect(s.waiting).toEqual({ counts: 2, items: 2 });
    expect(s.accuracy.matched).toBe(2);
    expect(s.accuracy.compared).toBe(5);
    expect(unresolvedIn(rows[0])).toBe(1);
  });

  it("keeps items with no expected stock out of accuracy and reports them as unchecked", () => {
    const rows: CountRow[] = [{ outlet: "A", countDate: ago(2), createdAt: ago(2), items: [item(null, 4), item(null, 1), item(1, null)] }];
    const s = summariseCounts(rows, NOW);
    expect(s.accuracy.share).toBeNull();
    expect(s.unchecked).toEqual({ items: 2, counted: 2 });
  });
});
