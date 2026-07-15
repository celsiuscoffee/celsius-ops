// Man-hours-per-day model — the single planning unit that serves BOTH the cost
// target (18–20% of revenue) and the coverage target (enough hands for the
// day's volume). For each day we derive two numbers from the same lever:
//
//   required   = throughput-hours the day's VOLUME needs, floored at the
//                service minimum. Volume is measured in ITEMS (drinks made),
//                not ringgit — making drinks is the labour, and a low-ticket
//                high-volume morning needs more hands than its revenue implies.
//   affordable = man-hours the day's REVENUE can pay for at the target %.
//
// `required ≤ affordable`  → cover the day, cost lands at/under target.
// `required > affordable`  → the two goals can't both be met that day; the gap
//                            is surfaced (often because the service FLOOR, not
//                            demand, sets the requirement on a quiet day — a
//                            revenue problem, not a rostering one).
//
// This module is the pure calc + calibratable constants; callers fetch the
// throughput/revenue history and the real roster is still costed exactly by
// the labour gate.

// Drinks/items one head makes+serves per hour at steady state — the single
// productivity constant that replaces the old RM-per-labour-hour heuristic.
// Calibrate per outlet from (items sold ÷ man-hours actually worked); this is
// a deliberately conservative default until that number is measured.
export const DEFAULT_ITEMS_PER_MAN_HOUR = 18;

// Per-outlet productivity overrides (Outlet.code → items/man-hour). Seed once
// calibrated; anything absent falls back to the default.
export const ITEMS_PER_MAN_HOUR: Record<string, number> = {};

export function itemsPerManHourFor(code: string | null | undefined): number {
  return (code && ITEMS_PER_MAN_HOUR[code]) || DEFAULT_ITEMS_PER_MAN_HOUR;
}

// Blended labour cost per man-hour (RM) used ONLY to translate the revenue
// budget into an affordable-hours figure. FT hourly (salary ÷ workday hours,
// +employer load) blended with PT rates ≈ RM12 as a planning default. The gate
// still prices the actual roster to the ringgit — this is for the target line.
export const DEFAULT_BLENDED_RATE = 12;

export type DailyManHours = {
  date: string;
  forecastItems: number;
  forecastRevenue: number;
  throughputHours: number; // items ÷ productivity
  floorHours: number; // serviceMinHeads × openHours
  requiredHours: number; // max(throughput, floor) — the coverage target
  affordableHours: number; // revenue × target% ÷ blendedRate — the cost ceiling
  gapHours: number; // required − affordable (>0 ⇒ can't cover within target)
  floorBound: boolean; // the service floor, not demand, sets the requirement
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeDailyManHours(input: {
  date: string;
  forecastItems: number;
  forecastRevenue: number;
  itemsPerManHour: number;
  serviceMinHeads: number;
  openHours: number;
  targetPct: number;
  blendedRate: number;
}): DailyManHours {
  const throughputHours = input.itemsPerManHour > 0 ? input.forecastItems / input.itemsPerManHour : 0;
  const floorHours = Math.max(0, input.serviceMinHeads * input.openHours);
  const requiredHours = Math.max(throughputHours, floorHours);
  const affordableHours = input.blendedRate > 0 ? (input.forecastRevenue * input.targetPct) / input.blendedRate : 0;
  return {
    date: input.date,
    forecastItems: Math.round(input.forecastItems),
    forecastRevenue: Math.round(input.forecastRevenue),
    throughputHours: round1(throughputHours),
    floorHours: round1(floorHours),
    requiredHours: round1(requiredHours),
    affordableHours: round1(affordableHours),
    gapHours: round1(requiredHours - affordableHours),
    floorBound: floorHours >= throughputHours,
  };
}
