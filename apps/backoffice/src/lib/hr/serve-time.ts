// Serve-time self-calibration — the feedback loop that replaces a human judging
// "is the roster staffed enough?". The owner's service standard (2026-07-17):
//
//   • kitchen food     : served within 15 minutes
//   • beverage / pastry: served within 10 minutes
//
// The generator sizes heads from items ÷ station rate (barista 8/hr, kitchen
// 6/hr as base). Those rates were estimates; this module corrects them from the
// outlet's OWN measured serve times (pos_orders.created_at → served_at):
//
//   p90 serve BREACHES the target  → rate scales DOWN proportionally → the
//                                    demand model asks for MORE heads at the
//                                    hours that produced the breach.
//   p90 comfortably UNDER target   → rate nudges up slightly (leaner), inside a
//                                    deadband so it never flaps week to week.
//
// Deliberately a memoryless proportional controller computed fresh on every
// generation from the trailing window — no stored state, no migration, fully
// reproducible, and the reasoning lands in ai_notes. Staffing changes feed the
// next window's measurement, closing the loop.

export const BARISTA_SERVE_TARGET_MIN = 10; // beverage / pastry orders
export const KITCHEN_SERVE_TARGET_MIN = 15; // orders containing cooked food

// Minimum measured orders in the window before we trust the signal at all —
// below this the base rate stands (a new outlet shouldn't calibrate on noise).
export const MIN_SERVE_SAMPLE = 50;

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export type RateCalibration = {
  rate: number; // the rate to use this run
  baseRate: number;
  factor: number; // rate ÷ baseRate (1 = unchanged)
  reason: "no-data" | "breach" | "comfortable" | "on-target";
};

// Calibrate one station's items/head/hour rate from its measured p90 serve time.
//   breach   (p90 > target)        → factor = target ÷ p90 (proportional: a p90
//                                    of 20 vs target 15 cuts the rate to 75%,
//                                    asking ~⅓ more heads at loaded hours).
//   comfort  (p90 ≤ 70% of target) → factor = 1.1, one gentle step leaner.
//   deadband (between)             → unchanged.
// Factor is clamped to [0.6, 1.15] and the result to [floor, cap] so a single
// bad week can never halve the roster's throughput assumption or run it wild.
export function calibrateRate(input: {
  baseRate: number;
  p90ServeMin: number | null; // null = no measurement
  targetMin: number;
  sample: number;
  floor: number;
  cap: number;
}): RateCalibration {
  const { baseRate, p90ServeMin, targetMin, sample, floor, cap } = input;
  if (p90ServeMin == null || !Number.isFinite(p90ServeMin) || p90ServeMin <= 0 || sample < MIN_SERVE_SAMPLE) {
    return { rate: baseRate, baseRate, factor: 1, reason: "no-data" };
  }
  let factor: number;
  let reason: RateCalibration["reason"];
  if (p90ServeMin > targetMin) {
    factor = clamp(targetMin / p90ServeMin, 0.6, 1);
    reason = "breach";
  } else if (p90ServeMin <= targetMin * 0.7) {
    factor = 1.1;
    reason = "comfortable";
  } else {
    factor = 1;
    reason = "on-target";
  }
  const rate = clamp(round1(baseRate * factor), floor, cap);
  return { rate, baseRate, factor: Math.round(factor * 100) / 100, reason };
}

// One-line explanation for ai_notes / digests.
export function describeCalibration(station: string, c: RateCalibration, p90: number | null, targetMin: number, sample: number): string {
  if (c.reason === "no-data") return `${station}: no serve-time signal (${sample} orders) — base rate ${c.baseRate}/hr`;
  const p = p90 == null ? "?" : p90.toFixed(1);
  if (c.reason === "breach") {
    return `${station}: p90 serve ${p}min BREACHES ${targetMin}min target → rate ${c.baseRate}→${c.rate}/hr (more heads at loaded hours)`;
  }
  if (c.reason === "comfortable") {
    return `${station}: p90 serve ${p}min well under ${targetMin}min target → rate ${c.baseRate}→${c.rate}/hr (slightly leaner)`;
  }
  return `${station}: p90 serve ${p}min on target (${targetMin}min) — rate ${c.rate}/hr unchanged`;
}
