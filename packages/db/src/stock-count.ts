/**
 * Stock-count review helpers — shared by the staff and backoffice apps so the
 * single rule "what counts as a discrepancy" lives in exactly one place.
 *
 * A count auto-approves when it has zero discrepancies — i.e. it would show
 * "All OK" in the backoffice review list. Only counts with a real variance
 * land in the manager's review queue.
 */

type QtyLike = number | string | { toString(): string } | null | undefined;

function toNum(v: QtyLike): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v.toString());
  return Number.isFinite(n) ? n : null;
}

export interface VarianceItem {
  expectedQty: QtyLike;
  countedQty: QtyLike;
}

/**
 * Number of items that were counted, have a known expected quantity, and
 * differ from it. Mirrors the backoffice "Discrepancies" column exactly:
 * an item with no expected baseline (expectedQty == null) cannot be flagged.
 */
export function countDiscrepancies(items: VarianceItem[]): number {
  let n = 0;
  for (const it of items) {
    const expected = toNum(it.expectedQty);
    const counted = toNum(it.countedQty);
    if (expected === null || counted === null) continue; // no baseline → can't flag
    if (counted !== expected) n++;
  }
  return n;
}

/**
 * A count is "clean" — and therefore safe to auto-approve — when nothing flags
 * as a discrepancy. A count with no expected baseline has zero discrepancies,
 * so it auto-approves, matching today's "All OK" behaviour.
 */
export function isCleanCount(items: VarianceItem[]): boolean {
  return countDiscrepancies(items) === 0;
}

// ─── Variance tolerance (what counts as a real discrepancy) ─────────────────
//
// `countDiscrepancies` above flags ANY difference. That is the right rule when
// both sides are exact (pieces on a shelf), and the wrong one for ingredients
// measured in grams and millilitres, where a 2g difference on a 1kg bag is
// weighing noise, not shrinkage. Flagging those would send every count to a
// manager and teach them to rubber-stamp — worse than not checking at all.
//
// A variance is meaningful when it exceeds BOTH:
//   - a relative band (default 2% of expected), which scales with pack size, and
//   - an absolute floor (default 1 base unit), so a product expected at zero, or
//     at a few grams, doesn't flag on rounding.
// Either side alone misbehaves: relative-only makes small balances hypersensitive,
// absolute-only makes large ones insensitive.

/** Fraction of the expected quantity that is treated as noise. */
export const DEFAULT_VARIANCE_TOLERANCE = 0.02;
/** Minimum absolute difference (in base UOM) before anything is flagged. */
export const VARIANCE_ABSOLUTE_FLOOR = 1;

export interface VarianceToleranceOptions {
  tolerance?: number;
  absoluteFloor?: number;
}

/**
 * Is the gap between expected and counted worth a human's attention?
 * Both quantities must be in the SAME unit — base UOM, since that is what
 * StockBalance stores and what a count converts to before it writes balances.
 */
export function isMeaningfulVariance(
  expected: number,
  counted: number,
  opts: VarianceToleranceOptions = {},
): boolean {
  const tol = opts.tolerance ?? DEFAULT_VARIANCE_TOLERANCE;
  const floor = opts.absoluteFloor ?? VARIANCE_ABSOLUTE_FLOOR;
  if (!Number.isFinite(expected) || !Number.isFinite(counted)) return false;
  const diff = Math.abs(counted - expected);
  return diff > floor && diff > Math.abs(expected) * tol;
}

export interface ProductVariance {
  productId: string;
  expected: number;
  counted: number;
  diff: number;
}

/**
 * Compare counted-vs-expected per PRODUCT, both in base UOM, and return only
 * the meaningful gaps. Per product rather than per line because a product can
 * be counted in two packages within one count (10 such cases exist): the
 * balance is a single per-product figure, so only the summed count can be
 * judged against it.
 */
export function findProductVariances(
  expectedByProduct: Map<string, number>,
  countedByProduct: Map<string, number>,
  opts: VarianceToleranceOptions = {},
): ProductVariance[] {
  const out: ProductVariance[] = [];
  for (const [productId, counted] of countedByProduct) {
    // No baseline for this product — nothing to judge against, same rule as
    // countDiscrepancies. A first count cannot be a discrepancy.
    if (!expectedByProduct.has(productId)) continue;
    const expected = expectedByProduct.get(productId)!;
    if (isMeaningfulVariance(expected, counted, opts)) {
      out.push({ productId, expected, counted, diff: counted - expected });
    }
  }
  return out;
}

// ─── Count coverage (guard against short / partial submissions) ──────────────
//
// The submit/finalize endpoints trust the client's item list, and the only
// completeness check is "every loaded item has a countedQty". That cannot catch
// a count where products were never loaded onto the sheet at all — e.g. a
// "monthly" that counts 49 of the outlet's ~212 products and submits clean.
//
// evaluateCountCoverage compares what was counted against the outlet's expected
// universe for that frequency (its most recent completed count of the same
// frequency is the baseline). Per the owner's calls:
//   - MONTHLY and WEEKLY below the floor → BLOCK (hard stop; a deliberate
//     partial needs an explicit reason at the call site). Both are a full
//     census of every product — as of 2026-08-06 the weekly sheet lists the
//     whole store, not a subset, so a short weekly is as wrong as a short
//     monthly. (Before that, weekly listed only DAILY+WEEKLY-tagged items and
//     was correctly treated as a small, variable-size count.)
//   - DAILY below the floor → WARN (allow, but the caller routes it to manager
//     review instead of auto-approving). The daily sheet is a deliberately
//     short list of fast movers, so blocking would be noise.
// A first-ever count (no baseline) can't be judged and always passes.

export type CountFrequencyLike = "DAILY" | "WEEKLY" | "MONTHLY";

/**
 * Does this frequency's sheet list every product? Weekly and monthly do; the
 * daily sheet is a short list of fast movers. Only a census can be judged
 * "short", which is what the coverage floor tests.
 */
export function isCensusFrequency(f: CountFrequencyLike): boolean {
  return f === "WEEKLY" || f === "MONTHLY";
}

/** Default minimum share of the expected universe a count must cover. Monthly
 *  counts are historically very consistent (e.g. 254/254/255), so 0.85 leaves
 *  ample room for a few discontinued lines without letting a 23%-complete
 *  count (49/212) through. */
export const DEFAULT_MIN_COVERAGE = 0.85;

export interface CoverageInput {
  frequency: CountFrequencyLike;
  /** Products the outlet is expected to count at this frequency (baseline). */
  expectedProductIds: string[];
  /** Products actually counted in this submission (countedQty present). */
  countedProductIds: string[];
  /** Minimum fraction of the expected universe that must be counted. */
  minCoverage?: number;
}

export interface CoverageResult {
  expected: number; // size of the baseline universe (0 = nothing to judge against)
  counted: number; // expected products that were actually counted
  missing: number;
  coverage: number; // counted / expected, in [0,1]; 1 when there's no baseline
  missingProductIds: string[];
  belowFloor: boolean; // coverage under the floor AND a baseline existed
  block: boolean; // MONTHLY below floor → refuse unless an explicit override is given
  warn: boolean; // DAILY/WEEKLY below floor → allow but flag for review
}

export function evaluateCountCoverage(input: CoverageInput): CoverageResult {
  const min = input.minCoverage ?? DEFAULT_MIN_COVERAGE;
  const expectedSet = new Set(input.expectedProductIds);
  const countedSet = new Set(input.countedProductIds);
  const expected = expectedSet.size;

  // No baseline — first count of this frequency, or none reviewed yet. We have
  // nothing to measure against, so it passes (can't manufacture an expectation).
  if (expected === 0) {
    return {
      expected: 0,
      counted: countedSet.size,
      missing: 0,
      coverage: 1,
      missingProductIds: [],
      belowFloor: false,
      block: false,
      warn: false,
    };
  }

  const missingProductIds: string[] = [];
  for (const id of expectedSet) if (!countedSet.has(id)) missingProductIds.push(id);
  const counted = expected - missingProductIds.length;
  const coverage = counted / expected;
  const belowFloor = coverage < min;

  return {
    expected,
    counted,
    missing: missingProductIds.length,
    coverage,
    missingProductIds,
    belowFloor,
    // A census (weekly or monthly) must cover the store; only the short daily
    // list is allowed through with a warning.
    block: belowFloor && isCensusFrequency(input.frequency),
    warn: belowFloor && !isCensusFrequency(input.frequency),
  };
}

// ─── Count freshness (guard against counts left open across days) ───────────
//
// A stock count is a POINT-IN-TIME snapshot: opening/closing balances, COGS and
// shrinkage all assume every line reflects the same moment. Nothing enforced
// that. Counts were created on one day and finalized days later while stock
// kept moving, yet stored under the ORIGINAL countDate — so the snapshot date
// was a lie and the variance either side of it was smeared.
//
// Real cases (Putrajaya, 2026): created 4 Jun → finalized 30 Jun (25 days);
// 19 Jul → 28 Jul (9 days); 12 Jul → 19 Jul (6 days). Tamarind, by contrast,
// closed every count same-day and is the only outlet whose stock reconciles
// cleanly — which is why this is a data-integrity bug, not a staff issue.
//
// Policy (owner's rule, 2026-07-31 — "if opened more than 1 day, needs to make
// it expired if not finalized … or can put a soft block if they continue
// counting … but it is a diff date"):
//   - within the same working window  → fine
//   - open past STALE_HOURS (18h)     → WARN: never auto-approve; the count
//                                       goes to manager review with a note
//                                       recording how long it was open
//   - open past EXPIRE_HOURS (24h)    → EXPIRED: a soft block. Counting on into
//                                       it, and finalizing it, both refuse
//                                       until the counter explicitly chooses
//                                       what to do — because the numbers are
//                                       now spread over more than one date.
//
// An 18h stale window (not 24h) so an evening count finishing next morning is
// warned-but-allowed; expiry lands at a full day, which is the owner's rule.
//
// "Soft", not hard: an expired count still holds real counted lines, so the
// counter picks — start fresh for today, or carry on and have the count
// re-dated to the day it actually closes. What must never happen again is the
// silent third option: keep the original countDate and pretend it was a
// same-day snapshot.

export const STALE_COUNT_HOURS = 18;
export const EXPIRE_COUNT_HOURS = 24;

/**
 * Whether an expired DRAFT of this frequency should be abandoned automatically
 * in favour of a fresh count, with no prompt.
 *
 * A DAILY count is a same-day snapshot by definition — when yesterday's draft
 * expires there is nothing worth resuming, and prompting staff about it just
 * produced dead-ends at the till (owner's ask, 2026-08-07: "can we auto
 * refresh everyday"). WEEKLY/MONTHLY counts legitimately run long and carry
 * hundreds of keyed lines, so those keep the explicit new/continue choice.
 * The abandoned draft stays a DRAFT (its lines are evidence of what was
 * counted); it is simply never picked up or finalized again.
 */
export function autoRefreshOnExpiry(frequency: CountFrequencyLike): boolean {
  return frequency === "DAILY";
}

export interface FreshnessInput {
  /** When the count was created (first line keyed). */
  createdAt: Date | string;
  /** Evaluation time — pass the finalize timestamp. */
  now: Date | string;
  staleHours?: number;
  expireHours?: number;
}

export interface FreshnessResult {
  hoursOpen: number;
  /** Whole days the count has been open — what the UI shows ("open 2 days"). */
  daysOpen: number;
  stale: boolean; // past the stale window → must not auto-approve
  expired: boolean; // past a full day → soft block on counting and finalizing
  /** Human note appended to the count so the gap is visible in review. */
  staleNote: string | null;
}

export function evaluateCountFreshness(input: FreshnessInput): FreshnessResult {
  const staleH = input.staleHours ?? STALE_COUNT_HOURS;
  const expireH = input.expireHours ?? EXPIRE_COUNT_HOURS;
  const started = new Date(input.createdAt).getTime();
  const ended = new Date(input.now).getTime();

  // Unparseable or clock-skewed input must not block a legitimate finalize.
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) {
    return { hoursOpen: 0, daysOpen: 0, stale: false, expired: false, staleNote: null };
  }

  const hoursOpen = (ended - started) / 3_600_000;
  const stale = hoursOpen > staleH;
  const expired = hoursOpen > expireH;
  const days = Math.floor(hoursOpen / 24);
  const staleNote = stale
    ? `[stale count] open ${days >= 1 ? `${days}d ` : ""}${Math.round(hoursOpen % 24)}h before finalizing — quantities may not reflect a single date.`
    : null;

  return { hoursOpen, daysOpen: days, stale, expired, staleNote };
}

// ─── Count schedule (guard against counts landing on the wrong day) ──────────
//
// Nothing said WHEN a census should happen, so they happened whenever. Three
// "monthly" counts were filed on 3, 4 and 5 August 2026 — each a different
// outlet-day, none of them a month boundary, and each one overwrote every
// balance in the store. A monthly that isn't anchored to the accounting close
// can't value the month; a weekly that drifts across weekdays can't be compared
// to the one before it.
//
// The windows below come from the outlets' own trading data (Jun–Jul 2026):
//
//   WEEKLY → Thursday. Deliveries land 15.1/day Mon, 14.2 Tue, 14.6 Fri, 13.0
//   Sun — but only 4.1 on Thursday, the quietest day of the week by a factor of
//   three. Thursday is also joint-lowest for sales (RM9,144/day avg, vs 13,548
//   Sat and 14,476 Sun). So it is the one weekday where stock is sitting still
//   AND staff have the time to walk it. Saturday has fewer deliveries still
//   (3.3) but is the second-busiest trading day — the wrong time to ask anyone
//   to count the store.
//
//   MONTHLY → the last calendar day, with the 1st of the next month as grace.
//   This anchors the census to the accounting close, so closing stock, COGS and
//   shrinkage all describe the same period the P&L does.
//
//   DAILY → every day, by definition. Never off-schedule.
//
// Enforcement is a SOFT block, matching the coverage and expiry guards: an
// off-window census is refused until the counter gives a reason, and a count
// submitted with one never auto-approves — a manager sees it. Hard-blocking
// would mean a code change every time reality intervenes (stocktake before an
// audit, an outlet closing for renovation, a manager on leave).

/** ISO weekday the weekly census is expected on. 4 = Thursday. */
export const WEEKLY_COUNT_DOW = 4;

/** Outlets are all Malaysian; countDate is stored UTC, so the day-of-week and
 *  day-of-month questions must be asked in local time or a 20:00 MYT count
 *  reads as the previous day. */
export const COUNT_TIME_ZONE = "Asia/Kuala_Lumpur";

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

interface LocalDateParts {
  year: number;
  month: number; // 1-12
  day: number;
  isoDow: number; // 1 = Monday … 7 = Sunday
  daysInMonth: number;
}

/** Calendar parts of an instant as seen in `timeZone`. Returns null if the
 *  input or zone can't be read — callers treat that as "can't judge". */
function localDateParts(at: Date | string, timeZone: string): LocalDateParts | null {
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return null;
  let year: number, month: number, day: number;
  try {
    // en-CA formats as YYYY-MM-DD, which parses without locale ambiguity.
    const [y, m, dd] = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(d)
      .split("-")
      .map(Number);
    if (!y || !m || !dd) return null;
    year = y;
    month = m;
    day = dd;
  } catch {
    return null; // unknown timezone / no ICU — never block on this
  }
  // Weekday and month length from the local calendar date, computed in UTC so
  // the host's own timezone can't shift the answer.
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = Sunday
  return {
    year,
    month,
    day,
    isoDow: dow === 0 ? 7 : dow,
    daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(),
  };
}

export interface ScheduleInput {
  frequency: CountFrequencyLike;
  /** The date the count will be filed under (countDate, or the closing date
   *  for a count being re-dated). */
  date: Date | string;
  timeZone?: string;
  /** ISO weekday for the weekly census. Defaults to Thursday. */
  weeklyDow?: number;
}

export interface ScheduleResult {
  /** True when the count falls in its expected window, or can't be judged. */
  onSchedule: boolean;
  /** True only for a census landing outside its window — needs a reason. */
  offSchedule: boolean;
  /** What the window is, for the message shown to the counter. */
  expectedLabel: string;
  /** The day this count actually lands on, e.g. "Monday 3 Aug". */
  actualLabel: string;
  /** Note stamped on an off-window count so review sees why it's flagged. */
  offScheduleNote: string | null;
}

/**
 * Is this count landing in its scheduled window? Daily always is. A weekly is
 * due on `weeklyDow`; a monthly on the last day of the month or the 1st of the
 * next. An unreadable date passes — a guard that can't read the clock must not
 * stop someone finishing a count.
 */
export function evaluateCountSchedule(input: ScheduleInput): ScheduleResult {
  const parts = localDateParts(input.date, input.timeZone ?? COUNT_TIME_ZONE);
  const dow = input.weeklyDow ?? WEEKLY_COUNT_DOW;
  const weeklyName = WEEKDAY_NAMES[dow - 1] ?? WEEKDAY_NAMES[WEEKLY_COUNT_DOW - 1];

  const expectedLabel =
    input.frequency === "WEEKLY"
      ? weeklyName
      : input.frequency === "MONTHLY"
        ? "the last day of the month (or the 1st)"
        : "any day";

  if (!parts || input.frequency === "DAILY") {
    return {
      onSchedule: true,
      offSchedule: false,
      expectedLabel,
      actualLabel: parts ? formatDay(parts) : "",
      offScheduleNote: null,
    };
  }

  const onSchedule =
    input.frequency === "WEEKLY"
      ? parts.isoDow === dow
      : parts.day === parts.daysInMonth || parts.day === 1;

  const actualLabel = formatDay(parts);
  return {
    onSchedule,
    offSchedule: !onSchedule,
    expectedLabel,
    actualLabel,
    offScheduleNote: onSchedule
      ? null
      : `[off-schedule] ${input.frequency.toLowerCase()} count filed ${actualLabel}; due ${expectedLabel}.`,
  };
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDay(p: LocalDateParts): string {
  return `${WEEKDAY_NAMES[p.isoDow - 1]} ${p.day} ${MONTH_NAMES[p.month - 1]}`;
}

export interface CountedLine {
  productId: string;
  /** Quantity as physically counted — in the *package's* units, not base UOM. */
  countedQty: QtyLike;
  /**
   * The counted package's conversion factor (base-UOM units per package). A
   * missing/invalid/≤0 factor is treated as 1 (item counted directly in its
   * base UOM, or an un-packaged item).
   */
  conversionFactor?: QtyLike;
}

/**
 * Convert counted lines into base-UOM totals per product.
 *
 * Staff count in whatever package they physically handle ("22 packets"), but
 * StockBalance is tracked in the product's base UOM (see the wastage/inventory
 * routes: "Stock is tracked in product baseUom"). Each line must therefore be
 * multiplied by its package conversionFactor before it lands in a balance —
 * skipping this stored 22 base units for "22 packets" instead of 22 × pack size.
 *
 * Lines with a null countedQty are ignored (not yet counted). Multiple lines
 * for the same product — e.g. the same item counted in two packages — are
 * summed, so the result is the product's full on-hand in base UOM.
 */
export function baseQtyByProduct(lines: CountedLine[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of lines) {
    const counted = toNum(line.countedQty);
    if (counted === null) continue;
    const cf = toNum(line.conversionFactor);
    const factor = cf === null || cf <= 0 ? 1 : cf;
    totals.set(line.productId, (totals.get(line.productId) ?? 0) + counted * factor);
  }
  return totals;
}
