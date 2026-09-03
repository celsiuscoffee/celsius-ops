import { describe, it, expect } from "vitest";
import {
  otRequestCandidates,
  requestOtType,
  logOtHours,
  syncWindow,
  type TailLog,
} from "./ot-request-generator";

// After the paid-window rule (2026-08-13) the OT tail lives only in
// deriveHours' otEligibleHours — never on the row — and the old generator
// selected on overtime_hours >= 1, which had gone permanently 0. These pin the
// replacement: tails become requests, the right things are skipped, and the
// hours match what a manager sees.

const FT = "ft-1";
const PT = "pt-1";

// Rostered 07:30–15:30 MYT on 2026-08-16 = 23:30Z (15th) → 07:30Z (16th).
const base = (over: Partial<TailLog> = {}): TailLog => ({
  id: "log-1",
  user_id: FT,
  outlet_id: "outlet-a",
  clock_in: "2026-08-15T23:30:00Z",
  clock_out: "2026-08-16T07:30:00Z",
  scheduled_start: "07:30:00",
  scheduled_end: "15:30:00",
  scheduled_date: "2026-08-16",
  overtime_hours: 0,
  overtime_type: null,
  clock_in_method: "app",
  clock_out_method: "app",
  final_status: null,
  ot_approval_id: null,
  ...over,
});

const opts = () => ({ ftUserIds: new Set([FT]), existingKeys: new Set<string>() });

describe("logOtHours", () => {
  it("Firdaus 16 Aug: manager set clock-out to 18:02 against a 15:30 roster → 2.5h tail (30-min brackets)", () => {
    const l = base({ clock_out: "2026-08-16T10:02:00Z" });
    expect(logOtHours(l)).toEqual({ tail: 2.5, threshold: 0 });
  });

  it("on-time shift has no tail", () => {
    expect(logOtHours(base())).toEqual({ tail: 0, threshold: 0 });
  });

  it("unrostered cover shift is paid in full already — no tail", () => {
    const l = base({ scheduled_start: null, scheduled_end: null, clock_out: "2026-08-16T12:00:00Z" });
    expect(logOtHours(l).tail).toBe(0);
  });
});

describe("otRequestCandidates", () => {
  it("files one request for a 2.5h overstay, dated on the MYT day, 1.5× on a weekday", () => {
    const out = otRequestCandidates([base({ clock_out: "2026-08-16T10:02:00Z" })], opts());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      user_id: FT,
      outlet_id: "outlet-a",
      date: "2026-08-16",
      hours: 2.5,
      ot_type: "1.5x",
      attendance_log_id: "log-1",
    });
    expect(out[0].reason).toMatch(/2\.5h clocked outside the rostered window/);
  });

  it("a 55-min overstay brackets to 0.5h and IS requested (owner 2026-09-03: pay the half hour)", () => {
    const out = otRequestCandidates([base({ clock_out: "2026-08-16T08:25:00Z" })], opts());
    expect(out).toHaveLength(1);
    expect(out[0].hours).toBe(0.5);
  });

  it("under one 30-min bracket (25 min) is nothing — no request", () => {
    const out = otRequestCandidates([base({ clock_out: "2026-08-16T07:55:00Z" })], opts());
    expect(out).toHaveLength(0);
  });

  it("threshold OT already on the row still counts (long rostered shift)", () => {
    // Rostered 07:30–19:30, worked exactly that: 11h net → 3h over the 7.5h threshold.
    const l = base({ scheduled_end: "19:30:00", clock_out: "2026-08-16T11:30:00Z", overtime_hours: 3 });
    const out = otRequestCandidates([l], opts());
    expect(out[0].hours).toBe(3);
    expect(out[0].reason).toMatch(/3h over the daily threshold/);
  });

  it("split shifts on one day aggregate into one request", () => {
    const a = base({ id: "a", clock_out: "2026-08-16T08:30:00Z" }); // 1h tail
    const b = base({ id: "b", clock_in: "2026-08-16T09:00:00Z", clock_out: "2026-08-16T14:00:00Z", scheduled_start: "17:00:00", scheduled_end: "21:00:00" }); // 4h... no: rostered 17–21, clocked 17:00–22:00 → 1h tail
    b.clock_in = "2026-08-16T09:00:00Z"; // 17:00 MYT
    b.clock_out = "2026-08-16T14:00:00Z"; // 22:00 MYT
    const out = otRequestCandidates([a, b], opts());
    expect(out).toHaveLength(1);
    expect(out[0].hours).toBe(2);
  });

  it("skips part-timers, system auto-closes, synthetic OT logs, rejected logs and already-stamped logs", () => {
    const tail = { clock_out: "2026-08-16T10:02:00Z" };
    expect(otRequestCandidates([base({ ...tail, user_id: PT })], opts())).toHaveLength(0);
    expect(otRequestCandidates([base({ ...tail, clock_out_method: "system" })], opts())).toHaveLength(0);
    expect(otRequestCandidates([base({ ...tail, clock_in_method: "ot_approval" })], opts())).toHaveLength(0);
    expect(otRequestCandidates([base({ ...tail, final_status: "rejected" })], opts())).toHaveLength(0);
    expect(otRequestCandidates([base({ ...tail, ot_approval_id: "req-9" })], opts())).toHaveLength(0);
    expect(otRequestCandidates([base({ ...tail, clock_out: null })], opts())).toHaveLength(0);
  });

  it("skips a (person, day) that already has a request", () => {
    const o = opts();
    o.existingKeys.add(`${FT}|2026-08-16`);
    expect(otRequestCandidates([base({ clock_out: "2026-08-16T10:02:00Z" })], o)).toHaveLength(0);
  });

  it("public-holiday and rest-day classes carry the right rate to the request", () => {
    const ph = base({ clock_out: "2026-08-16T10:02:00Z", overtime_type: "ph_2x" });
    const rd = base({ clock_out: "2026-08-16T10:02:00Z", overtime_type: "rest_day_1x" });
    expect(otRequestCandidates([ph], opts())[0].ot_type).toBe("3x");
    expect(otRequestCandidates([rd], opts())[0].ot_type).toBe("2x");
  });
});

describe("requestOtType", () => {
  it("maps stamps to request rate classes", () => {
    expect(requestOtType("ph_2x")).toBe("3x");
    expect(requestOtType("ot_3x")).toBe("3x");
    expect(requestOtType("ot_2x")).toBe("2x");
    expect(requestOtType("rest_day_1x")).toBe("2x");
    expect(requestOtType("ot_1x")).toBe("1x");
    expect(requestOtType("ot_1_5x")).toBe("1.5x");
    expect(requestOtType(null)).toBe("1.5x");
  });
});

describe("syncWindow", () => {
  it("early in the month still scans the previous month (payroll not closed yet)", () => {
    const w = syncWindow(new Date("2026-09-03T10:00:00Z"));
    expect(w.months).toEqual(["2026-08", "2026-09"]);
    expect(w.start).toBe("2026-07-31T16:00:00.000Z"); // 1 Aug 00:00 MYT
    expect(w.end).toBe("2026-09-30T16:00:00.000Z"); // 1 Oct 00:00 MYT
  });

  it("after the 10th scans the current month only", () => {
    const w = syncWindow(new Date("2026-09-15T10:00:00Z"));
    expect(w.months).toEqual(["2026-09"]);
    expect(w.start).toBe("2026-08-31T16:00:00.000Z");
  });

  it("explicit month wins", () => {
    const w = syncWindow(new Date("2026-09-15T10:00:00Z"), "2026-08");
    expect(w.months).toEqual(["2026-08"]);
    expect(w.start).toBe("2026-07-31T16:00:00.000Z");
    expect(w.end).toBe("2026-08-31T16:00:00.000Z");
  });

  it("January reaches back into December of the previous year", () => {
    const w = syncWindow(new Date("2027-01-05T10:00:00Z"));
    expect(w.months).toEqual(["2026-12", "2027-01"]);
  });
});
