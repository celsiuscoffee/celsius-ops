import { describe, it, expect } from "vitest";
import { minutesOfDay, normalizeShiftTime } from "./shift-time";

describe("normalizeShiftTime", () => {
  it("accepts the exact payload the roster grid sends", () => {
    // REGRESSION (2026-09-06): the grid posts `start + ":00"`, so a custom
    // shift arrived as "09:00:00". #1218 validated /^\d{2}:\d{2}$/ against
    // that and refused every custom-hours save with "must be HH:MM".
    expect(normalizeShiftTime("09:00:00")).toBe("09:00");
    expect(normalizeShiftTime("22:30:00")).toBe("22:30");
    expect(normalizeShiftTime("00:00:00")).toBe("00:00");
  });

  it("accepts plain HH:MM and a single-digit hour", () => {
    expect(normalizeShiftTime("09:00")).toBe("09:00");
    expect(normalizeShiftTime("9:00")).toBe("09:00");
    expect(normalizeShiftTime(" 12:30 ")).toBe("12:30");
  });

  it("rejects an empty or half-entered field", () => {
    // A cleared <input type="time"> yields "" — the grid's string compare
    // ("" >= "17:00" is false) let it through to the server.
    expect(normalizeShiftTime("")).toBeNull();
    expect(normalizeShiftTime("09:")).toBeNull();
    expect(normalizeShiftTime("09")).toBeNull();
    expect(normalizeShiftTime(null)).toBeNull();
    expect(normalizeShiftTime(undefined)).toBeNull();
  });

  it("rejects impossible clock values", () => {
    expect(normalizeShiftTime("24:00")).toBeNull();
    expect(normalizeShiftTime("09:60")).toBeNull();
    expect(normalizeShiftTime("-1:00")).toBeNull();
  });

  it("refuses sub-minute precision rather than silently rounding it away", () => {
    expect(normalizeShiftTime("09:00:30")).toBeNull();
  });
});

describe("minutesOfDay", () => {
  it("orders times within a day", () => {
    expect(minutesOfDay("00:00")).toBe(0);
    expect(minutesOfDay("09:30")).toBe(570);
    expect(minutesOfDay("23:59")).toBe(1439);
    expect(minutesOfDay("22:30") > minutesOfDay("12:30")).toBe(true);
  });
});
