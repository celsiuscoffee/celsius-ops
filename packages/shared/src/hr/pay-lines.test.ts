import { describe, it, expect } from "vitest";
import { earningsLines, otLineLabel, OT_LINE_BASE } from "./pay-lines";

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

const rows = (input: Parameters<typeof earningsLines>[0]) =>
  earningsLines(input).map((l) => [l.label, l.qty, l.rate, l.amount]);

describe("descriptions", () => {
  it("are the plain industry term, with nothing explained in brackets", () => {
    // Owner: "no need to explain the 1day x 2 etc. weekday etc. this is very
    // weird." Which DAY earns which multiplier is the calculator's business.
    expect(Object.values(OT_LINE_BASE)).toEqual([
      "Overtime 1.0×", "Overtime 1.5×", "Overtime 2.0×", "Overtime 3.0×",
    ]);
    for (const label of Object.values(OT_LINE_BASE)) {
      expect(label).not.toMatch(/[()]/);
    }
    expect(otLineLabel("1_5x")).toBe("Overtime 1.5×");
  });

  it("never puts a quantity inside the description", () => {
    for (const l of earningsLines(AUG)) {
      expect(l.label).not.toMatch(/\d+\s*(day|hr|h\b)/i);
      expect(l.label).not.toContain("× 2");
    }
  });
});

describe("earningsLines", () => {
  it("renders the August payslip with the arithmetic in its own columns", () => {
    expect(rows(AUG)).toEqual([
      ["Basic Salary",       "",         "",      2200],
      ["Overtime 1.5×",      "18.5 hrs", "16.92", 313.08],
      ["Public Holiday Pay", "2 days",   "84.62", 169.23],
      ["Overtime 3.0×",      "1.0 hrs",  "33.85", 33.85],
    ]);
  });

  it("states the holiday quantity as days' WAGES, so 2 days × ORP ties out", () => {
    // s.60D(3)(a): two days' wages per holiday worked. One holiday -> 2 days at
    // the ordinary rate (2200/26 = 84.62). This is the "× 2" the old label was
    // trying to explain in prose.
    const ph = earningsLines(AUG).find((l) => l.key === "public_holiday")!;
    expect(ph.qty).toBe("2 days");
    expect(Number(ph.rate)).toBeCloseTo(2200 / 26, 1);
    expect(ph.detail).toBe("2 days × 84.62");
  });

  it("keeps the AMOUNT authoritative — a displayed rate is rounded to 2dp", () => {
    // 169.23 / 2 = 84.615, which prints as 84.62; 84.62 x 2 reads back 169.24.
    // A payslip cannot show 84.615, so the cent has to land somewhere: it lands
    // in the rate, never in the amount. Gross always ties to the amount column.
    const ph = earningsLines(AUG).find((l) => l.key === "public_holiday")!;
    expect(ph.rate).toBe("84.62");
    expect(ph.amount).toBe(169.23);
    // At most one cent per unit of quantity, and it never touches the amount.
    expect(Math.round(Math.abs(Number(ph.rate) * 2 - ph.amount) * 100)).toBeLessThanOrEqual(2);
  });

  it("scales the holiday quantity with the holidays worked", () => {
    const two = earningsLines({
      ...AUG, ot2xAmount: 338.46,
      details: { ...AUG.details, ph_premium_amount: 338.46, ph_days_worked: 2 },
    }).find((l) => l.key === "public_holiday")!;
    expect(two.qty).toBe("4 days");
    expect(two.rate).toBe("84.62");
  });

  it("rates rest-day pay on days' wages, not days worked", () => {
    // Two rest days, one short (half a day's wages) and one full = 1.5 days'
    // wages. Rating on "2 days worked" would understate the daily rate.
    const rd = earningsLines({
      basicSalary: 2200,
      ot1xAmount: 126.92,
      details: { rest_day_pay_amount: 126.92, rest_day_days_worked: 2, rest_day_wage_days: 1.5 },
    }).find((l) => l.key === "rest_day")!;
    expect(rd.qty).toBe("1.5 days");
    expect(Number(rd.rate)).toBeCloseTo(2200 / 26, 1);
    expect(rd.amount).toBe(126.92);
  });

  it("leaves qty and rate empty for a monthly salary", () => {
    // A monthly salary is the contracted figure, not 26 × a daily rate.
    const [basic] = earningsLines(AUG);
    expect([basic.qty, basic.rate, basic.detail]).toEqual(["", "", ""]);
  });

  it("rates a weekly part-timer's wages by the hours clocked", () => {
    const [basic] = earningsLines({
      basicSalary: 340, isWeekly: true, regularHours: 42.5, details: {},
    });
    expect([basic.label, basic.qty, basic.rate]).toEqual(["Hourly Wages", "42.5 hrs", "8.00"]);
  });

  it("splits a column carrying both a holiday premium and real rest-day OT", () => {
    const lines = earningsLines({
      ...AUG, ot2xAmount: 250,
      details: { ...AUG.details, ot_hours_2x: 3 },
    });
    const two = lines.filter((l) => l.field === "ot_2x_amount");
    expect(two.map((l) => [l.label, l.qty, l.amount])).toEqual([
      ["Public Holiday Pay", "2 days", 169.23],
      ["Overtime 2.0×", "3.0 hrs", 80.77], // not 80.77000000000001
    ]);
    // Neither half may be edited inline: the run page writes the whole column.
    expect(two.every((l) => !l.ownsField)).toBe(true);
  });

  it("gives a premium the whole column when no overtime remains", () => {
    // A sub-cent remainder must not fall out and leave earnings short of gross.
    const lines = earningsLines({
      ...AUG, ot2xAmount: 169.234,
      details: { ...AUG.details, ph_premium_amount: 169.23 },
    });
    const ph = lines.find((l) => l.key === "public_holiday")!;
    expect(ph.amount).toBe(169.234);
    expect(ph.ownsField).toBe(true);
    expect(lines.some((l) => l.key === "ot_2x")).toBe(false);
  });

  it("never invents a negative overtime line from a stale detail block", () => {
    const lines = earningsLines({
      basicSalary: 2200, ot2xAmount: 50,
      details: { ph_premium_amount: 169.23, ph_days_worked: 1 },
    });
    expect(lines.filter((l) => l.field === "ot_2x_amount")).toHaveLength(1);
    expect(lines[1].amount).toBe(50);
    expect(lines.every((l) => l.amount >= 0)).toBe(true);
  });

  it("omits qty and rate rather than dividing by a missing quantity", () => {
    // Historical items carry an amount with no hours recorded.
    const lines = earningsLines({
      basicSalary: 2200, ot1_5xAmount: 313.08, details: {},
    });
    const ot = lines.find((l) => l.key === "ot_1_5x")!;
    expect([ot.qty, ot.rate, ot.detail]).toEqual(["", "", ""]);
    expect(ot.amount).toBe(313.08);
  });

  it("emits basic alone when there is no overtime at all", () => {
    expect(earningsLines({ basicSalary: 2200, details: {} })).toEqual([
      { key: "basic", field: "basic_salary", label: "Basic Salary",
        qty: "", rate: "", detail: "", amount: 2200, ownsField: true },
    ]);
  });
});
