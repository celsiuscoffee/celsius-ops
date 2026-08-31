import { describe, it, expect } from "vitest";
import { pinStateOf, type PinnablePoster } from "./poster-pin";

const NOW = Date.parse("2026-09-05T04:00:00Z"); // 12:00 MYT, mid-campaign

const poster = (extra: Partial<PinnablePoster> = {}): PinnablePoster => ({
  active: true,
  starts_at: null,
  ends_at: null,
  ...extra,
});

describe("pinStateOf", () => {
  it("leaves an unscheduled poster under autopilot control", () => {
    expect(pinStateOf(poster(), NOW)).toBe("managed");
  });

  it("pins a live campaign poster", () => {
    const p = poster({ starts_at: "2026-08-30T14:29:42Z", ends_at: "2026-09-30T15:59:59Z" });
    expect(pinStateOf(p, NOW)).toBe("pinned-live");
  });

  it("pins an open-started campaign that only has an end date", () => {
    expect(pinStateOf(poster({ ends_at: "2026-09-30T15:59:59Z" }), NOW)).toBe("pinned-live");
  });

  it("protects a scheduled campaign that has not started, without claiming the surface", () => {
    const p = poster({ starts_at: "2026-09-16T00:00:00Z", ends_at: "2026-09-30T15:59:59Z" });
    expect(pinStateOf(p, NOW)).toBe("pinned");
  });

  it("protects a switched-off campaign poster but does not let it bench the surface", () => {
    const p = poster({ active: false, starts_at: "2026-08-30T14:29:42Z", ends_at: "2026-09-30T15:59:59Z" });
    expect(pinStateOf(p, NOW)).toBe("pinned");
  });

  it("releases a campaign the moment its end date has passed", () => {
    const p = poster({ starts_at: "2026-08-01T00:00:00Z", ends_at: "2026-09-02T15:59:59Z" });
    expect(pinStateOf(p, NOW)).toBe("managed");
  });

  it("does not pin on a start date alone, so a half-filled schedule cannot freeze a surface", () => {
    expect(pinStateOf(poster({ starts_at: "2026-08-01T00:00:00Z" }), NOW)).toBe("managed");
  });

  it("releases rather than strands the surface when the end date is unparseable", () => {
    expect(pinStateOf(poster({ ends_at: "not a date" }), NOW)).toBe("managed");
  });

  it("treats an unparseable start date as already started", () => {
    const p = poster({ starts_at: "not a date", ends_at: "2026-09-30T15:59:59Z" });
    expect(pinStateOf(p, NOW)).toBe("pinned-live");
  });

  it("holds the pin right up to the end instant and releases just after", () => {
    const ends = "2026-09-30T15:59:59Z";
    expect(pinStateOf(poster({ ends_at: ends }), Date.parse(ends))).toBe("pinned-live");
    expect(pinStateOf(poster({ ends_at: ends }), Date.parse(ends) + 1)).toBe("managed");
  });
});
