import { describe, it, expect } from "vitest";
import { deriveHours } from "./hours";

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

  it("no roster → behaves exactly as before (pays from clock-in)", () => {
    const withNull = deriveHours({ ...base, clockIn: at("2026-07-20T01:00:00Z"), clockOut: at("2026-07-20T12:00:00Z"), scheduledStart: null });
    const without = deriveHours({ ...base, clockIn: at("2026-07-20T01:00:00Z"), clockOut: at("2026-07-20T12:00:00Z") });
    expect(withNull).toEqual(without);
  });
});
