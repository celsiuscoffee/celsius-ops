import { describe, it, expect } from "vitest";
import { isOnTimeDelivery, isOpenMytDay, mytDayEnd, mytDayStart, mytYmd, parseMytRangeParam, todayMyt } from "./myt-date";

describe("mytYmd", () => {
  it("rolls an evening UTC instant onto the next MYT day", () => {
    expect(mytYmd(new Date("2026-09-01T16:30:00Z"))).toBe("2026-09-02");
  });
  it("keeps a morning UTC instant on the same day", () => {
    expect(mytYmd(new Date("2026-09-01T08:00:00Z"))).toBe("2026-09-01");
  });
});

describe("isOnTimeDelivery", () => {
  const promised = new Date("2026-09-01T00:00:00Z"); // stored as a date at 00:00 UTC
  it("counts an afternoon delivery on the promised day as on time", () => {
    expect(isOnTimeDelivery(new Date("2026-09-01T07:00:00Z"), promised)).toBe(true); // 15:00 MYT
  });
  it("counts a delivery the day before as on time", () => {
    expect(isOnTimeDelivery(new Date("2026-08-31T10:00:00Z"), promised)).toBe(true);
  });
  it("counts a delivery after MYT midnight as late", () => {
    // 16:30Z on 1 Sep is 00:30 MYT on 2 Sep
    expect(isOnTimeDelivery(new Date("2026-09-01T16:30:00Z"), promised)).toBe(false);
  });
});

describe("parseMytRangeParam", () => {
  it("expands a bare date to the whole MYT day", () => {
    expect(parseMytRangeParam("2026-09-01", "start")?.toISOString()).toBe("2026-08-31T16:00:00.000Z");
    expect(parseMytRangeParam("2026-09-01", "end")?.toISOString()).toBe("2026-09-01T15:59:59.999Z");
  });
  it("passes a full timestamp through unchanged", () => {
    expect(parseMytRangeParam("2026-09-01T03:00:00Z", "end")?.toISOString()).toBe("2026-09-01T03:00:00.000Z");
  });
  it("returns null for junk or missing input", () => {
    expect(parseMytRangeParam(null, "start")).toBeNull();
    expect(parseMytRangeParam("not-a-date", "end")).toBeNull();
  });
  it("start/end helpers bound one day exactly", () => {
    expect(mytDayEnd("2026-09-01").getTime() - mytDayStart("2026-09-01").getTime()).toBe(86_400_000 - 1);
  });
});

describe("isOpenMytDay", () => {
  const now = new Date("2026-09-05T01:00:00Z"); // 09:00 MYT on 5 Sep
  it("treats today (MYT) as still open", () => {
    expect(todayMyt(now)).toBe("2026-09-05");
    expect(isOpenMytDay("2026-09-05", now)).toBe(true);
  });
  it("treats yesterday as closed and tomorrow as open", () => {
    expect(isOpenMytDay("2026-09-04", now)).toBe(false);
    expect(isOpenMytDay("2026-09-06", now)).toBe(true);
  });
  it("uses the MYT date, not the UTC one, at the boundary", () => {
    // 17:00Z on 4 Sep is already 01:00 MYT on 5 Sep → 4 Sep is closed
    expect(isOpenMytDay("2026-09-04", new Date("2026-09-04T17:00:00Z"))).toBe(false);
  });
});
