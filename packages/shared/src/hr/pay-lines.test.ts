import { describe, it, expect } from "vitest";
import {
  earningsLines,
  otLineLabel,
  publicHolidayPayLabel,
  restDayPayLabel,
  hourlyWagesLabel,
} from "./pay-lines";

// The August 2026 payslip the owner queried: RM2,200 basic, 18.5h weekday OT,
// one public holiday worked (7h), 1h past normal hours on that holiday.
const AUG = {
  basicSalary: 2200,
  ot1xAmount: 0,
  ot1_5xAmount: 313.08,
  ot2xAmount: 169.23,
  ot3xAmount: 33.85,
  details: {
    ot_hours_1_5x: 18.5,
    ot_hours_3x: 1,
    ph_premium_amount: 169.23,
    ph_days_worked: 1,
    ph_premium_hours: 7,
  },
};

describe("labels", () => {
  it("never renders a wage quantity as a rate multiplier", () => {
    // "(1 day × 2)" read as a 2× rate next to "OT 1.5×" / "OT 3.0×" — the
    // complaint that prompted this. A wage quantity is spelled out in days.
    const label = publicHolidayPayLabel(1, 7);
    expect(label).toBe("Public Holiday Pay (1 day worked) · 2 days' wages");
    expect(label).not.toContain("× 2");
  });

  it("scales the wage quantity with the holidays worked", () => {
    expect(publicHolidayPayLabel(2, 14)).toBe("Public Holiday Pay (2 days worked) · 4 days' wages");
  });

  it("states hours but not a wage quantity for legacy items with no day count", () => {
    // Pre-2026-09-03 items carry hours only; the number of holidays behind
    // those hours is unknown, so the wage quantity would be a guess.
    expect(publicHolidayPayLabel(0, 7)).toBe("Public Holiday Pay (7.0h worked)");
    expect(publicHolidayPayLabel(0, 0)).toBe("Public Holiday Pay");
  });

  it("renders a half day's rest-day wages as ½, not ×0.5", () => {
    expect(restDayPayLabel(1, 0.5)).toBe("Rest Day Pay (1 day worked) · ½ day's wages");
    expect(restDayPayLabel(1, 1)).toBe("Rest Day Pay (1 day worked) · 1 day's wages");
    expect(restDayPayLabel(2, 1.5)).toBe("Rest Day Pay (2 days worked) · 1½ days' wages");
    // Items computed before rest_day_wage_days existed omit the quantity.
    expect(restDayPayLabel(2, 0)).toBe("Rest Day Pay (2 days worked)");
    expect(restDayPayLabel(0, 0)).toBe("Rest Day Pay");
  });

  it("pads whole hours to one decimal so surfaces cannot disagree", () => {
    // The manager app's hand-copy said "1h" where every other surface said "1.0h".
    expect(otLineLabel("3x", 1)).toBe("OT 3.0× (Public Holiday) · 1.0h");
    expect(otLineLabel("1_5x", 18.5)).toBe("OT 1.5× (Weekday) · 18.5h");
    expect(otLineLabel("1x", 0)).toBe("OT 1.0× (Plain Rate)");
  });

  it("labels the weekly part-timer's basic line by hours and rate", () => {
    expect(hourlyWagesLabel(42.5, 8)).toBe("Hourly Wages · 42.5h × RM8.00/h");
    expect(hourlyWagesLabel(42.5, 0)).toBe("Hourly Wages · 42.5h");
    expect(hourlyWagesLabel(0, 8)).toBe("Hourly Wages");
  });
});

describe("earningsLines", () => {
  it("renders the August payslip as basic + three lines, summing to gross", () => {
    const lines = earningsLines(AUG);
    expect(lines.map((l) => [l.label, l.amount])).toEqual([
      ["Basic Salary", 2200],
      ["OT 1.5× (Weekday) · 18.5h", 313.08],
      ["Public Holiday Pay (1 day worked) · 2 days' wages", 169.23],
      ["OT 3.0× (Public Holiday) · 1.0h", 33.85],
    ]);
    // 2,876.15 gross less the RM160 performance allowance, which is not an
    // earnings LINE — allowances are appended by each surface.
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(2716.16, 2);
  });

  it("splits a column carrying both a holiday premium and real rest-day OT", () => {
    const lines = earningsLines({
      ...AUG,
      ot2xAmount: 250,
      details: { ...AUG.details, ot_hours_2x: 3 },
    });
    const two = lines.filter((l) => l.field === "ot_2x_amount");
    expect(two.map((l) => [l.label, l.amount])).toEqual([
      ["Public Holiday Pay (1 day worked) · 2 days' wages", 169.23],
      ["OT 2.0× (Rest Day) · 3.0h", 80.77],
    ]);
    // Neither half may be edited inline: the run page writes the whole column.
    expect(two.every((l) => !l.ownsField)).toBe(true);
  });

  it("gives a premium the whole column when no overtime remains", () => {
    // A sub-cent rounding remainder must not fall out of the payslip and leave
    // the earnings column short of gross.
    const lines = earningsLines({
      ...AUG,
      ot2xAmount: 169.234,
      details: { ...AUG.details, ph_premium_amount: 169.23 },
    });
    const ph = lines.find((l) => l.key === "public_holiday")!;
    expect(ph.amount).toBe(169.234);
    expect(ph.ownsField).toBe(true);
    expect(lines.some((l) => l.key === "ot_2x")).toBe(false);
  });

  it("shows plain overtime when the column carries no premium", () => {
    const lines = earningsLines({
      basicSalary: 2200,
      ot2xAmount: 80.77,
      details: { ot_hours_2x: 3 },
    });
    expect(lines[1]).toMatchObject({ key: "ot_2x", label: "OT 2.0× (Rest Day) · 3.0h", ownsField: true });
  });

  it("never invents a negative overtime line from a stale detail block", () => {
    // ph_premium_amount larger than the column it rides in — e.g. details
    // written by an older run against a hand-edited 2× amount.
    const lines = earningsLines({
      basicSalary: 2200,
      ot2xAmount: 50,
      details: { ph_premium_amount: 169.23, ph_days_worked: 1 },
    });
    expect(lines.filter((l) => l.field === "ot_2x_amount")).toHaveLength(1);
    expect(lines[1].amount).toBe(50);
    expect(lines.every((l) => l.amount >= 0)).toBe(true);
  });

  it("emits basic alone when there is no overtime at all", () => {
    expect(earningsLines({ basicSalary: 2200, details: {} })).toEqual([
      { key: "basic", field: "basic_salary", label: "Basic Salary", amount: 2200, ownsField: true },
    ]);
  });

  it("labels a weekly run's basic line as hourly wages", () => {
    const [basic] = earningsLines({
      basicSalary: 340,
      isWeekly: true,
      regularHours: 42.5,
      hourlyRate: 8,
      details: {},
    });
    expect(basic.label).toBe("Hourly Wages · 42.5h × RM8.00/h");
  });
});
