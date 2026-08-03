import { describe, it, expect } from "vitest";

// Probation staff are not entitled to the performance allowance until they are
// confirmed (owner 2026-08-03).
//
// The gate is a date comparison, and the two things that matter about it are
// which side of the boundary the confirming month falls on, and what a NULL
// means. Both are pinned here because both decide pay.

/** Mirrors the shipped gate in computeAllowancesForUser. */
function isOnProbation(monthEnd: string, probationEnd: string | null): boolean {
  return !!probationEnd && monthEnd <= probationEnd;
}

const monthEnd = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, "0")}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;

describe("probation gate", () => {
  it("excludes someone whose probation ends after the month", () => {
    // Joined 1 Jun, 3-month probation ending 1 Sep: July is inside it.
    expect(isOnProbation(monthEnd(2026, 7), "2026-09-01")).toBe(true);
  });

  it("pays in full for the month probation ENDS, not the month after", () => {
    // Confirmed 15 Jul. July pays. This is the generous side of the boundary
    // and it is deliberate — losing a whole month's allowance to a mid-month
    // confirmation date would be the worse error.
    expect(isOnProbation(monthEnd(2026, 7), "2026-07-15")).toBe(false);
  });

  it("still excludes when probation ends on the last day of the month", () => {
    expect(isOnProbation("2026-07-31", "2026-07-31")).toBe(true);
  });

  it("treats NULL as NOT on probation", () => {
    // The only safe default. probation_end_date was NULL for all 48 active
    // profiles when this shipped, so reading NULL as "unknown, assume
    // probation" would have zeroed the entire company's allowance in one go.
    expect(isOnProbation(monthEnd(2026, 7), null)).toBe(false);
  });

  it("does not exclude a long-confirmed employee", () => {
    expect(isOnProbation(monthEnd(2026, 7), "2021-05-08")).toBe(false);
  });
});

describe("the six the owner named, against candidate probation lengths", () => {
  // Their real join dates. The useful fact: JULY is the same either way — the
  // earliest joiner is 14 May, so even a 3-month probation runs to 14 August.
  // All six are excluded from July at 3 months AND at 6. The length only
  // starts to matter from August, which is where to spend the question.
  const joined: Record<string, string> = {
    "Amirul Yazid": "2026-05-14",
    "Nurul Alianatasha": "2026-06-01",
    "Guraf Lal Joshi": "2026-06-17",
    "Nur Nazihah": "2026-06-19",
    "Nur Iffa Sofea": "2026-06-23",
    "Muhammad Akmal Aiman Amir": "2026-07-06",
  };

  const plusMonths = (iso: string, months: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + months);
    return d.toISOString().slice(0, 10);
  };

  it("excludes all six from July at BOTH 3 and 6 months — the length is moot for July", () => {
    for (const months of [3, 6]) {
      for (const [name, join] of Object.entries(joined)) {
        expect(isOnProbation("2026-07-31", plusMonths(join, months)), `${name} @ ${months}mo`).toBe(true);
      }
    }
  });

  it("but the length decides AUGUST — Amirul Yazid confirms 14 Aug at 3 months", () => {
    expect(plusMonths(joined["Amirul Yazid"], 3)).toBe("2026-08-14");
    expect(isOnProbation("2026-08-31", "2026-08-14")).toBe(false);   // 3mo: pays in August
    expect(isOnProbation("2026-08-31", "2026-11-14")).toBe(true);    // 6mo: does not
  });
});
