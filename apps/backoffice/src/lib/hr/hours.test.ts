import { describe, it, expect } from "vitest";
import { deriveHours, otBracketHours, paidWindowHours, pickShiftWindow } from "./hours";

const at = (iso: string) => new Date(iso);
const base = { employmentType: "full_time", isPublicHoliday: false, isRestDay: false };

// FT: 7.5h/day OT threshold, 1h unpaid break when the shift runs over 5h.
describe("deriveHours", () => {
  it("floors OT to whole hours: 30min over → 0, 1h10m over → 1", () => {
    // 9h30m clocked − 1h break = 8.5h worked → 1h over threshold... construct precisely:
    // worked 8h (30min over 7.5) → OT 0
    const halfOver = deriveHours({ ...base, clockIn: at("2026-07-20T01:00:00Z"), clockOut: at("2026-07-20T10:00:00Z") });
    expect(halfOver.overtimeHours).toBe(0);
    expect(halfOver.regularHours).toBe(7.5); // over threshold: regular caps at 7.5, sub-1h OT floors away
    // worked 8h40m (1h10m over 7.5) → OT 1
    const overAnHour = deriveHours({ ...base, clockIn: at("2026-07-20T01:00:00Z"), clockOut: at("2026-07-20T10:40:00Z") });
    expect(overAnHour.overtimeHours).toBe(1);
    expect(overAnHour.regularHours).toBe(7.5);
  });

  it("early clock-in pays from the rostered start, not the tap-in", () => {
    // Shift 09:00 MYT (01:00Z), tapped in 08:00 MYT, out 19:00 MYT: clocked 11h
    // but payable 10h − 1h break = 9h worked → OT floor(1.5) = 1 (not 2).
    const d = deriveHours({
      ...base,
      clockIn: at("2026-07-20T00:00:00Z"),
      clockOut: at("2026-07-20T11:00:00Z"),
      scheduledStart: at("2026-07-20T01:00:00Z"),
    });
    expect(d.totalHours).toBe(11); // actual clocked span kept on record
    expect(d.regularHours).toBe(7.5);
    expect(d.overtimeHours).toBe(1);
  });

  it("late clock-in is unaffected by the roster start", () => {
    // Shift 09:00, arrived 10:00, left 18:00 → 8h clocked − 1h break = 7h worked.
    const d = deriveHours({
      ...base,
      clockIn: at("2026-07-20T02:00:00Z"),
      clockOut: at("2026-07-20T10:00:00Z"),
      scheduledStart: at("2026-07-20T01:00:00Z"),
    });
    expect(d.regularHours).toBe(7);
    expect(d.overtimeHours).toBe(0);
  });

  it("PT/intern never get threshold OT — a full 8h shift is all flat regular hours", () => {
    // Owner rule 2026-08-07: "PT no overtime — they can only be paid extra if
    // they work more than their shift." 12:00–20:30 MYT clocked (8.5h) − 0.5h
    // break = 8h worked, all regular; beyond-shift is the processor's flag.
    const d = deriveHours({ ...base, employmentType: "part_time", clockIn: at("2026-07-20T04:00:00Z"), clockOut: at("2026-07-20T12:30:00Z") });
    expect(d.regularHours).toBe(8);
    expect(d.overtimeHours).toBe(0);
    expect(d.overtimeType).toBeNull();
    expect(d.dayTypeFlags).toEqual([]);
  });

  it("no roster → behaves exactly as before (pays from clock-in)", () => {
    const withNull = deriveHours({ ...base, clockIn: at("2026-07-20T01:00:00Z"), clockOut: at("2026-07-20T12:00:00Z"), scheduledStart: null });
    const without = deriveHours({ ...base, clockIn: at("2026-07-20T01:00:00Z"), clockOut: at("2026-07-20T12:00:00Z") });
    expect(withNull).toEqual(without);
  });
});

// Owner rules 2026-08-13 — the PAID WINDOW. Pay is the overlap of the clocked
// span with the rostered shift; the tails outside it are OT that needs approval
// and only counts in 30-min brackets. MYT is UTC+8 throughout.
describe("paidWindowHours", () => {
  const pt = { employmentType: "part_time" as const };
  const myt = (iso: string) => new Date(iso);

  it("pays to the exact minute inside the window — punctuality is no longer penalised", () => {
    // Rostered 15:30–23:30, clocked exactly. Old rule paid 7.0 here; the shift
    // is 8h gross, 7.5h net of the break.
    const w = paidWindowHours({
      ...pt,
      clockIn: myt("2026-08-04T07:30:00Z"), clockOut: myt("2026-08-04T15:30:00Z"),
      scheduledStart: myt("2026-08-04T07:30:00Z"), scheduledEnd: myt("2026-08-04T15:30:00Z"),
    });
    expect(w.paidHours).toBe(7.5);
    expect(w.needsSignOff).toBe(false);
  });

  it("Nurfarah 2026-08-04: 12 min early in, 12 min early out → 7.3h, not 7.0h", () => {
    const w = paidWindowHours({
      ...pt,
      clockIn: myt("2026-08-04T07:18:00Z"), clockOut: myt("2026-08-04T15:18:00Z"),
      scheduledStart: myt("2026-08-04T07:30:00Z"), scheduledEnd: myt("2026-08-04T15:30:00Z"),
    });
    expect(w.paidHours).toBe(7.3);      // 15:30–23:18 = 7.8h, less the 0.5h break
    expect(w.earlyInMinutes).toBe(12);
    expect(w.earlyLeaveMinutes).toBe(12);
    expect(w.otEligibleHours).toBe(0);  // 12 min doesn't fill a 30-min bracket
    expect(w.needsSignOff).toBe(true);  // left early — a manager adjudicates
  });

  it("late clock-in is NOT offset by staying late (Farah 2026-08-13)", () => {
    // Rostered 07:30–15:30, clocked 07:55–16:42. The old daily cap paid this
    // 7.5h in full; the window pays 07:55→15:30 only.
    const w = paidWindowHours({
      ...pt,
      clockIn: myt("2026-08-12T23:55:00Z"), clockOut: myt("2026-08-13T08:42:00Z"),
      scheduledStart: myt("2026-08-12T23:30:00Z"), scheduledEnd: myt("2026-08-13T07:30:00Z"),
    });
    expect(w.paidHours).toBe(7.08);
    expect(w.lateMinutes).toBe(25);
    expect(w.overstayMinutes).toBe(72);
    expect(w.otEligibleHours).toBe(1);  // 72 min → two whole brackets
    expect(w.needsSignOff).toBe(true);
  });

  it("counts an early-in OT tail the same as a late-out one (rule 5)", () => {
    const w = paidWindowHours({
      ...pt,
      clockIn: myt("2026-08-04T06:35:00Z"), clockOut: myt("2026-08-04T15:30:00Z"),
      scheduledStart: myt("2026-08-04T07:30:00Z"), scheduledEnd: myt("2026-08-04T15:30:00Z"),
    });
    expect(w.earlyInMinutes).toBe(55);
    expect(w.otEligibleHours).toBe(0.5); // 55 min → one bracket, not 55 min
    expect(w.paidHours).toBe(7.5);       // the tail itself is never in base pay
  });

  it("an unrostered clock-in is a cover shift — paid, and forced to a manager", () => {
    // Farah, Sun 2026-08-09, 15:20–23:35 with no shift on the grid. The daily
    // cap paid RM0 for this; it now pays the clocked span less the break.
    const w = paidWindowHours({
      ...pt,
      clockIn: myt("2026-08-09T07:20:00Z"), clockOut: myt("2026-08-09T15:35:00Z"),
      scheduledStart: null, scheduledEnd: null,
    });
    expect(w.unrostered).toBe(true);
    expect(w.paidHours).toBe(7.75);
    expect(w.needsSignOff).toBe(true);
  });

  it("pays nothing when the timestamps are impossible (Alea 2026-08-10)", () => {
    // clock_out 4h45m BEFORE clock_in. The cap paid 4.5h out of the roster.
    const w = paidWindowHours({
      ...pt,
      clockIn: myt("2026-08-10T15:30:00Z"), clockOut: myt("2026-08-10T10:45:00Z"),
      scheduledStart: myt("2026-08-10T10:30:00Z"), scheduledEnd: myt("2026-08-10T15:30:00Z"),
    });
    expect(w.paidHours).toBe(0);
    expect(w.needsSignOff).toBe(true);
  });

  it("handles a cross-midnight shift (22:00–02:00)", () => {
    const w = paidWindowHours({
      ...pt,
      clockIn: myt("2026-08-04T13:50:00Z"), clockOut: myt("2026-08-04T18:10:00Z"),
      scheduledStart: myt("2026-08-04T14:00:00Z"),
      scheduledEnd: myt("2026-08-03T18:00:00Z"), // 02:00 MYT built off the shift's own date
    });
    expect(w.paidHours).toBe(4);
    expect(w.needsSignOff).toBe(false);
  });

  it("keeps small drift out of the confirm queue", () => {
    // 2 min late, 3 min early out. The lateness is inside the clock-in grace so
    // it pays from 07:30; the early leave is NOT graced and is docked to the
    // minute — 07:30→15:27 = 7.95h, less the 0.5h break.
    const w = paidWindowHours({
      ...pt,
      clockIn: myt("2026-08-04T07:32:00Z"), clockOut: myt("2026-08-04T15:27:00Z"),
      scheduledStart: myt("2026-08-04T07:30:00Z"), scheduledEnd: myt("2026-08-04T15:30:00Z"),
    });
    expect(w.needsSignOff).toBe(false);
    expect(w.paidHours).toBe(7.45);
  });
});

describe("otBracketHours", () => {
  it("counts only whole 30-minute brackets (rule 6)", () => {
    expect(otBracketHours(0)).toBe(0);
    expect(otBracketHours(25)).toBe(0);
    expect(otBracketHours(30)).toBe(0.5);
    expect(otBracketHours(59)).toBe(0.5);
    expect(otBracketHours(65)).toBe(1);
  });
});

describe("pickShiftWindow", () => {
  it("matches an evening log to the evening half of a split shift", () => {
    const morning = { start: new Date("2026-08-04T23:30:00Z"), end: new Date("2026-08-05T03:30:00Z") };
    const evening = { start: new Date("2026-08-05T09:00:00Z"), end: new Date("2026-08-05T13:00:00Z") };
    const picked = pickShiftWindow(
      [morning, evening],
      new Date("2026-08-05T08:55:00Z"), new Date("2026-08-05T13:05:00Z"),
    );
    expect(picked).toBe(evening);
  });

  it("returns null when the day has no roster", () => {
    expect(pickShiftWindow([], new Date(), new Date())).toBeNull();
  });
});

// Owner rule 2026-08-14: a clock-in up to 10 minutes late is forgiven — pay
// still runs from the rostered start.
describe("paidWindowHours — clock-in grace", () => {
  const pt = { employmentType: "part_time" as const };
  const myt = (iso: string) => new Date(iso);
  // Naufal, 2026-08-03 Shah Alam: rostered 07:30–15:30, clocked 07:30:51–15:49:56.
  const NAUFAL_START = myt("2026-08-02T23:30:00Z");
  const NAUFAL_END = myt("2026-08-03T07:30:00Z");

  it("Naufal 2026-08-03: 51 seconds late costs nothing (was RM63, now RM67.50)", () => {
    const w = paidWindowHours({
      ...pt,
      clockIn: myt("2026-08-02T23:30:51Z"), clockOut: myt("2026-08-03T07:49:56Z"),
      scheduledStart: NAUFAL_START, scheduledEnd: NAUFAL_END,
    });
    expect(w.paidHours).toBe(7.5);        // full rostered 8h less the 0.5h break
    expect(w.needsSignOff).toBe(false);   // nothing for a manager to adjudicate
    // The 19m56s overstay is under a 30-min bracket, so it earns no OT either.
    expect(w.otEligibleHours).toBe(0);
  });

  it("forgives right up to the 10-minute edge", () => {
    const w = paidWindowHours({
      ...pt,
      clockIn: myt("2026-08-02T23:40:00Z"), clockOut: myt("2026-08-03T07:30:00Z"),
      scheduledStart: NAUFAL_START, scheduledEnd: NAUFAL_END,
    });
    expect(w.paidHours).toBe(7.5);
    expect(w.lateMinutes).toBe(10); // still REPORTED late — grace pays, it doesn't relabel
  });

  it("docks the FULL lateness once past the grace, not just the excess", () => {
    // 11 min late → pay starts at 07:41, not 07:40. The grace is a threshold,
    // not an allowance to subtract.
    const w = paidWindowHours({
      ...pt,
      clockIn: myt("2026-08-02T23:41:00Z"), clockOut: myt("2026-08-03T07:30:00Z"),
      scheduledStart: NAUFAL_START, scheduledEnd: NAUFAL_END,
    });
    expect(w.paidHours).toBe(7.32);  // 7h49m less the 0.5h break
    expect(w.needsSignOff).toBe(true);
  });

  it("does not forgive leaving early — the grace is one-sided", () => {
    const w = paidWindowHours({
      ...pt,
      clockIn: myt("2026-08-02T23:30:00Z"), clockOut: myt("2026-08-03T07:22:00Z"),
      scheduledStart: NAUFAL_START, scheduledEnd: NAUFAL_END,
    });
    expect(w.paidHours).toBe(7.37);   // docked the 8 minutes he left early
    expect(w.earlyLeaveMinutes).toBe(8);
  });

  it("never pays an early clock-in from before the rostered start", () => {
    const w = paidWindowHours({
      ...pt,
      clockIn: myt("2026-08-02T23:20:00Z"), clockOut: myt("2026-08-03T07:30:00Z"),
      scheduledStart: NAUFAL_START, scheduledEnd: NAUFAL_END,
    });
    expect(w.paidHours).toBe(7.5);
    expect(w.earlyInMinutes).toBe(10);
  });
});

describe("deriveHours — clock-in grace applies to full-timers too", () => {
  const ft = { employmentType: "full_time", isPublicHoliday: false, isRestDay: false };
  it("pays a graced FT clock-in from the rostered start", () => {
    const graced = deriveHours({
      ...ft,
      clockIn: at("2026-08-02T23:36:00Z"), clockOut: at("2026-08-03T07:30:00Z"),
      scheduledStart: at("2026-08-02T23:30:00Z"), scheduledEnd: at("2026-08-03T07:30:00Z"),
    });
    const onTime = deriveHours({
      ...ft,
      clockIn: at("2026-08-02T23:30:00Z"), clockOut: at("2026-08-03T07:30:00Z"),
      scheduledStart: at("2026-08-02T23:30:00Z"), scheduledEnd: at("2026-08-03T07:30:00Z"),
    });
    expect(graced.regularHours).toBe(onTime.regularHours);
  });
});
