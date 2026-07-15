import { describe, expect, it } from "vitest";
import { sanitizeBillDates } from "./supplier-doc";

describe("sanitizeBillDates", () => {
  it("drops a due date that precedes the bill date and warns", () => {
    // The real KLFC case: issued 6 Jul, extractor stamped due 14 Jun.
    const r = sanitizeBillDates("2026-07-06", "2026-06-14");
    expect(r.billDate).toBe("2026-07-06");
    expect(r.dueDate).toBeNull();
    expect(r.warning).toMatch(/before bill date/);
  });

  it("keeps a valid due date on/after the bill date", () => {
    expect(sanitizeBillDates("2026-07-06", "2026-07-13")).toEqual({
      billDate: "2026-07-06",
      dueDate: "2026-07-13",
      warning: null,
    });
    // C.O.D. — same day is legitimate.
    expect(sanitizeBillDates("2026-07-06", "2026-07-06").dueDate).toBe("2026-07-06");
  });

  it("passes through when either date is missing", () => {
    expect(sanitizeBillDates(null, "2026-06-14").dueDate).toBe("2026-06-14");
    expect(sanitizeBillDates("2026-07-06", null).dueDate).toBeNull();
    expect(sanitizeBillDates(null, null).warning).toBeNull();
  });
});
