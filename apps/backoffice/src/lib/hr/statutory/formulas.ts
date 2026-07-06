// Pure Malaysian statutory contribution math — NO I/O, so it can be unit-tested
// directly against the official KWSP / PERKESO published schedules. The async
// wrappers in calculators.ts fetch the rate config from the hr_stat_* tables and
// delegate here. Keep this file dependency-free.

/** Round to the nearest RM0.05 (PERKESO/LHDN cents rounding). */
export function roundToCents(amount: number): number {
  return Math.round(amount * 20) / 20;
}

// ─── EPF (KWSP Act 452, Third Schedule) ─────────────────────────
// Wage is rounded UP to the band CEILING, multiplied by the rate, and the
// contribution rounded UP to the next ringgit. Band width is RM20 up to
// RM5,000 and RM100 above RM5,000.
//
// FIX (H7): the previous code used RM20 bands for ALL wages, which understated
// contributions above RM5,000 (e.g. wage 5010 → RM553 instead of the statutory
// RM561, because ceil(5010/20)*20 = 5020 rather than ceil(5010/100)*100 = 5100).
export function epfBracket(wage: number): number {
  const step = wage <= 5000 ? 20 : 100;
  return Math.ceil(wage / step) * step;
}

export function epfContribution(args: {
  wage: number;
  employeeRate: number;            // %
  employerRateBelow5000: number;   // %
  employerRateAbove5000: number;   // %
  employeeRateOverride?: number;   // % (voluntary)
  employerRateOverride?: number;   // %
}): { employee: number; employer: number; bracket: number } {
  if (args.wage <= 10) return { employee: 0, employer: 0, bracket: 0 };
  const bracket = epfBracket(args.wage);
  const employeeRate = args.employeeRateOverride ?? args.employeeRate;
  const employerRate =
    args.employerRateOverride ??
    (args.wage <= 5000 ? args.employerRateBelow5000 : args.employerRateAbove5000);
  return {
    employee: Math.ceil((bracket * employeeRate) / 100),
    employer: Math.ceil((bracket * employerRate) / 100),
    bracket,
  };
}

// ─── SOCSO / EIS (PERKESO — Act 4 / Act 800) ────────────────────
// PERKESO's contribution schedule charges the rate on the band's ASSUMED WAGE,
// which is the band MIDPOINT — not its ceiling. For RM100 bands the midpoint is
// (ceiling − 50).
//
// FIX (H7): the previous code multiplied the rate by the band ceiling, which
// over-deducted by ~half a band every month (e.g. wage 2950 → employee SOCSO
// RM15.00 instead of the statutory RM14.75, which is 0.5% of the RM2,950
// assumed wage). Verified against PERKESO's published table: the RM2,900.01–
// 3,000.00 band is employee RM14.75 / employer RM51.65 for Category 1.
//
// NOTE: the very bottom of the PERKESO schedule has irregular sub-RM100 bands
// (0–30 nil, 30.01–50, 50.01–70, 70.01–100). This midpoint rule is exact for
// the RM100-band region (all real salaried staff); the handful of sub-RM100
// bands are not modelled here because no employee falls in them.
export function perkesoAssumedWage(cappedWage: number, roundTo: number): number {
  const ceiling = Math.ceil(cappedWage / roundTo) * roundTo;
  return ceiling - roundTo / 2;
}

export function socsoContribution(args: {
  wage: number;
  category: 1 | 2;
  wageCeiling: number;
  roundTo: number;
  cat1EmployeeRate: number; // %
  cat1EmployerRate: number; // %
  cat2EmployerRate: number; // %
}): { employee: number; employer: number; assumedWage: number } {
  if (args.wage <= 30) return { employee: 0, employer: 0, assumedWage: 0 };
  const capped = Math.min(args.wage, args.wageCeiling);
  const assumedWage = perkesoAssumedWage(capped, args.roundTo);
  if (args.category === 1) {
    return {
      employee: roundToCents(assumedWage * (args.cat1EmployeeRate / 100)),
      employer: roundToCents(assumedWage * (args.cat1EmployerRate / 100)),
      assumedWage,
    };
  }
  // Category 2 (60+): employer-only, injury-only scheme.
  return {
    employee: 0,
    employer: roundToCents(assumedWage * (args.cat2EmployerRate / 100)),
    assumedWage,
  };
}

export function eisContribution(args: {
  wage: number;
  wageCeiling: number;
  roundTo: number;
  employeeRate: number; // %
  employerRate: number; // %
}): { employee: number; employer: number; assumedWage: number } {
  if (args.wage <= 30) return { employee: 0, employer: 0, assumedWage: 0 };
  const capped = Math.min(args.wage, args.wageCeiling);
  const assumedWage = perkesoAssumedWage(capped, args.roundTo);
  return {
    employee: roundToCents(assumedWage * (args.employeeRate / 100)),
    employer: roundToCents(assumedWage * (args.employerRate / 100)),
    assumedWage,
  };
}
