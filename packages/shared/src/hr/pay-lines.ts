// ONE set of earnings-line labels for the payroll run page, the staff payslip
// page and the payslip PDF. Owner 2026-09-03: "standardize the OT lines" —
// the three surfaces had drifted ("OT 1.5x", "OT 2x (Rest)", "OT (2.0× rest
// day / public holiday)", "Public holiday pay (7h × 2)"). Title Case to match
// "Basic" and "Performance Allowance"; the rate as a multiplier; the day type
// in brackets; the hours after a middle dot when known.
//
// Rate classes (Employment Act 1955):
//   1.0× — hours worked beyond an approved OT budget (owner policy 2026-08-03:
//          paid at plain rate, never zeroed) and rest-day day-pay.
//   1.5× — overtime on a normal working day (s.60A(3)(a)).
//   2.0× — overtime on a rest day (s.60(3)(c)).
//   3.0× — overtime on a public holiday (s.60D(3)(aa)).
//   Public Holiday Pay — the SECOND day's wages for normal hours on a holiday
//          (s.60D(3)(a)); salary pays the first. Rides in the 2× amount.
//   Rest Day Pay — half / one day's wages for normal hours on a rostered rest
//          day (s.60(3)(b)). Rides in the 1× amount.

export type OtRateKey = "1x" | "1_5x" | "2x" | "3x";

export const OT_LINE_BASE: Record<OtRateKey, string> = {
  "1x": "OT 1.0× (Plain Rate)",
  "1_5x": "OT 1.5× (Weekday)",
  "2x": "OT 2.0× (Rest Day)",
  "3x": "OT 3.0× (Public Holiday)",
};

/** "2.5h", "0.5h" — trims trailing zeros. */
export function fmtHours(h: number): string {
  const n = Math.round((Number(h) || 0) * 100) / 100;
  return `${Number.isInteger(n) ? n.toFixed(1) : String(n)}h`;
}

export function otLineLabel(rate: OtRateKey, hours?: number | null): string {
  const h = Number(hours) || 0;
  return h > 0 ? `${OT_LINE_BASE[rate]} · ${fmtHours(h)}` : OT_LINE_BASE[rate];
}

/**
 * Public-holiday second-day wage. Days when the calculator recorded them
 * (post-2026-09-03 runs); hours for older items that only carry hours.
 */
export function publicHolidayPayLabel(days?: number | null, hours?: number | null): string {
  const d = Number(days) || 0;
  const h = Number(hours) || 0;
  if (d > 0) return `Public Holiday Pay (${d} day${d === 1 ? "" : "s"} × 2)`;
  if (h > 0) return `Public Holiday Pay (${fmtHours(h)} × 2)`;
  return "Public Holiday Pay";
}

export function restDayPayLabel(days?: number | null): string {
  const d = Number(days) || 0;
  return d > 0 ? `Rest Day Pay (${d} day${d === 1 ? "" : "s"})` : "Rest Day Pay";
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
