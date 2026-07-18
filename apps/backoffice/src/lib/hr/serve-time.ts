// Station capacity — MEASURED, not assumed. The owner's correction
// (2026-07-17): the 10/15-minute serve standards are an ORDER-LATENCY promise,
// not a per-item labour cost — staff work overlapping (a cook runs several
// pans, a barista batches drinks), so per-head throughput while still hitting
// the target is higher than per-item arithmetic suggests.
//
//   • kitchen food     : served within 15 minutes
//   • beverage / pastry: served within 10 minutes
//
// So instead of scaling an assumed rate by p90 serve (the old proportional
// controller — retired because latency doesn't scale linearly when work
// overlaps, and it over-punished dirty serve stamps), we measure what each
// outlet's crews DEMONSTRABLY handle: for every historical (day, hour) take
// items ÷ heads actually clocked in (per station), keep only hours where the
// serve target was MET (median serve ≤ target), and use a high percentile of
// that as demonstrated capacity. Planning rate = demonstrated capacity × a
// headroom factor, so the roster never plans crews at 100% of their best hour.
// The serve targets stop being a throughput knob and become the pass/fail line
// deciding which hours count as capacity proven.
//
// Stateless: recomputed fresh each generation from the trailing window; the
// reasoning lands in ai_notes. Staffing changes feed the next window's
// measurement, closing the loop with no human in it.

export const BARISTA_SERVE_TARGET_MIN = 10; // beverage / pastry orders
export const KITCHEN_SERVE_TARGET_MIN = 15; // orders containing cooked food

// Minimum qualifying hours (heads clocked in + real volume + target met)
// before the measurement is trusted; below this the base rate stands.
export const MIN_CAPACITY_SAMPLE_HOURS = 20;
// Plan crews at this fraction of demonstrated capacity — the queue tips over
// near 100% utilisation, so the roster keeps slack for surges within the hour.
export const CAPACITY_HEADROOM = 0.85;
// Hours only qualify for measurement with at least this many items — dead
// hours prove nothing about capacity.
export const CAPACITY_MIN_ITEMS = { barista: 8, kitchen: 4 } as const;

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export type PlanningRate = {
  rate: number; // items/head/hour the roster plans with
  baseRate: number;
  measuredP80: number | null; // demonstrated capacity (p80 of on-target hours)
  sampleHours: number;
  basis: "measured" | "base";
};

// Turn a measured p80 capacity into the planning rate. Clamped to
// [0.75×base, 2.5×base] so a thin or freak sample can never starve or
// wildly lean the roster; falls back to the base rate on insufficient sample.
export function planningRate(input: {
  baseRate: number;
  measuredP80: number | null; // items per clocked-in head per hour
  sampleHours: number;
}): PlanningRate {
  const { baseRate, measuredP80, sampleHours } = input;
  if (
    measuredP80 == null ||
    !Number.isFinite(measuredP80) ||
    measuredP80 <= 0 ||
    sampleHours < MIN_CAPACITY_SAMPLE_HOURS
  ) {
    return { rate: baseRate, baseRate, measuredP80: null, sampleHours, basis: "base" };
  }
  const rate = clamp(round1(measuredP80 * CAPACITY_HEADROOM), round1(baseRate * 0.75), round1(baseRate * 2.5));
  return { rate, baseRate, measuredP80: round1(measuredP80), sampleHours, basis: "measured" };
}

// One-line explanation for ai_notes / digests.
export function describeCapacity(station: string, p: PlanningRate, targetMin: number): string {
  if (p.basis === "base") {
    return `${station}: capacity not yet proven (${p.sampleHours} on-target hours < ${MIN_CAPACITY_SAMPLE_HOURS}) — base rate ${p.baseRate}/hr`;
  }
  return (
    `${station}: measured ${p.measuredP80} items/head/hr over ${p.sampleHours} hours that met the ` +
    `${targetMin}min serve target → plan at ${p.rate}/hr (${Math.round(CAPACITY_HEADROOM * 100)}% headroom)`
  );
}
