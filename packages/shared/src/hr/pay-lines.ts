// ONE set of earnings lines — description, quantity, rate and amount — for the
// payroll run page, the staff payslip page, the payslip PDF and the manager app.
//
// Owner 2026-09-15, on "Public Holiday Pay (1 day × 2)": "the line format is
// also very confusing and not standardize" … "cant we follow the industry
// term?" … "no need to explain the 1day x 2 etc. weekday etc. this is very
// weird."
//
// The root cause was the LAYOUT, not the wording. A Malaysian payslip is
// Description | Qty | Rate | Amount, and showing the overtime hours and the
// rate applied — rather than a lump sum — is required, not decorative
// (Employment Act 1955 s.60A; payslip particulars). Ours had only
// Description | Amount, so every attempt to convey "how many" and "at what
// rate" got crammed into the description as prose:
//
//     OT 1.5× (Weekday) · 18.5h
//     Public Holiday Pay (1 day × 2)
//
// "(1 day × 2)" is the worst of it: "1 day" is a COUNT of holidays worked and
// "× 2" a QUANTITY of wages paid — two different units welded together with a ×
// that reads as a rate next to the 1.5× and 3.0× lines around it.
//
// With a quantity column there is nothing to explain. The description is the
// plain industry term and the arithmetic speaks for itself:
//
//     Overtime 1.5×          18.5 hrs   16.92    313.08
//     Public Holiday Pay      2 days    84.62    169.23
//
// Qty and rate are DERIVED from what the calculator already stores (amount ÷
// hours, amount ÷ wage-days), so this needs no migration and works on historical
// items too. A line with no meaningful quantity — basic salary, an allowance —
// leaves the columns empty.
//
// Surfaces with room (PDF, run page, staff web) render qty and rate as their own
// columns; at phone width the manager app puts `detail` under the description as
// a muted sub-line. No surface formats anything itself.
//
// VENDORED COPY. apps/staff-native/lib/hr/pay-lines.ts is a byte-for-byte copy
// of this file. The manager app is an Expo app whose Metro config has no
// monorepo resolution, and rewiring that ships through OTA to live manager
// phones — not something to risk for label strings. pay-lines.vendored.test.ts
// fails the build if the two files differ by one character, so edit this one
// and re-copy:  cp packages/shared/src/hr/pay-lines.ts apps/staff-native/lib/hr/
//
// Before this existed, four surfaces each re-derived the premium-out-of-column
// split by hand with four different epsilons (< 0.01 in three places, > 0.004,
// > 0), and the manager app hand-copied the label strings — which had already
// drifted to "Basic" / "Basic Salary" / "Basic salary" and "1h" / "1.0h".
//
// Rate classes (Employment Act 1955):
//   1.0× — hours worked beyond an approved OT budget (owner policy 2026-08-03:
//          paid at plain rate, never zeroed).
//   1.5× — overtime on a normal working day (s.60A(3)(a)).
//   2.0× — overtime on a rest day (s.60(3)(c)).
//   3.0× — overtime on a public holiday (s.60D(3)(aa)).
//   Public Holiday Pay — two days' wages at the ordinary rate for normal hours
//          on a holiday (s.60D(3)(a)), on top of the holiday pay that salary
//          already covers. Rides in the 2× amount.
//   Rest Day Pay — half / one day's wages for normal hours on a rostered rest
//          day (s.60(3)(b)). Rides in the 1× amount.

export type OtRateKey = "1x" | "1_5x" | "2x" | "3x";

/** Plain industry descriptions. The rate class is the multiplier and nothing
 *  more: which DAY earns which multiplier is the calculator's business, not a
 *  reader's — "(Weekday)" and "(Public Holiday)" only invited the question. */
export const OT_LINE_BASE: Record<OtRateKey, string> = {
  "1x": "Overtime 1.0×",
  "1_5x": "Overtime 1.5×",
  "2x": "Overtime 2.0×",
  "3x": "Overtime 3.0×",
};

export const BASIC_SALARY_LABEL = "Basic Salary";
export const HOURLY_WAGES_LABEL = "Hourly Wages";
export const PUBLIC_HOLIDAY_LABEL = "Public Holiday Pay";
export const REST_DAY_LABEL = "Rest Day Pay";

/** s.60D(3)(a) pays two days' wages per holiday worked, on top of salary. */
export const PUBLIC_HOLIDAY_WAGE_DAYS = 2;

/** Amounts are stored to 2dp, so half a cent is the floor for a real line. */
const CENT = 0.005;

/** Money to 2dp. Subtracting a premium out of its column leaks binary float
 *  residue otherwise — 250 - 169.23 renders as 80.77000000000001. */
const r2 = (n: number) => Math.round(n * 100) / 100;

/** "18.5", "1.0", "2" — at most 2dp; whole values keep `wholeDecimals`. */
function num(n: number, wholeDecimals = 0): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return Number.isInteger(v) ? v.toFixed(wholeDecimals) : String(v);
}

/** Hours as "2.5h" — for callers that still show hours inline. */
export function fmtHours(h: number): string {
  const n = Math.round((Number(h) || 0) * 100) / 100;
  return `${Number.isInteger(n) ? n.toFixed(1) : String(n)}h`;
}

export function otLineLabel(rate: OtRateKey): string {
  return OT_LINE_BASE[rate];
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
  /** Plain industry description — "Overtime 1.5×", "Public Holiday Pay". */
  label: string;
  /** "18.5 hrs" / "2 days". Empty when the line has no meaningful quantity. */
  qty: string;
  /** Rate per hour or per day, 2dp. Empty when there is no quantity to rate. */
  rate: string;
  /** "18.5 hrs × 16.92" — qty and rate for a layout with no room for columns. */
  detail: string;
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
  /** Weekly part-timer runs describe the basic line as hourly wages. */
  isWeekly?: boolean;
  regularHours?: number | null;
  hourlyRate?: number | null;
  ot1xAmount?: number | null;
  ot1_5xAmount?: number | null;
  ot2xAmount?: number | null;
  ot3xAmount?: number | null;
  details?: Record<string, unknown> | null;
};

type Measure = Pick<EarningsLine, "qty" | "rate" | "detail">;

const NO_MEASURE: Measure = { qty: "", rate: "", detail: "" };

/** Qty, rate and the combined detail string, from an amount and its units. */
function measure(amount: number, quantity: number, unit: "hrs" | "days"): Measure {
  if (!(quantity > 0)) return NO_MEASURE;
  const qty = `${num(quantity, unit === "hrs" ? 1 : 0)} ${unit}`;
  const rate = r2(amount / quantity).toFixed(2);
  return { qty, rate, detail: `${qty} × ${rate}` };
}

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

  const basic = n(input.basicSalary);
  const regularHours = n(input.regularHours);
  lines.push({
    key: "basic",
    field: "basic_salary",
    label: input.isWeekly ? HOURLY_WAGES_LABEL : BASIC_SALARY_LABEL,
    // A monthly salary has no quantity — it is the contracted figure, not 26 ×
    // a daily rate. Only hourly wages are a genuine qty × rate.
    ...(input.isWeekly && regularHours > 0 ? measure(basic, regularHours, "hrs") : NO_MEASURE),
    amount: basic,
    ownsField: true,
  });

  type PremiumSpec = Pick<EarningsLine, "key" | "field" | "label"> & { quantity: number };
  type OtSpec = Pick<EarningsLine, "key" | "field" | "label"> & { hours: number };

  // A column carrying a day-type premium splits into the premium and whatever
  // real overtime remains at that rate.
  const split = (column: number, premium: number, prem: PremiumSpec, ot: OtSpec) => {
    if (!(column > CENT)) return;
    const p = Math.min(Math.max(0, premium), column);
    const rest = column - p;
    const otLine = ({ hours, ...spec }: OtSpec, amount: number, owns: boolean): EarningsLine =>
      ({ ...spec, ...measure(amount, hours, "hrs"), amount, ownsField: owns });
    const premLine = ({ quantity, ...spec }: PremiumSpec, amount: number, owns: boolean): EarningsLine =>
      ({ ...spec, ...measure(amount, quantity, "days"), amount, ownsField: owns });

    if (p <= CENT) {
      lines.push(otLine(ot, column, true));
      return;
    }
    if (rest <= CENT) {
      // The premium takes the whole column so a sub-cent rounding remainder
      // cannot fall out of the payslip and leave earnings short of gross.
      lines.push(premLine(prem, column, true));
      return;
    }
    const shown = r2(p);
    lines.push(premLine(prem, shown, false));
    lines.push(otLine(ot, r2(column - shown), false));
  };

  // Rest-day day-pay rides in the 1× column. Its quantity is days' WAGES (half a
  // day for a short shift), which is what the amount is a multiple of — days
  // WORKED would give a wrong rate.
  split(
    n(input.ot1xAmount),
    n(d.rest_day_pay_amount),
    { key: "rest_day", field: "ot_1x_amount", label: REST_DAY_LABEL, quantity: n(d.rest_day_wage_days) },
    { key: "ot_1x", field: "ot_1x_amount", label: OT_LINE_BASE["1x"], hours: n(otH["1x"]) },
  );

  const ot15 = n(input.ot1_5xAmount);
  if (ot15 > CENT) {
    lines.push({
      key: "ot_1_5x",
      field: "ot_1_5x_amount",
      label: OT_LINE_BASE["1_5x"],
      ...measure(ot15, n(otH["1_5x"]), "hrs"),
      amount: ot15,
      ownsField: true,
    });
  }

  // Holiday wages ride in the 2× column: two days' wages per holiday worked, so
  // the quantity is days × 2 — which is the "× 2" the old label tried to spell out.
  split(
    n(input.ot2xAmount),
    n(d.ph_premium_amount),
    {
      key: "public_holiday",
      field: "ot_2x_amount",
      label: PUBLIC_HOLIDAY_LABEL,
      quantity: n(d.ph_days_worked) * PUBLIC_HOLIDAY_WAGE_DAYS,
    },
    { key: "ot_2x", field: "ot_2x_amount", label: OT_LINE_BASE["2x"], hours: n(otH["2x"]) },
  );

  const ot3 = n(input.ot3xAmount);
  if (ot3 > CENT) {
    lines.push({
      key: "ot_3x",
      field: "ot_3x_amount",
      label: OT_LINE_BASE["3x"],
      ...measure(ot3, n(otH["3x"]), "hrs"),
      amount: ot3,
      ownsField: true,
    });
  }

  return lines;
}
