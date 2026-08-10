/**
 * Invoice timing — when is a supplier invoice actually late?
 *
 * Two independent clocks run on a deposit-terms invoice, and conflating them is
 * what made the Collective Project ageing read as nonsense:
 *
 *   1. THE DEPOSIT is due on the ISSUE DATE. It is payable the moment the
 *      invoice exists; there is no grace period and no separate date column.
 *   2. THE BALANCE is due on the invoice's own `dueDate` — the date printed on
 *      the supplier's document and read off it by the capture agent. It is
 *      never computed from terms. `Supplier.depositTermsDays` describes the
 *      supplier's usual terms for humans; nothing derives a date from it.
 *
 * Before this module the only rule was a one-way `PENDING → OVERDUE` sweep, so:
 *   - an invoice that went OVERDUE while its due date was wrong stayed OVERDUE
 *     forever once the date was corrected (IV-02158: flagged overdue on 2026-08-07
 *     with the deposit already paid, while its real balance due date was 19 Aug);
 *   - INITIATED and DEPOSIT_PAID invoices could sail past their due date without
 *     ever surfacing (IV-02135 was 5 days late and displayed as normal);
 *   - an unpaid deposit was never late at all, because rule 1 existed only as a
 *     comment.
 *
 * The fix separates the two questions this module answers:
 *
 *   - `storedStatusShouldBe` — the narrow, REVERSIBLE stored-status transition.
 *     Only PENDING ⇄ OVERDUE. Deliberately does NOT overwrite INITIATED or
 *     DEPOSIT_PAID: those statuses carry information ("payment in flight",
 *     "deposit settled") that an OVERDUE stamp would destroy, and `depositPaidAt`
 *     alone can't tell the UI which of the two a row was.
 *   - `balanceOverdue` / `depositOverdue` — DERIVED flags, safe to compute for
 *     any status. Endpoints expose these so a late INITIATED or DEPOSIT_PAID row
 *     is visible without mangling its status.
 */

export type InvoiceStatusLike =
  | "DRAFT"
  | "INITIATED"
  | "PENDING"
  | "PARTIALLY_PAID"
  | "DEPOSIT_PAID"
  | "PAID"
  | "OVERDUE";

/** Statuses that still owe money. DRAFT is excluded — an AI-captured draft is
 *  not yet a payable and must never be chased. */
export const OPEN_INVOICE_STATUSES: InvoiceStatusLike[] = [
  "INITIATED",
  "PENDING",
  "PARTIALLY_PAID",
  "DEPOSIT_PAID",
  "OVERDUE",
];

/** Outlets are Malaysian; timestamps are stored UTC. "Is it past due?" is a
 *  calendar-day question, so it must be asked in local time or an invoice due
 *  today reads as overdue from 08:00 MYT (00:00 UTC). */
export const BUSINESS_TIME_ZONE = "Asia/Kuala_Lumpur";

export function isOpenInvoiceStatus(s: InvoiceStatusLike): boolean {
  return OPEN_INVOICE_STATUSES.includes(s);
}

/** Calendar day in `timeZone` as a sortable YYYY-MM-DD string, or null if the
 *  input can't be read. Comparing these strings compares calendar days. */
export function localDayKey(
  at: Date | string | null | undefined,
  timeZone: string = BUSINESS_TIME_ZONE,
): string | null {
  if (at === null || at === undefined) return null;
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return null;
  try {
    // en-CA renders YYYY-MM-DD, which sorts lexicographically as a date.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return null; // unknown zone / no ICU — never let this decide money is late
  }
}

/** Whole days from `fromKey` to `toKey` (both YYYY-MM-DD). */
function daysBetween(fromKey: string, toKey: string): number {
  const a = Date.parse(`${fromKey}T00:00:00Z`);
  const b = Date.parse(`${toKey}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export interface InvoiceTimingInput {
  status: InvoiceStatusLike;
  /** Balance due date as printed on the supplier invoice. Null = never chased. */
  dueDate?: Date | string | null;
  /** When the invoice was issued — the deposit's due date. */
  issueDate?: Date | string | null;
  /** Deposit required on this invoice, if any. */
  depositAmount?: number | string | null;
  /** When the deposit was actually paid. */
  depositPaidAt?: Date | string | null;
  /** Evaluation instant. Defaults to now. */
  now?: Date | string;
  timeZone?: string;
}

export interface InvoiceTiming {
  /**
   * The due date is not believable: it falls BEFORE the issue date, so the
   * balance would have been due before the invoice existed. Collective's
   * invoice rows are pre-created 7–9 days ahead of their issue date and are
   * born with a placeholder due date; 30 invoices carry one. A row in this
   * state is never auto-marked overdue — that is exactly how IV-02158 got a
   * correct OVERDUE stamp from a wrong date, which then outlived the fix.
   * (due == issue is left alone: COD invoices legitimately do that.)
   */
  dueDateInvalid: boolean;
  /** Balance is past its printed due date and still owed. */
  balanceOverdue: boolean;
  /** A deposit is required, unpaid, and the issue date has passed. */
  depositOverdue: boolean;
  /** Days past the balance due date; 0 when not overdue. */
  daysPastDue: number;
  /** Days since issue with the deposit still unpaid; 0 when not overdue. */
  depositDaysPastDue: number;
  /**
   * The stored status this row SHOULD carry, or null to leave it alone.
   * Only ever "OVERDUE" or "PENDING" — see the module note on why INITIATED
   * and DEPOSIT_PAID are never overwritten.
   */
  storedStatusShouldBe: "PENDING" | "OVERDUE" | null;
}

function toNum(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Classify one invoice against the two clocks. Pure — pass `now` to test.
 *
 * An unreadable or missing date is never treated as late: a guard that can't
 * read the calendar must not accuse anyone of owing money.
 */
export function evaluateInvoiceTiming(input: InvoiceTimingInput): InvoiceTiming {
  const tz = input.timeZone ?? BUSINESS_TIME_ZONE;
  const today = localDayKey(input.now ?? new Date(), tz);
  const due = localDayKey(input.dueDate ?? null, tz);
  const issued = localDayKey(input.issueDate ?? null, tz);

  const dueDateInvalid = due !== null && issued !== null && due < issued;

  const none: InvoiceTiming = {
    dueDateInvalid,
    balanceOverdue: false,
    depositOverdue: false,
    daysPastDue: 0,
    depositDaysPastDue: 0,
    storedStatusShouldBe: null,
  };

  // Settled or not yet a payable — no clock runs, and critically a stale
  // OVERDUE on a closed row is left as history rather than rewritten.
  if (!today || !isOpenInvoiceStatus(input.status)) return none;

  // A due date that pre-dates the invoice is a placeholder, not a deadline.
  // Chasing on it is the root cause of the wrong OVERDUE stamps, so the
  // balance clock does not start until someone corrects the date.
  const balanceOverdue = !dueDateInvalid && due !== null && due < today;
  const daysPastDue = balanceOverdue ? daysBetween(due!, today) : 0;

  // Rule 1: the deposit is due on the issue date, so it is late the day after.
  const needsDeposit = toNum(input.depositAmount) > 0;
  const depositUnpaid = needsDeposit && localDayKey(input.depositPaidAt ?? null, tz) === null;
  const depositOverdue = depositUnpaid && issued !== null && issued < today;
  const depositDaysPastDue = depositOverdue ? daysBetween(issued!, today) : 0;

  // The reversible stored transition. PENDING is the only status that becomes
  // OVERDUE, and OVERDUE returns to PENDING the moment the row is not actually
  // past due — which is the latch that stranded IV-02158.
  let storedStatusShouldBe: "PENDING" | "OVERDUE" | null = null;
  if (input.status === "PENDING" && balanceOverdue) storedStatusShouldBe = "OVERDUE";
  else if (input.status === "OVERDUE" && !balanceOverdue) storedStatusShouldBe = "PENDING";

  return {
    dueDateInvalid,
    balanceOverdue,
    depositOverdue,
    daysPastDue,
    depositDaysPastDue,
    storedStatusShouldBe,
  };
}
