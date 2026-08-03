import { describe, it, expect } from "vitest";
import { effectiveProbationEnd, isOnProbation, DEFAULT_PROBATION_DAYS } from "./probation";

// Probation staff are not entitled to the performance allowance until they are
// confirmed (owner 2026-08-03). They are still SCORED — the money is withheld on
// the payslip, in payroll-calculator, not zeroed in the allowance engine
// (owner: "we still need the performance").
//
// This file used to test a LOCAL COPY of the gate, which is why it stayed green
// while the shipped gate was dead: that gate read the raw probation_end_date
// column, NULL on 61 of 62 active profiles, so nobody was ever on probation. The
// exclusion was done by hand, lever by lever, with a typed reason — and Nur Iffa
// Sofea was paid RM120.00 in July because that manual pass missed her.
// It now imports the real thing.

const monthEnd = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, "0")}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;

describe("effectiveProbationEnd — which date counts", () => {
  it("uses the explicit date when HR has set one", () => {
    expect(effectiveProbationEnd("2026-05-14", "2026-08-27")).toBe("2026-08-27");
  });

  it("lets an explicit date CONFIRM someone early, overriding the default", () => {
    // The probation-review flow writes this. It must beat join + 90 days, or
    // confirming someone ahead of time would have no effect on their pay.
    expect(effectiveProbationEnd("2026-06-23", "2026-07-01")).toBe("2026-07-01");
  });

  it("lets an explicit date EXTEND someone past the default", () => {
    expect(effectiveProbationEnd("2026-05-04", "2026-11-04")).toBe("2026-11-04");
  });

  it("falls back to join + 90 days when nobody has recorded a decision", () => {
    expect(DEFAULT_PROBATION_DAYS).toBe(90);
    expect(effectiveProbationEnd("2026-06-23", null)).toBe("2026-09-21");
  });

  it("returns null when neither is known — never guesses", () => {
    expect(effectiveProbationEnd(null, null)).toBeNull();
    expect(effectiveProbationEnd("not-a-date", null)).toBeNull();
  });
});

describe("the boundary", () => {
  it("pays in full for the month probation ENDS, not the month after", () => {
    // Confirmed 15 Jul → July pays. Deliberately the generous side: losing a
    // whole month's allowance to a mid-month confirmation date is the worse error.
    expect(isOnProbation(monthEnd(2026, 7), "2026-04-15", "2026-07-15")).toBe(false);
  });

  it("still withholds when probation ends on the last day of the month", () => {
    expect(isOnProbation("2026-07-31", "2026-05-02", "2026-07-31")).toBe(true);
  });

  it("treats an unknown profile as NOT on probation", () => {
    // "Unknown" must not read as "on probation" — that would silently zero the
    // allowance for anyone with an incomplete profile.
    expect(isOnProbation(monthEnd(2026, 7), null, null)).toBe(false);
  });

  it("does not withhold from a long-confirmed employee", () => {
    expect(isOnProbation(monthEnd(2026, 7), "2021-05-08", null)).toBe(false);
  });
});

describe("July 2026, against the real join dates", () => {
  // The regression this exists for: every one of these was zeroed by HAND last
  // month except Iffa, who was missed and paid RM120.00. With the fallback in
  // place the gate reaches all of them without anyone typing a reason.
  const withheld: Record<string, string> = {
    "Nur Iffa Sofea": "2026-06-23",        // the one that leaked
    "Amirul Yazid": "2026-05-14",
    "Firdaus": "2026-05-31",
    "Nurul Alianatasha": "2026-06-01",
    "Guraf Lal Joshi": "2026-06-17",
    "Nur Nazihah": "2026-06-19",
    "Akmal Aiman": "2026-07-06",
    "Ahmad Razley": "2026-05-05",          // not on the owner's list, but 3 Aug
    "Adam Ariff Irfan": "2026-05-04",      // 2 Aug
  };

  const paid: Record<string, string> = {
    "Mohd Haziq": "2026-04-27",            // confirms 26 Jul — inside July
    "Nor Armin": "2026-04-16",             // confirms 15 Jul
  };

  it("withholds from everyone still inside 90 days at 31 July", () => {
    for (const [name, join] of Object.entries(withheld)) {
      expect(isOnProbation("2026-07-31", join, null), name).toBe(true);
    }
  });

  it("pays those whose 90 days elapsed before month end", () => {
    for (const [name, join] of Object.entries(paid)) {
      expect(isOnProbation("2026-07-31", join, null), name).toBe(false);
    }
  });

  it("Mohd Haziq and Nor Armin are the boundary — and Razley misses it by three days", () => {
    expect(effectiveProbationEnd("2026-04-27", null)).toBe("2026-07-26");
    expect(effectiveProbationEnd("2026-04-16", null)).toBe("2026-07-15");
    expect(effectiveProbationEnd("2026-05-05", null)).toBe("2026-08-03");
  });

  it("Auni's explicit 27 Aug still governs, fallback or not", () => {
    expect(isOnProbation("2026-07-31", "2026-07-27", "2026-08-27")).toBe(true);
    expect(isOnProbation("2026-08-31", "2026-07-27", "2026-08-27")).toBe(false);
  });
});
