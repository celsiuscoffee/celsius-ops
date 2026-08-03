import { describe, it, expect } from "vitest";
import {
  probationReviewDue,
  isOnProbation,
  isProbationReviewOverdue,
  DEFAULT_PROBATION_DAYS,
} from "./probation";

// PROBATION ENDS ON CONFIRMATION, NOT ON ELAPSED TIME.
// Owner 2026-08-03: "probation will end only after confirmation. it is not time
// base."
//
// Two earlier versions of this gate were wrong in opposite directions and both
// cost real money:
//
//   1. Read the raw `probation_end_date` column, NULL on 61 of 62 profiles, so
//      NOBODY was ever on probation. The exclusion had to be done by editing
//      each lever by hand with a typed reason, and Nur Iffa Sofea was paid
//      RM120.00 in July because that manual pass missed her.
//   2. Fell back to join + 90 days — which pays anyone whose 90 days elapsed
//      even though no one ever confirmed them. That is precisely the time-based
//      rule the owner rejected.
//
// Now: on probation until `confirmed_at` is set. Nothing else ends it.

describe("isOnProbation — confirmation is the only exit", () => {
  it("is on probation when never confirmed, however long ago they joined", () => {
    // The whole point. Someone who joined in 2021 with no confirmation on record
    // is still on probation by this rule.
    expect(isOnProbation("2026-07-31", null)).toBe(true);
    expect(isOnProbation("2026-07-31", undefined)).toBe(true);
  });

  it("is NOT on probation once confirmed", () => {
    expect(isOnProbation("2026-07-31", "2026-05-01")).toBe(false);
  });

  it("pays for the whole month confirmation lands in, not the month after", () => {
    // Confirmed 15 Jul → July pays. The generous side of the boundary,
    // deliberately: losing a month to a mid-month date is the worse error.
    expect(isOnProbation("2026-07-31", "2026-07-15")).toBe(false);
  });

  it("pays when confirmed on the very last day of the month", () => {
    expect(isOnProbation("2026-07-31", "2026-07-31")).toBe(false);
  });

  it("does NOT pay early for a confirmation dated in a future month", () => {
    // A post-dated confirmation must not reach back and pay June.
    expect(isOnProbation("2026-06-30", "2026-07-15")).toBe(true);
  });

  it("ignores a timestamp suffix on the stored date", () => {
    expect(isOnProbation("2026-07-31", "2026-07-15T09:30:00Z")).toBe(false);
  });
});

describe("probationReviewDue — scheduling only, decides nothing", () => {
  it("defaults to join + 90 days", () => {
    expect(DEFAULT_PROBATION_DAYS).toBe(90);
    expect(probationReviewDue("2026-06-23", null)).toBe("2026-09-21");
  });

  it("an extension pushes the due date out", () => {
    expect(probationReviewDue("2026-05-04", "2026-11-04")).toBe("2026-11-04");
  });

  it("returns null when the join date is unknown or unparseable", () => {
    expect(probationReviewDue(null, null)).toBeNull();
    expect(probationReviewDue("not-a-date", null)).toBeNull();
  });

  it("PASSING THE DUE DATE DOES NOT END PROBATION", () => {
    // The regression that matters. The due date is 3 Aug and it is now November;
    // still unconfirmed, so still on probation and still no allowance.
    const due = probationReviewDue("2026-05-05", null);
    expect(due).toBe("2026-08-03");
    expect(isOnProbation("2026-11-30", null)).toBe(true);
  });
});

describe("isProbationReviewOverdue — chases HR, never pays anybody", () => {
  it("flags an unconfirmed employee past their due date", () => {
    expect(isProbationReviewOverdue("2026-11-30", "2026-05-05", null, null)).toBe(true);
  });

  it("does not flag someone still inside their window", () => {
    expect(isProbationReviewOverdue("2026-07-31", "2026-06-23", null, null)).toBe(false);
  });

  it("never flags a confirmed employee, however old the due date", () => {
    expect(isProbationReviewOverdue("2026-11-30", "2026-05-05", null, "2026-08-01")).toBe(false);
  });
});

describe("July 2026 under the confirmation rule", () => {
  // With confirmed_at backfilled for pre-April joiners (see the
  // 20260803_probation_confirmed_at migration), July splits like this.
  const confirmed: Record<string, string> = {
    "Muhamad Syafiq Aiman": "2021-02-08",
    "Tengku Syahirah Balqis": "2025-05-01",
    "Nur Atthira": "2025-08-03",
    "Ariff Izham": "2025-11-01",
    "Zikry Yusuf": "2026-01-16",
    "Shairuleen": "2026-02-01",
    "Nuralia Aina": "2026-02-16",
  };

  // Nobody has confirmed any of these, so all are withheld — including the four
  // whose 90 days had already elapsed by 31 July. Under the OLD time-based rule
  // Mohd Haziq and Nor Armin would have been paid.
  const withheld = [
    "Nor Armin Hafifie",   // joined 2026-04-16, 90d elapsed 15 Jul
    "Mohd Haziq",          // joined 2026-04-27, 90d elapsed 26 Jul
    "Ahmad Razley",        // joined 2026-05-05
    "Amirul Yazid", "Firdaus", "Nurul Alianatasha",
    "Guraf Lal Joshi", "Nur Nazihah", "Nur Iffa Sofea", "Muhammad Akmal Aiman",
  ];

  it("pays the confirmed", () => {
    for (const [name, at] of Object.entries(confirmed)) {
      expect(isOnProbation("2026-07-31", at), name).toBe(false);
    }
  });

  it("withholds from everyone unconfirmed, elapsed time notwithstanding", () => {
    for (const name of withheld) {
      expect(isOnProbation("2026-07-31", null), name).toBe(true);
    }
  });

  it("the two the time rule would have paid are Nor Armin and Mohd Haziq", () => {
    // Their reviews came due inside July, which under join+90d meant "confirmed".
    expect(probationReviewDue("2026-04-16", null)).toBe("2026-07-15");
    expect(probationReviewDue("2026-04-27", null)).toBe("2026-07-26");
    // Both are overdue and neither is confirmed.
    expect(isProbationReviewOverdue("2026-07-31", "2026-04-16", null, null)).toBe(true);
    expect(isProbationReviewOverdue("2026-07-31", "2026-04-27", null, null)).toBe(true);
  });
});
