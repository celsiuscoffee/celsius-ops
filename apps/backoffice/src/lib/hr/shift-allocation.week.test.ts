import { describe, it, expect } from "vitest";
import { allocateShiftCounts, type ShiftWindow } from "./shift-allocation";

// Regression: a full simulated week with the generator's assignment rules on
// top of the allocator. The old splitter cascaded — one closing-heavy day made
// most of the crew "clopeners", barring them from opening the NEXT day, so
// opening starved at 2 heads while closing stacked 6–7 for the rest of the
// week (real Putrajaya wk 2026-07-20 output). This test replays that shape:
// 9 FT, one resting per day, Putrajaya windows, morning-peaked coffee demand —
// and asserts every single day keeps a demand-shaped split with zero
// close→open violations.

const OPENING: ShiftWindow = { key: "open", startH: 7, endH: 15 };
const MID1: ShiftWindow = { key: "mid0", startH: 10, endH: 18 };
const MID2: ShiftWindow = { key: "mid1", startH: 12, endH: 20 };
const CLOSING: ShiftWindow = { key: "close", startH: 15, endH: 23 };
const WINDOWS = [OPENING, MID1, MID2, CLOSING];

// Morning-peaked coffee demand (heads/hour), heavier 8:00–13:00.
const DEMAND: Record<number, number> = {
  7: 2, 8: 4, 9: 5, 10: 5, 11: 4, 12: 4, 13: 4, 14: 3,
  15: 3, 16: 3, 17: 3, 18: 3, 19: 3, 20: 3, 21: 2, 22: 2,
};

type Person = { id: string; closedYesterday: boolean };

// Mirrors the generator's WHO-step: opening from non-clopeners first (clopeners
// only as a last resort), then closing, remainder to middles.
function assignDay(crew: Person[], counts: Map<string, number>) {
  const claimed = new Set<string>();
  const opening: Person[] = [];
  const closing: Person[] = [];
  const openCount = counts.get("open") ?? 0;
  const closeCount = counts.get("close") ?? 0;
  for (const p of crew.filter((p) => !p.closedYesterday)) {
    if (opening.length >= openCount) break;
    opening.push(p); claimed.add(p.id);
  }
  for (const p of crew.filter((p) => !claimed.has(p.id))) {
    if (opening.length >= openCount) break;
    opening.push(p); claimed.add(p.id); // clopener fallback
  }
  for (const p of crew.filter((p) => !claimed.has(p.id))) {
    if (closing.length >= closeCount) break;
    closing.push(p); claimed.add(p.id);
  }
  const middles = crew.filter((p) => !claimed.has(p.id));
  return { opening, closing, middles };
}

describe("simulated week (9 FT, morning-peaked demand)", () => {
  it("every day: opening ≥ closing, both ≥ 3-floor share, no clopening, no 2-vs-6", () => {
    const people: Person[] = Array.from({ length: 9 }, (_, i) => ({ id: `ft${i}`, closedYesterday: i >= 6 })); // seed: 3 closed last Sunday
    const violations: string[] = [];
    for (let day = 0; day < 7; day++) {
      const resting = people[day % 9].id; // one rest per day, rotating
      const crew = people.filter((p) => p.id !== resting);
      const counts = allocateShiftCounts({ heads: crew.length, windows: WINDOWS, demandByHour: DEMAND });
      const { opening, closing, middles } = assignDay(crew, counts);

      // Coverage shape: morning-peaked demand must never produce fewer openers
      // than closers, and neither anchor may starve below 3 with an 8-head crew.
      if (opening.length < closing.length) violations.push(`day${day}: open ${opening.length} < close ${closing.length}`);
      if (opening.length < 3) violations.push(`day${day}: opening starved at ${opening.length}`);
      if (closing.length < 2) violations.push(`day${day}: closing starved at ${closing.length}`);
      if (closing.length > 4) violations.push(`day${day}: closing stacked at ${closing.length}`);
      // Fatigue: no one who closed yesterday opens today (crew is big enough
      // that the last-resort fallback must never trigger here).
      for (const p of opening) if (p.closedYesterday) violations.push(`day${day}: ${p.id} clopening`);
      expect(opening.length + closing.length + middles.length).toBe(crew.length);

      // Advance the day: closers become tomorrow's clopeners.
      const closedIds = new Set(closing.map((p) => p.id));
      for (const p of people) p.closedYesterday = closedIds.has(p.id);
    }
    expect(violations).toEqual([]);
  });
});
