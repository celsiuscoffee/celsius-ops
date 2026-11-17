import { describe, it, expect } from "vitest";
import { pickTodayShift, shiftLine, time12 } from "./shift-card";

const s = (shift_date: string, start_time: string, end_time: string | null) => ({ shift_date, start_time, end_time });

describe("today's shift", () => {
  it("picks the earliest real shift today and skips rest-day markers", () => {
    const shifts = [s("2026-11-16", "15:00:00", "23:00:00"), s("2026-11-16", "00:00:00", "00:00:00"), s("2026-11-16", "07:30:00", "15:30:00"), s("2026-11-17", "06:00:00", "14:00:00")];
    expect(pickTodayShift(shifts, "2026-11-16")?.start_time).toBe("07:30:00");
    expect(pickTodayShift([s("2026-11-16", "00:00:00", "00:00:00")], "2026-11-16")).toBeNull();
    expect(pickTodayShift(null, "2026-11-16")).toBeNull();
  });

  it("writes 12-hour times", () => {
    expect(time12("07:30:00")).toBe("7:30 AM");
    expect(time12("15:00")).toBe("3 PM");
    expect(time12("00:15")).toBe("12:15 AM");
    expect(time12("12:00")).toBe("12 PM");
  });

  it("says when the shift starts, or when it ends once clocked in (Malaysia time)", () => {
    const shift = s("2026-11-16", "07:30:00", "15:30:00");
    const at = (myt: string) => Date.parse(`2026-11-16T${myt}:00+08:00`);
    expect(shiftLine(shift, at("07:18"), false)).toEqual({ times: "7:30 AM – 3:30 PM", hint: "Starts in 12 min" });
    expect(shiftLine(shift, at("05:00"), false).hint).toBe("Starts in 2 h 30 min");
    expect(shiftLine(shift, at("07:35"), false).hint).toBe("Started 5 min ago");
    expect(shiftLine(shift, at("08:00"), true).hint).toBe("Ends 3:30 PM");
  });
});
