import { describe, it, expect } from "vitest";
import { resolveWindow } from "./window";

// The cron sweeps a NARROW window with apply=true (safe: nothing has been
// refunded or re-rung out-of-band within a few hours). The operator audit
// sweeps a WIDE window in dry-run. A mixed-up parameter must never widen the
// automated sweep into a 90-day auto-settle.
describe("resolveWindow", () => {
  it("prefers minutes when present (the cron's narrow window)", () => {
    expect(resolveWindow("180", null)).toEqual({ windowMs: 180 * 60_000, label: "180m" });
  });

  it("ignores days when minutes is given", () => {
    expect(resolveWindow("30", "90")).toEqual({ windowMs: 30 * 60_000, label: "30m" });
  });

  it("clamps minutes to a day so a typo can't become a historical auto-settle", () => {
    expect(resolveWindow("99999", null).label).toBe("1440m");
    expect(resolveWindow("0", null).label).toBe("1m");
    expect(resolveWindow("-5", null).label).toBe("1m");
  });

  it("falls back to the 30-day operator default", () => {
    expect(resolveWindow(null, null)).toEqual({ windowMs: 30 * 86_400_000, label: "30d" });
  });

  it("clamps days to 90", () => {
    expect(resolveWindow(null, "365").label).toBe("90d");
  });

  it("treats non-numeric input as the default rather than NaN", () => {
    expect(resolveWindow(null, "abc").label).toBe("30d");
    expect(resolveWindow("abc", null).label).toBe("1m");
  });
});
