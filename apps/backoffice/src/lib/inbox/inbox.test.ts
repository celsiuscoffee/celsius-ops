import { describe, it, expect } from "vitest";
import { sortInbox, type InboxItem } from "./types";
import { formatInboxAmount, formatInboxTime } from "./format";

const item = (id: string, when: InboxItem["when"], amountRM?: number, at?: string): InboxItem => ({
  id, source: "t", area: "HR", when, title: id, from: "x", href: "/", hrefLabel: "Open", amountRM, at,
});

describe("inbox order", () => {
  it("puts Act now first, then bigger ringgit, then oldest", () => {
    const out = sortInbox([
      item("later", "later", 9999),
      item("today-small", "today", 10),
      item("now-old", "now", undefined, "2026-11-10T01:00:00Z"),
      item("today-big", "today", 500),
      item("now-new", "now", undefined, "2026-11-12T01:00:00Z"),
    ]).map((i) => i.id);
    expect(out).toEqual(["now-old", "now-new", "today-big", "today-small", "later"]);
  });
});

describe("inbox formats", () => {
  it("money is RM with two decimals", () => {
    expect(formatInboxAmount(1284.5)).toBe("RM 1,284.50");
  });
  it("today shows a 12-hour time, other days a date in words (Malaysia time)", () => {
    const now = new Date("2026-11-12T06:00:00Z"); // 2:00 PM MYT
    expect(formatInboxTime("2026-11-12T06:31:00Z", now)).toBe("2:31 PM");
    expect(formatInboxTime("2026-11-09T02:00:00Z", now)).toBe("Mon 9 Nov");
  });
});
