import { describe, it, expect } from "vitest";
import { payslipReleaseDate, isPayslipReleased } from "./payslip-release";

const monthly = (period_month: number, period_year = 2026) => ({
  cycle_type: "monthly",
  period_month,
  period_year,
});
const weekly = { cycle_type: "weekly", period_month: null, period_year: null };

describe("payslipReleaseDate", () => {
  it("opens a monthly payslip on that day of the FOLLOWING month", () => {
    // August payroll, release day 15 -> 15 September.
    expect(payslipReleaseDate(monthly(8), 15)).toBe("2026-09-15");
    expect(payslipReleaseDate(monthly(1), 15)).toBe("2026-02-15");
  });

  it("rolls the year over from December", () => {
    expect(payslipReleaseDate(monthly(12, 2026), 15)).toBe("2027-01-15");
  });

  it("clamps a day past the end of a short month", () => {
    // January payroll releasing on the 31st would land on 31 February.
    expect(payslipReleaseDate(monthly(1, 2026), 31)).toBe("2026-02-28");
    // 2028 is a leap year — February has a 29th.
    expect(payslipReleaseDate(monthly(1, 2028), 31)).toBe("2028-02-29");
  });

  it("is off when no release day is configured", () => {
    expect(payslipReleaseDate(monthly(8), null)).toBeNull();
    expect(payslipReleaseDate(monthly(8), undefined)).toBeNull();
    expect(payslipReleaseDate(monthly(8), 0)).toBeNull();
  });

  it("never gates a weekly (part-timer) run", () => {
    // A PT is paid weekly — holding the slip to a monthly date would hide it
    // for up to three weeks.
    expect(payslipReleaseDate(weekly, 15)).toBeNull();
    expect(payslipReleaseDate({ cycle_type: "opening_balance" }, 15)).toBeNull();
  });

  it("releases rather than buries a monthly run it cannot date", () => {
    expect(payslipReleaseDate({ cycle_type: "monthly", period_month: null, period_year: 2026 }, 15)).toBeNull();
    expect(payslipReleaseDate({ cycle_type: "monthly", period_month: 8, period_year: null }, 15)).toBeNull();
    expect(payslipReleaseDate({ cycle_type: "monthly", period_month: 13, period_year: 2026 }, 15)).toBeNull();
  });
});

describe("isPayslipReleased", () => {
  it("hides the payslip before the release day and shows it on the day", () => {
    const aug = monthly(8);
    expect(isPayslipReleased(aug, 15, "2026-09-07")).toBe(false); // confirmed early
    expect(isPayslipReleased(aug, 15, "2026-09-14")).toBe(false);
    expect(isPayslipReleased(aug, 15, "2026-09-15")).toBe(true); // opens ON the day
    expect(isPayslipReleased(aug, 15, "2026-09-16")).toBe(true);
    expect(isPayslipReleased(aug, 15, "2026-12-01")).toBe(true);
  });

  it("keeps every payslip visible when the feature is off", () => {
    expect(isPayslipReleased(monthly(8), null, "2026-09-01")).toBe(true);
  });

  it("keeps weekly payslips visible immediately even with a release day set", () => {
    expect(isPayslipReleased(weekly, 15, "2026-09-01")).toBe(true);
  });

  it("holds a December payslip into the new year", () => {
    expect(isPayslipReleased(monthly(12, 2026), 15, "2026-12-31")).toBe(false);
    expect(isPayslipReleased(monthly(12, 2026), 15, "2027-01-14")).toBe(false);
    expect(isPayslipReleased(monthly(12, 2026), 15, "2027-01-15")).toBe(true);
  });
});
