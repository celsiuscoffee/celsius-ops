import { describe, it, expect } from "vitest";
import { mytWeekStartYmd } from "./staff-assistant";

// mytWeekStartYmd receives a Date whose UTC fields already represent MYT
// wall-clock time (callers add the +8h offset); PT pay weeks run Mon–Sun.
describe("mytWeekStartYmd", () => {
  it("returns the same day for a Monday", () => {
    expect(mytWeekStartYmd(new Date("2026-07-20T00:00:00Z"))).toBe("2026-07-20"); // Mon
  });
  it("returns the preceding Monday mid-week", () => {
    expect(mytWeekStartYmd(new Date("2026-07-23T15:30:00Z"))).toBe("2026-07-20"); // Thu
  });
  it("returns the preceding Monday on a Sunday", () => {
    expect(mytWeekStartYmd(new Date("2026-07-26T23:59:59Z"))).toBe("2026-07-20"); // Sun
  });
  it("crosses month boundaries", () => {
    expect(mytWeekStartYmd(new Date("2026-08-01T08:00:00Z"))).toBe("2026-07-27"); // Sat → Mon 27 Jul
  });
});
