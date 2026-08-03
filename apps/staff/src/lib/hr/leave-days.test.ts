import { describe, it, expect } from "vitest";
import { leaveDays } from "./constants";

describe("leaveDays — the balance card showed 7.300000000000001", () => {
  it("fixes the exact row from the screenshot — Ariff's annual balance", () => {
    // entitled 8.0 + carried_forward 1.3 - used 2.0 - pending 0.0.
    // The carry-forward is what introduces the error; 8 - 0.7 alone is exact.
    const raw = 8.0 + 1.3 - 2.0 - 0.0;
    expect(raw).not.toBe(7.3); // the bug: binary float
    expect(String(raw)).toBe("7.300000000000001");
    expect(leaveDays(raw)).toBe(7.3);
    expect(String(leaveDays(raw))).toBe("7.3");
  });

  it("renders whole days without a decimal point", () => {
    expect(String(leaveDays(8))).toBe("8");
    expect(String(leaveDays(3.0))).toBe("3");
  });

  it("keeps half-days, which is the granularity the business uses", () => {
    expect(leaveDays(2.5)).toBe(2.5);
    expect(leaveDays(0.5)).toBe(0.5);
    expect(leaveDays(11.6 - 7.5)).toBe(4.1); // sick balance, same subtraction
  });

  it("survives a chain of subtractions", () => {
    expect(leaveDays(14 - 0.1 - 0.2 - 0.3)).toBe(13.4);
    expect(leaveDays(8 - 1.1 - 2.2)).toBe(4.7);
  });

  it("does not invent precision the data doesn't have", () => {
    // Two decimals is past half-day granularity, so nothing real is hidden.
    expect(leaveDays(7.3333)).toBe(7.33);
    expect(leaveDays(2.6667)).toBe(2.67);
  });

  it("coerces the numeric strings Postgres returns", () => {
    expect(leaveDays("7.3" as unknown as number)).toBe(7.3);
    expect(leaveDays("8.0" as unknown as number)).toBe(8);
  });

  it("treats null / undefined / junk as zero rather than NaN on screen", () => {
    expect(leaveDays(null as unknown as number)).toBe(0);
    expect(leaveDays(undefined as unknown as number)).toBe(0);
    expect(leaveDays("abc" as unknown as number)).toBe(0);
  });

  it("handles a negative balance without mangling it", () => {
    // Over-taken leave should still read as a clean negative, not a float smear.
    expect(leaveDays(0 - 0.7 - 0.2)).toBe(-0.9);
  });
});
