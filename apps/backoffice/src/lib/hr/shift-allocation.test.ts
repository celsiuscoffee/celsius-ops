import { describe, it, expect } from "vitest";
import { allocateShiftCounts, allocateStationCounts, type ShiftWindow } from "./shift-allocation";

// Putrajaya-style windows: Opening 07:30–15:30, two middles, Closing 15:30–23:30.
const OPENING: ShiftWindow = { key: "opening", startH: 7, endH: 15 };
const MID1: ShiftWindow = { key: "mid1", startH: 10, endH: 18 };
const MID2: ShiftWindow = { key: "mid2", startH: 12, endH: 20 };
const CLOSING: ShiftWindow = { key: "closing", startH: 15, endH: 23 };
const ANCHORS = [OPENING, CLOSING];
const ALL = [OPENING, MID1, MID2, CLOSING];

const flat = (v: number) => Object.fromEntries(Array.from({ length: 17 }, (_, i) => [7 + i, v]));

const total = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);

describe("allocateShiftCounts", () => {
  it("morning-heavy demand (coffee peak) → more opening heads than closing", () => {
    // Demand 5 heads 8:00–12:00, tapering to 2 in the evening.
    const demand: Record<number, number> = { ...flat(2), 8: 5, 9: 5, 10: 5, 11: 5, 12: 4, 13: 4 };
    const counts = allocateShiftCounts({ heads: 8, windows: ANCHORS, demandByHour: demand });
    expect(counts.get("opening")!).toBeGreaterThan(counts.get("closing")!);
    expect(total(counts)).toBe(8);
  });

  it("evening-heavy demand → more closing heads", () => {
    const demand: Record<number, number> = { ...flat(2), 18: 5, 19: 5, 20: 5, 21: 4 };
    const counts = allocateShiftCounts({ heads: 8, windows: ANCHORS, demandByHour: demand });
    expect(counts.get("closing")!).toBeGreaterThan(counts.get("opening")!);
  });

  it("flat demand, anchors only → an even split, never 2-vs-6", () => {
    const counts = allocateShiftCounts({ heads: 8, windows: ANCHORS, demandByHour: flat(3) });
    expect(counts.get("opening")).toBe(4);
    expect(counts.get("closing")).toBe(4);
  });

  it("midday hump → middles absorb it while both anchors stay staffed", () => {
    const demand: Record<number, number> = { ...flat(3), 12: 6, 13: 6, 14: 6 };
    const counts = allocateShiftCounts({ heads: 9, windows: ALL, demandByHour: demand });
    expect(counts.get("opening")!).toBeGreaterThanOrEqual(1);
    expect(counts.get("closing")!).toBeGreaterThanOrEqual(1);
    expect((counts.get("mid1") ?? 0) + (counts.get("mid2") ?? 0)).toBeGreaterThanOrEqual(2);
    expect(total(counts)).toBe(9);
  });

  it("always at least 1 opener and 1 closer when 2+ heads exist", () => {
    // Even with ALL demand in the evening, someone still opens the store.
    const demand: Record<number, number> = { 18: 9, 19: 9, 20: 9 };
    const counts = allocateShiftCounts({ heads: 5, windows: ANCHORS, demandByHour: demand });
    expect(counts.get("opening")!).toBeGreaterThanOrEqual(1);
    expect(counts.get("closing")!).toBeGreaterThanOrEqual(1);
  });

  it("surplus heads spread instead of stacking one window", () => {
    // 12 heads against a 3-head flat demand: no window should hoard the surplus.
    const counts = allocateShiftCounts({ heads: 12, windows: ALL, demandByHour: flat(3) });
    for (const v of counts.values()) expect(v).toBeLessThanOrEqual(5);
    expect(total(counts)).toBe(12);
  });

  it("1 head → a single placement; 0 heads → all zero", () => {
    const one = allocateShiftCounts({ heads: 1, windows: ANCHORS, demandByHour: flat(3) });
    expect(total(one)).toBe(1);
    const zero = allocateShiftCounts({ heads: 0, windows: ALL, demandByHour: flat(3) });
    expect(total(zero)).toBe(0);
  });
});

// Per-station allocation (owner rules 2026-07-17): counts run once per
// station, and anchors are STRUCTURAL — open carries prep/setup, close
// carries cleaning + dishwashing that the item curve can't see — so each
// station seeds up to 2 at opening AND 2 at closing before its curve places
// anyone else. Applies to kitchen AND FOH.
describe("allocateStationCounts (structural anchors + station curve)", () => {
  // Real Putrajaya kitchen shape (28d): kit heads 8:00→1, 9:00→2, then ~1.
  const KIT: Record<number, number> = {
    7: 0, 8: 1, 9: 2, 10: 1, 11: 1, 12: 1, 13: 1, 14: 1,
    15: 1, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1, 22: 0,
  };

  it("4 crew → 2 opening + 2 closing, no middles", () => {
    const counts = allocateStationCounts({ heads: 4, windows: ALL, demandByHour: KIT });
    expect(counts.get("opening")).toBe(2);
    expect(counts.get("closing")).toBe(2);
    expect(counts.get("mid1")).toBe(0);
    expect(counts.get("mid2")).toBe(0);
  });

  it("3 crew → 2 opening / 1 closing", () => {
    const counts = allocateStationCounts({ heads: 3, windows: ALL, demandByHour: KIT });
    expect(counts.get("opening")).toBe(2);
    expect(counts.get("closing")).toBe(1);
  });

  it("2 crew → one anchor each", () => {
    const counts = allocateStationCounts({ heads: 2, windows: ALL, demandByHour: KIT });
    expect(counts.get("opening")).toBe(1);
    expect(counts.get("closing")).toBe(1);
  });

  it("1 crew → opens", () => {
    const counts = allocateStationCounts({ heads: 1, windows: ALL, demandByHour: KIT });
    expect(counts.get("opening")).toBe(1);
  });

  it("beyond the anchors, extra heads follow the residual station curve", () => {
    // Late-afternoon overload (16:00–17:00 needs 3) the 2 closers can't hold:
    // the 5th head lands on the middle window that bridges those hours.
    const spike = { ...KIT, 16: 3, 17: 3 };
    const counts = allocateStationCounts({ heads: 5, windows: ALL, demandByHour: spike });
    expect(counts.get("opening")).toBe(2);
    expect(counts.get("closing")).toBe(2);
    expect(counts.get("mid1")).toBe(1);
  });

  it("surplus with a satisfied curve spreads to middles, never stacks anchors", () => {
    const counts = allocateStationCounts({ heads: 6, windows: ALL, demandByHour: KIT });
    expect(counts.get("opening")).toBe(2);
    expect(counts.get("closing")).toBe(2);
    expect((counts.get("mid1") ?? 0) + (counts.get("mid2") ?? 0)).toBe(2);
  });
});
