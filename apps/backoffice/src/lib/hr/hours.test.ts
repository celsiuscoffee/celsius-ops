import { describe, it, expect } from "vitest";
import { deriveHours, ptRoundedSpanHours } from "./hours";

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

// Owner rule 2026-08-07 (clarified same day): PT payment computes hours from
// clock times rounded to the LOWEST 30 minutes ("if clock out 8.35, calculate
// 8.30") — each end rounds toward the inside of the shift.
describe("ptRoundedSpanHours", () => {
  it("floors the clock-out just past the half-hour (20:35 → 20:30)", () => {
    // MYT 12:00 in, 20:35 out = 04:00Z–12:35Z → pays to 20:30 → 8.5h span
    expect(ptRoundedSpanHours("2026-08-02T04:00:00Z", "2026-08-02T12:35:00Z")).toBe(8.5);
  });

  it("floors the clock-out even when nearer the next half-hour (20:50 → 20:30)", () => {
    expect(ptRoundedSpanHours("2026-08-02T04:00:00Z", "2026-08-02T12:50:00Z")).toBe(8.5);
  });

  it("rounds the clock-in UP to the next half-hour (09:58 → 10:00, 15:18 → 15:30)", () => {
    expect(ptRoundedSpanHours("2026-08-02T01:58:31Z", "2026-08-02T10:00:00Z")).toBe(8);
    expect(ptRoundedSpanHours("2026-08-02T07:18:00Z", "2026-08-02T15:10:00Z")).toBe(7.5);
  });

  it("never pays more than the clocked span (09:40 in pays from 10:00)", () => {
    // 09:40–14:18 MYT clocked 4.63h → pays 10:00–14:00 = 4h
    expect(ptRoundedSpanHours("2026-08-02T01:40:00Z", "2026-08-02T06:18:00Z")).toBe(4);
  });

  it("exact half-hour boundaries are unchanged, and a tiny stub rounds to zero", () => {
    expect(ptRoundedSpanHours("2026-07-30T07:30:00Z", "2026-07-30T15:00:00Z")).toBe(7.5);
    // 15:20–15:25 rounds inward past itself → 0h, never negative
    expect(ptRoundedSpanHours("2026-07-30T07:20:00Z", "2026-07-30T07:25:00Z")).toBe(0);
  });
});
