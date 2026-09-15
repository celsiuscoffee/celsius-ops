// ONE set of earnings lines — labels AND the money split — for the payroll run
// page, the staff payslip page, the payslip PDF and the manager app.
//
// Owner 2026-09-03: "standardize the OT lines". Owner 2026-09-15: "the line
// format is also very confusing and not standardize", looking at
// "Public Holiday Pay (1 day × 2)".
//
// TWO problems were behind that.
//
// 1. "× 2" read as a RATE. Every neighbouring line puts a multiplier before the
//    × ("OT 1.5×", "OT 3.0×"), so the eye parses "1 day × 2" as a 2× rate on one
//    day. It is not a rate: it is a COUNT of holidays worked ("1 day") glued
//    with × to a QUANTITY of wages paid ("2 days' wages") — two different units.
//    Every line now reads <what> (<what was worked>) · <what is paid>, and a
//    quantity of wages is always spelled "days' wages", never a multiplier.
//
// 2. Four surfaces each re-derived the split by hand, with four different
//    epsilons (< 0.01, > 0.004, > 0), and the manager app hand-copied the label
//    strings instead of importing them. They had drifted: "Basic" / "Basic
//    Salary" / "Basic salary"; "1.0h" / "1h". earningsLines() below is now the
//    single derivation — callers render what it returns and format nothing.
//
// VENDORED COPY. apps/staff-native/lib/hr/pay-lines.ts is a byte-for-byte copy
// of this file. The manager app is an Expo app whose Metro config has no
// monorepo resolution, and rewiring that ships through OTA to live manager
// phones — not something to risk for label strings. pay-lines.vendored.test.ts
// fails the build if the two files differ by one character, so edit this one
// and re-copy:  cp packages/shared/src/hr/pay-lines.ts apps/staff-native/lib/hr/
//
// Rate classes (Employment Act 1955):
//   1.0× — hours worked beyond an approved OT budget (owner policy 2026-08-03:
//          paid at plain rate, never zeroed) and rest-day day-pay.
//   1.5× — overtime on a normal working day (s.60A(3)(a)).
//   2.0× — overtime on a rest day (s.60(3)(c)).
//   3.0× — overtime on a public holiday (s.60D(3)(aa)).
//   Public Holiday Pay — the SECOND AND THIRD days' wages for normal hours on a
//          holiday (s.60D(3)(a): "two days' wages at the ordinary rate of pay",
//          in addition to the holiday pay that salary already covers). Rides in
//          the 2× amount.
//   Rest Day Pay — half / one day's wages for normal hours on a rostered rest
//          day (s.60(3)(b)). Rides in the 1× amount.

export type OtRateKey = "1x" | "1_5x" | "2x" | "3x";

export const OT_LINE_BASE: Record<OtRateKey, string> = {
  "1x": "OT 1.0× (Plain Rate)",
  "1_5x": "OT 1.5× (Weekday)",
  "2x": "OT 2.0× (Rest Day)",
  "3x": "OT 3.0× (Public Holiday)",
};

export const BASIC_SALARY_LABEL = "Basic Salary";

/** Amounts are stored to 2dp, so half a cent is the floor for a real line. */
const CENT = 0.005;

/** Money to 2dp. Subtracting a premium out of its column leaks binary float
 *  residue otherwise — 250 - 169.23 renders as 80.77000000000001. */
const r2 = (n: number) => Math.round(n * 100) / 100;

/** "2.5h", "0.5h" — trims trailing zeros. */
export function fmtHours(h: number): string {
  const n = Math.round((Number(h) || 0) * 100) / 100;
  return `${Number.isInteger(n) ? n.toFixed(1) : String(n)}h`;
}

/** "1 day" / "2 days" — the count of days WORKED. */
function fmtDaysWorked(d: number): string {
  const n = Math.round((Number(d) || 0) * 10) / 10;
  return `${n} day${n === 1 ? "" : "s"} worked`;
}

/**
 * "2 days' wages", "1 day's wages", "1½ days' wages" — the quantity of wages
 * PAID. Never a multiplier: a rest day can pay half a day, which "× ½" would
 * render nonsensically next to the 1.5×/3.0× OT lines.
 */
function fmtWageDays(d: number): string {
  const n = Math.round((Number(d) || 0) * 100) / 100;
  if (n <= 0) return "";
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  const body = half ? `${whole > 0 ? whole : ""}½` : String(whole);
  // "½ day's wages" and "1 day's wages" — singular possessive up to one day;
  // "1½ days' wages" and "2 days' wages" beyond it.
  return `${body} day${n > 1 ? "s'" : "'s"} wages`;
}

export function otLineLabel(rate: OtRateKey, hours?: number | null): string {
  const h = Number(hours) || 0;
  return h > 0 ? `${OT_LINE_BASE[rate]} · ${fmtHours(h)}` : OT_LINE_BASE[rate];
}

/** "Hourly Wages · 42.5h × RM8.00/h" — the weekly part-timer's basic line. */
export function hourlyWagesLabel(hours?: number | null, rate?: number | null): string {
  const h = Number(hours) || 0;
  const r = Number(rate) || 0;
  if (h <= 0) return "Hourly Wages";
  return r > 0 ? `Hourly Wages · ${fmtHours(h)} × RM${r.toFixed(2)}/h` : `Hourly Wages · ${fmtHours(h)}`;
}

/** s.60D(3)(a) pays two days' wages per holiday worked, on top of salary. */
export const PUBLIC_HOLIDAY_WAGE_DAYS = 2;

/**
 * Public-holiday second-and-third days' wages (EA s.60D(3)(a)).
 * "Public Holiday Pay (1 day worked) · 2 days' wages".
 *
 * Days when the calculator recorded them (post-2026-09-03 runs); hours for
 * older items that only carry hours — those cannot state the wage quantity,
 * because the number of holidays behind the hours is unknown.
 */
export function publicHolidayPayLabel(days?: number | null, hours?: number | null): string {
  const d = Number(days) || 0;
  const h = Number(hours) || 0;
  if (d > 0) return `Public Holiday Pay (${fmtDaysWorked(d)}) · ${fmtWageDays(d * PUBLIC_HOLIDAY_WAGE_DAYS)}`;
  if (h > 0) return `Public Holiday Pay (${fmtHours(h)} worked)`;
  return "Public Holiday Pay";
}

/**
 * Rest-day day-pay (EA s.60(3)(b)). "Rest Day Pay (1 day worked) · 1 day's
 * wages". `wageDays` is half a day for a short shift and a full day beyond half
 * the normal hours, so it cannot be derived from the day count — items computed
 * before `rest_day_wage_days` existed simply omit the wage quantity.
 */
export function restDayPayLabel(days?: number | null, wageDays?: number | null): string {
  const d = Number(days) || 0;
  if (d <= 0) return "Rest Day Pay";
  const w = fmtWageDays(Number(wageDays) || 0);
  return w ? `Rest Day Pay (${fmtDaysWorked(d)}) · ${w}` : `Rest Day Pay (${fmtDaysWorked(d)})`;
}

/** Per-rate OT hours as the calculator writes them into computation_details. */
export type OtHoursByRate = Partial<Record<OtRateKey, number>>;

export function otHoursFromDetails(details: Record<string, unknown> | null | undefined): OtHoursByRate {
  const d = details || {};
  const n = (k: string) => (d[k] == null ? undefined : Number(d[k]) || 0);
  return {
    "1x": n("ot_hours_1x"),
    "1_5x": n("ot_hours_1_5x"),
    "2x": n("ot_hours_2x"),
    "3x": n("ot_hours_3x"),
  };
}

/** hr_payroll_items column an earnings line's amount is stored in. */
export type EarningsField =
  | "basic_salary"
  | "ot_1x_amount"
  | "ot_1_5x_amount"
  | "ot_2x_amount"
  | "ot_3x_amount";

export type EarningsLine = {
  key: "basic" | "ot_1x" | "ot_1_5x" | "ot_2x" | "ot_3x" | "rest_day" | "public_holiday";
  field: EarningsField;
  label: string;
  amount: number;
  /**
   * True when this line is the whole of its column. Two lines share a column
   * when a rest-day/holiday premium sits alongside real overtime at the same
   * rate; the run page can only edit a column as a whole, so it must not offer
   * an inline edit on half of one.
   */
  ownsField: boolean;
};

export type EarningsInput = {
  basicSalary: number;
  /** Weekly part-timer runs label the basic line as hourly wages. */
  isWeekly?: boolean;
  regularHours?: number | null;
  hourlyRate?: number | null;
  ot1xAmount?: number | null;
  ot1_5xAmount?: number | null;
  ot2xAmount?: number | null;
  ot3xAmount?: number | null;
  details?: Record<string, unknown> | null;
};

/**
 * The earnings lines for one payroll item, in payslip order.
 *
 * Keyed on MONEY, not OT hours: the public-holiday wages (EA s.60D) ride in the
 * 2× column with ZERO OT hours for a full-timer who worked a normal 31-Aug
 * shift. Gating on hours hid the line while its money sat in gross (owner
 * 2026-09-03: "the PH OT not in payroll").
 */
export function earningsLines(input: EarningsInput): EarningsLine[] {
  const n = (v: unknown) => Number(v ?? 0) || 0;
  const d = input.details || {};
  const otH = otHoursFromDetails(d);
  const lines: EarningsLine[] = [];

  lines.push({
    key: "basic",
    field: "basic_salary",
    label: input.isWeekly ? hourlyWagesLabel(input.regularHours, input.hourlyRate) : BASIC_SALARY_LABEL,
    amount: n(input.basicSalary),
    ownsField: true,
  });

  // A column carrying a day-type premium splits into the premium and whatever
  // real overtime remains at that rate. Clamp the premium to the column so a
  // stale detail block can never invent a negative OT line.
  const split = (
    column: number,
    premium: number,
    premiumLine: Omit<EarningsLine, "amount" | "ownsField">,
    otLine: Omit<EarningsLine, "amount" | "ownsField">,
  ) => {
    if (!(column > CENT)) return;
    const p = Math.min(Math.max(0, premium), column);
    const ot = column - p;
    if (p <= CENT) {
      // No premium — the whole column is overtime at this rate.
      lines.push({ ...otLine, amount: column, ownsField: true });
      return;
    }
    if (ot <= CENT) {
      // No overtime — the whole column is the premium. It takes the column
      // rather than `p` so a sub-cent rounding remainder cannot fall out of
      // the payslip and leave the earnings short of gross.
      lines.push({ ...premiumLine, amount: column, ownsField: true });
      return;
    }
    // Round the premium, then take the remainder from the column so the two
    // lines still sum to exactly what is stored.
    const shown = r2(p);
    lines.push({ ...premiumLine, amount: shown, ownsField: false });
    lines.push({ ...otLine, amount: r2(column - shown), ownsField: false });
  };

  split(
    n(input.ot1xAmount),
    n(d.rest_day_pay_amount),
    {
      key: "rest_day",
      field: "ot_1x_amount",
      label: restDayPayLabel(d.rest_day_days_worked as number, d.rest_day_wage_days as number),
    },
    { key: "ot_1x", field: "ot_1x_amount", label: otLineLabel("1x", otH["1x"]) },
  );

  const ot15 = n(input.ot1_5xAmount);
  if (ot15 > CENT) {
    lines.push({
      key: "ot_1_5x",
      field: "ot_1_5x_amount",
      label: otLineLabel("1_5x", otH["1_5x"]),
      amount: ot15,
      ownsField: true,
    });
  }

  split(
    n(input.ot2xAmount),
    n(d.ph_premium_amount),
    {
      key: "public_holiday",
      field: "ot_2x_amount",
      label: publicHolidayPayLabel(d.ph_days_worked as number, d.ph_premium_hours as number),
    },
    { key: "ot_2x", field: "ot_2x_amount", label: otLineLabel("2x", otH["2x"]) },
  );

  const ot3 = n(input.ot3xAmount);
  if (ot3 > CENT) {
    lines.push({
      key: "ot_3x",
      field: "ot_3x_amount",
      label: otLineLabel("3x", otH["3x"]),
      amount: ot3,
      ownsField: true,
    });
  }

  return lines;
}
