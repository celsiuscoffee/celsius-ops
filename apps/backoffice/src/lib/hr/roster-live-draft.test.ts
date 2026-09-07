import { describe, it, expect } from "vitest";

// A roster covering today must be PUBLISHED or it is invisible: the staff app
// renders published rosters only (api/hr/shifts) and the weekly PT calculator
// prices published rosters only. Tamarind, 2026-09-06: the week was
// unpublished at 17:18 MYT to change Sunday and never re-published, so Adib
// and Fatin were shown "Rest day — enjoy your day off" for a shift they were
// working, and 7 part-timers' 23 shifts read as unrostered for pay.
//
// These pin the classification the schedules banner and the hourly nudge use.

/** Mirrors the page: a draft schedule whose week has already begun. */
function classifyDraftWeek(status: string, weekStart: string, weekEnd: string, todayMyt: string) {
  const published = status === "published";
  if (published) return "published" as const;
  if (weekStart > todayMyt) return "draft_future" as const;
  return weekEnd < todayMyt ? "draft_ended" as const : "draft_live" as const;
}

describe("live draft roster classification", () => {
  const WEEK_START = "2026-08-31";
  const WEEK_END = "2026-09-06";

  it("a published week is never flagged", () => {
    expect(classifyDraftWeek("published", WEEK_START, WEEK_END, "2026-09-03")).toBe("published");
  });

  it("a draft week that has not started yet is normal planning", () => {
    // Building next week in draft is the whole point of draft — no alarm.
    expect(classifyDraftWeek("draft", "2026-09-14", "2026-09-20", "2026-09-07")).toBe("draft_future");
  });

  it("a draft week containing today is the dangerous state", () => {
    // The exact Tamarind case: unpublished mid-week, staff on shift.
    expect(classifyDraftWeek("draft", WEEK_START, WEEK_END, "2026-09-06")).toBe("draft_live");
    expect(classifyDraftWeek("draft", WEEK_START, WEEK_END, WEEK_START)).toBe("draft_live");
  });

  it("a draft week that has already ended still counts as unresolved", () => {
    // Never silently forgiven: those hours are still unpriced for PT payroll.
    expect(classifyDraftWeek("draft", WEEK_START, WEEK_END, "2026-09-07")).toBe("draft_ended");
  });
});

describe("nudge dedupe key", () => {
  // Keyed on (outlet, week) alone, a roster unpublished LATER in a week that
  // had already pinged never pinged again. The day makes it one ping per
  // outlet per day while still catching a gap that opens mid-week.
  const key = (outlet: string, weekStart: string, ymd: string) =>
    `ROSTER_MISSING:${outlet}:${weekStart}:${ymd}`;

  it("distinguishes two different days of the same unresolved week", () => {
    expect(key("tamarind", "2026-08-31", "2026-09-01")).not.toBe(key("tamarind", "2026-08-31", "2026-09-06"));
  });

  it("collapses repeat hourly runs within one day to a single ping", () => {
    expect(key("tamarind", "2026-08-31", "2026-09-06")).toBe(key("tamarind", "2026-08-31", "2026-09-06"));
  });
});
