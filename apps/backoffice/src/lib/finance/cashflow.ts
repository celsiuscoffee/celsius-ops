import { prisma } from "@/lib/prisma";

// Cashflow projection compute. Pure-function-ish: takes a horizon and an
// optional outletId, returns weekly buckets with the breakdown that the
// dashboard renders.
//
// Source of truth: classified BankStatementLine rows. Per-category daily
// rates are derived from the last 90 days of bank lines and used to
// project forward. Sales categories (CARD/QR/STOREHUB/GRAB/FOODPANDA/
// GASTROHUB/MEETINGS_EVENTS) get a day-of-week shape from their txnDate
// distribution; outflow categories project as a flat daily rate.
//
// Inputs (all read at request time, no side effects):
//   - Opening balance: sum of latest BankStatement.closingBalance per
//     account.
//   - Bank-line projection: per-category × DOW (or per-day) averages
//     from BankStatementLine over the last 90 days. Drives salesIn,
//     payrollOut, marketingOut, recurringOut, otherIn, otherOut.
//   - Invoice outflows: unpaid Invoice rows with dueDate in horizon
//     (additive on top of bank-line residual — these are committed
//     future payments not yet on the bank statement).
//   - Synthetic fallback: when bank lines are empty for a category we
//     fall back to the legacy streams (StoreHub DOW, hr_payroll_runs
//     avg, ads_invoice avg, RecurringExpense expansion).
//
// Sales forecast scope: when outletId is null we sum all outlets; outlet
// filter applies to both the bank-line lookback and to invoices.
// Categories with no outletId attribution (paid from HQ on behalf of all
// outlets — e.g. payroll, central marketing) are dropped from filtered
// views and surfaced as a warning.

const DAY_MS = 86400_000;

export type CashflowBucket = {
  weekStart: string;     // YYYY-MM-DD (Monday)
  weekEnd: string;       // YYYY-MM-DD (Sunday)
  opening: number;
  salesIn: number;
  // Hybrid model: bank statements give a per-day actual inflow/outflow
  // average that includes streams the synthetic model misses (Stripe pickup
  // revenue, refunds, card-charged subscriptions, bank charges, transfers).
  // We back out the synthetic-known portion of that average so the residual
  // shown as `otherIn`/`otherOut` flags everything else the bank does.
  otherIn: number;
  invoiceOut: number;
  payrollOut: number;
  cogsOut: number;
  marketingOut: number;
  recurringOut: number;
  otherOut: number;
  closing: number;
  // Drill-down ids — finance can click to see what's in each bucket.
  invoiceIds: string[];
  recurringExpenseIds: string[];
};

export type CashflowResult = {
  asOf: string;
  weeks: number;
  outletId: string | null;       // legacy back-compat (set when exactly 1)
  outletIds: string[];           // canonical: empty array = all outlets
  openingBalance: { amount: number; statementDate: string | null };
  // Per-day averages derived from BankStatement period totals; null if no
  // statements have period info yet. Echoed back so the UI can explain
  // what "Other (bank)" represents.
  bankFlowsPerDay: { inflow: number; outflow: number; sampleDays: number } | null;
  // Historical "cash generated per month" — sourced from BankStatement
  // closing balance roll-forward (closing_end_of_month minus
  // closing_start_of_month) summed across accounts. This is the most
  // accurate "did our cash position grow or shrink" answer because it
  // reads a single verified number per statement (the closing balance
  // bottom-line) instead of two large running totals. Falls back to
  // (totalInflows - totalOutflows) when the prior-month closing isn't
  // available (e.g. the very first month uploaded).
  monthlyHistory: Array<{
    month: string;            // YYYY-MM
    cashIn: number;           // gross totalInflows across accounts (kept for transparency)
    cashOut: number;          // gross totalOutflows
    interCoInflows: number;   // InterCo portion of cashIn
    interCoOutflows: number;  // InterCo portion of cashOut
    netGenerated: number;     // headline — balance roll-forward + (interCoOut - interCoIn)
    netSource: 'balance' | 'periodTotals'; // which method drove the headline number
    minBalance: number | null;  // lowest consolidated daily balance within the month, null if not reconstructable
    minBalanceDate: string | null; // YYYY-MM-DD, the day min was hit
    accountsReporting: number; // 3 = full coverage; less = data gap
  }>;
  // Operating Cash Flow per month — drill-down on what's driving the
  // headline. Excludes financing (loans, capital), investing (capex,
  // equipment, renovation), owner draws (directors), one-offs (refunds,
  // capital injections), InterCo. Pure "did our core business
  // generate cash this month?"
  operatingCashFlow: Array<{
    month: string;
    sales: { card: number; qr: number; storehub: number; grab: number; foodpanda: number; gastrohub: number; meetings: number; total: number };
    costs: {
      payroll: number;        // EMPLOYEE_SALARY + PARTIMER + STATUTORY + STAFF_CLAIM + PETTY_CASH (excl directors)
      cogs: number;           // RAW_MATERIALS + DELIVERY
      rent: number;
      utilities: number;
      marketing: number;      // DIGITAL_ADS + KOL + OTHER_MARKETING + MARKETPLACE_FEE
      software: number;
      taxCompliance: number;  // TAX + COMPLIANCE + LICENSING_FEE + ROYALTY_FEE + CFS_FEE + BANK_FEE
      maintenance: number;
      total: number;
    };
    operatingNet: number;     // sales.total - costs.total
  }>;
  // Rolled-up averages for the headline cards. burnPerMonth is positive
  // when the business is losing cash; runwayMonths is openingBalance /
  // burn (only meaningful when burn > 0).
  cashGeneration: {
    lastMonth: { month: string; net: number } | null;
    avg3Month: number | null;     // average net generated across last 3 full months
    burnPerMonth: number | null;  // -avg3Month when negative; else null
    runwayMonths: number | null;  // openingBalance / burnPerMonth
  };
  // Lowest closing balance across the projection horizon. The week
  // when this hits is the cash crunch — most useful single number
  // for "should I be worried?" decisions. Inspired by QuickBooks'
  // Cash Flow Projector minimum-balance highlighting.
  projectedMin: { closing: number; weekStart: string; weekEnd: string } | null;
  buckets: CashflowBucket[];
  warnings: string[];
};

function startOfWeek(d: Date): Date {
  // ISO Monday. getDay: Sunday=0..Saturday=6 → Monday is the start.
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
  return r;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

function addCadence(d: Date, cadence: "MONTHLY" | "QUARTERLY" | "YEARLY"): Date {
  switch (cadence) {
    case "MONTHLY":   return addMonths(d, 1);
    case "QUARTERLY": return addMonths(d, 3);
    case "YEARLY":    return addMonths(d, 12);
  }
}

// Build a Prisma `outletId` filter clause from the array. Empty array =
// no scoping (all outlets). Single id = exact match. Multi = `in`.
function outletScope(outletIds: string[]) {
  if (outletIds.length === 0) return {};
  if (outletIds.length === 1) return { outletId: outletIds[0] };
  return { outletId: { in: outletIds } };
}

// Avg daily sales by day-of-week (0=Sun..6=Sat) from the last 12 weeks.
async function dayOfWeekSalesAverages(outletIds: string[]): Promise<number[]> {
  const lookbackStart = new Date(Date.now() - 12 * 7 * DAY_MS);
  const rows = await prisma.salesTransaction.findMany({
    where: {
      transactedAt: { gte: lookbackStart },
      ...outletScope(outletIds),
    },
    select: { transactedAt: true, grossAmount: true },
  });

  const sumByDow = [0, 0, 0, 0, 0, 0, 0];
  const dayCountByDow = new Set<string>(); // "dow|YYYY-MM-DD" so we can divide by # of distinct days
  const distinctDays: Record<number, Set<string>> = {0: new Set(), 1: new Set(), 2: new Set(), 3: new Set(), 4: new Set(), 5: new Set(), 6: new Set()};

  for (const r of rows) {
    const d = r.transactedAt;
    const dow = d.getDay();
    const day = ymd(d);
    sumByDow[dow] += Number(r.grossAmount);
    distinctDays[dow].add(day);
    dayCountByDow.add(`${dow}|${day}`);
  }
  return sumByDow.map((s, dow) => {
    const n = distinctDays[dow].size;
    return n > 0 ? s / n : 0;
  });
}

// Opening balance = sum of the most-recent closing balance per account.
// Multiple bank accounts each contribute their own latest closing; the
// projection runs against the consolidated cash position, not whichever
// single statement happened to be uploaded last.
async function fetchOpeningBalance(): Promise<{ amount: number; statementDate: string | null }> {
  const rows = await prisma.bankStatement.findMany({
    orderBy: [{ accountName: "asc" }, { statementDate: "desc" }],
    select: { accountName: true, statementDate: true, closingBalance: true },
  });
  if (rows.length === 0) return { amount: 0, statementDate: null };

  // Group by accountName (null = "default"), keep first row in each group
  // since rows are already sorted statementDate desc within each group.
  const seen = new Set<string>();
  const latestPerAccount: typeof rows = [];
  for (const r of rows) {
    const key = r.accountName ?? "__default__";
    if (seen.has(key)) continue;
    seen.add(key);
    latestPerAccount.push(r);
  }

  const amount = latestPerAccount.reduce((s, r) => s + Number(r.closingBalance), 0);
  const newest = latestPerAccount.reduce(
    (acc, r) => (acc == null || r.statementDate > acc ? r.statementDate : acc),
    null as Date | null,
  );
  return { amount, statementDate: newest ? ymd(newest) : null };
}

// Last 3 paid monthly payroll runs → average net per month.
// Run-date heuristic: payday from hr_payroll_runs if present, else 25th of period_month/year.
async function projectPayroll(start: Date, end: Date): Promise<{ date: Date; amount: number }[]> {
  const rows = await prisma.$queryRaw<Array<{ avg_net: string | null }>>`
    SELECT AVG(total_net) AS avg_net
    FROM hr_payroll_runs
    WHERE status = 'paid' AND cycle_type = 'monthly'
    AND created_at >= NOW() - INTERVAL '4 months'
  `;
  const avgNet = Number(rows[0]?.avg_net ?? 0);
  if (avgNet <= 0) return [];

  const out: { date: Date; amount: number }[] = [];
  // Project on the 25th of every month within the window.
  const cursor = new Date(start.getFullYear(), start.getMonth(), 25);
  while (cursor <= end) {
    if (cursor >= start) out.push({ date: new Date(cursor), amount: avgNet });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

// Last 3 months of ads_invoice → average monthly spend, projected forward.
// Total is in micros (Google Ads convention) — divide by 1,000,000 to get RM.
async function projectMarketing(start: Date, end: Date): Promise<{ date: Date; amount: number }[]> {
  const rows = await prisma.$queryRaw<Array<{ avg_total: string | null; sample_day: number | null }>>`
    SELECT
      AVG(total_micros) / 1000000.0 AS avg_total,
      AVG(EXTRACT(DAY FROM issue_date))::int AS sample_day
    FROM ads_invoice
    WHERE issue_date >= (CURRENT_DATE - INTERVAL '4 months')::date
  `;
  const avg = Number(rows[0]?.avg_total ?? 0);
  if (avg <= 0) return [];
  const sampleDay = Number(rows[0]?.sample_day ?? 5);

  const out: { date: Date; amount: number }[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), Math.min(28, sampleDay));
  while (cursor <= end) {
    if (cursor >= start) out.push({ date: new Date(cursor), amount: avg });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

// --- Bank-line per-category projection ---------------------------------
//
// Aggregates BankStatementLine rows into the bucket fields the projection
// renders. Sales-channel inflows (CARD/QR/STOREHUB/GRAB/FOODPANDA/
// GASTROHUB/MEETINGS_EVENTS) get a per-DOW shape so weekend revenue
// projects higher than Tuesday revenue; everything else projects as a
// flat per-day rate over the lookback window.
//
// This is the "projection should be based on this as well" path — when
// bank-line data exists for a category, that supersedes the synthetic
// stream (StoreHub DOW averages, hr_payroll_runs, ads_invoice). When a
// category has no bank-line data (e.g. brand new bank account) the
// caller falls back to the synthetic stream.

// Sales channels — DOW-shaped projection (revenue varies by day-of-week)
const SALES_INFLOW_CATEGORIES = [
  "CARD", "QR", "STOREHUB", "GRAB", "GRAB_PUTRAJAYA",
  "FOODPANDA", "MEETINGS_EVENTS", "GASTROHUB",
] as const;

// COGS — separate column for raw materials + delivery. Daily rate
// smearing is the right model: suppliers paid throughout the week.
const COGS_OUTFLOW_CATEGORIES = [
  "RAW_MATERIALS", "DELIVERY",
] as const;

// Categories that are projected via RecurringExpense entries (exact
// pulse timing, per outlet). The auto-generator at
// scripts/generate-recurring-from-bank-lines.ts populates these.
// Bank lines in these categories are EXCLUDED from the catch-all
// daily-smear path to avoid double-counting (the RecurringExpense
// expansion already fires them on the actual due date).
const PULSE_CATEGORIES = new Set<string>([
  "RENT", "UTILITIES", "SOFTWARE",
  "EMPLOYEE_SALARY", "STATUTORY_PAYMENT",
  "TAX", "COMPLIANCE", "MAINTENANCE",
  "LICENSING_FEE", "ROYALTY_FEE", "BANK_FEE", "CFS_FEE",
  "LOAN", "MANAGEMENT_FEE",
]);

// Everything else (DIRECTORS_ALLOWANCE, PARTIMER, STAFF_CLAIM,
// PETTY_CASH, MARKETING categories, EQUIPMENTS, INVESTMENTS,
// TRANSFER_NOT_SUCCESSFUL, OTHER_OUTFLOW) flows into the catch-all
// "Other outflow" daily-rate stream. These are genuinely variable
// (directors' draws, capex, marketing campaigns) — exact pulse
// timing wouldn't be useful and a smoothed daily rate represents
// the run-rate fairly.

type BankLineProjection = {
  salesByDow: number[];          // [Sun..Sat] daily averages from sales categories
  cogsPerDay: number;            // raw materials + delivery
  otherInPerDay: number;         // catch-all CR (LOAN inflow, refunds, OTHER_INFLOW, etc.)
  otherOutPerDay: number;        // catch-all DR (directors, partimer, marketing, capex,
                                 // OTHER_OUTFLOW, etc.) — excludes PULSE_CATEGORIES
                                 // to avoid double-count with RecurringExpense pulses
  sampleDays: number;            // number of distinct calendar days the data covers
  hasData: boolean;
};

async function bankLineProjection(outletIds: string[]): Promise<BankLineProjection | null> {
  const lookback = 90;
  const since = new Date(Date.now() - lookback * DAY_MS);
  // Outlet filter: when filtered, only include lines tagged to the
  // selected outlets; HQ-paid (null outletId) rows are excluded so we
  // don't double-count central spend against an outlet view.
  const lines = await prisma.bankStatementLine.findMany({
    where: {
      txnDate: { gte: since },
      isInterCo: false,
      ...(outletIds.length > 0 ? { outletId: outletIds.length === 1 ? outletIds[0] : { in: outletIds } } : {}),
    },
    select: { txnDate: true, direction: true, amount: true, category: true },
  });

  if (lines.length === 0) return null;

  // Span the actual lookback window — distinct days seen, fall back to
  // the lookback constant when no data.
  const daySet = new Set<string>();
  const salesSumByDow = [0, 0, 0, 0, 0, 0, 0];
  const salesDistinctDaysByDow: Set<string>[] = [
    new Set(), new Set(), new Set(), new Set(), new Set(), new Set(), new Set(),
  ];
  let cogsSum = 0;
  let otherInSum = 0;
  let otherOutSum = 0;

  const SALES_SET = new Set<string>(SALES_INFLOW_CATEGORIES as readonly string[]);
  const COGS_SET = new Set<string>(COGS_OUTFLOW_CATEGORIES as readonly string[]);

  for (const l of lines) {
    if (!l.category) continue;
    const dayKey = ymd(l.txnDate);
    daySet.add(dayKey);
    const amt = Number(l.amount);
    const cat = l.category as string;
    if (l.direction === "CR") {
      if (SALES_SET.has(cat)) {
        const dow = l.txnDate.getDay();
        salesSumByDow[dow] += amt;
        salesDistinctDaysByDow[dow].add(dayKey);
      } else {
        // Catch-all: refunds, LOAN inflow, OTHER_INFLOW etc.
        otherInSum += amt;
      }
    } else {
      // DR
      if (COGS_SET.has(cat)) cogsSum += amt;
      else if (PULSE_CATEGORIES.has(cat)) {
        // Skip — these are projected via RecurringExpense expansion
        // on their actual due dates. Including them here would
        // double-count.
      }
      else otherOutSum += amt;  // directors, partimer, marketing, capex, catch-alls
    }
  }

  const sampleDays = Math.max(1, daySet.size);
  const salesByDow = salesSumByDow.map((s, dow) => {
    const n = salesDistinctDaysByDow[dow].size;
    return n > 0 ? s / n : 0;
  });

  return {
    salesByDow,
    cogsPerDay: cogsSum / sampleDays,
    otherInPerDay: otherInSum / sampleDays,
    otherOutPerDay: otherOutSum / sampleDays,
    sampleDays,
    hasData: true,
  };
}

// Hybrid model — derive a per-day inflow/outflow rate from recent bank
// statements with period totals. With multiple bank accounts each posting
// statements covering the same calendar dates, naive sum-then-divide
// understates the per-day rate by the number of accounts (a calendar day
// would be triple-counted in the divisor). Group by accountName, compute
// a per-day rate per account from its own period coverage, then sum
// across accounts — that's the consolidated daily flow.
async function bankFlowsPerDay(): Promise<{ inflow: number; outflow: number; sampleDays: number } | null> {
  const rows = await prisma.bankStatement.findMany({
    where: {
      periodStart: { not: null },
      periodEnd: { not: null },
      OR: [{ totalInflows: { not: null } }, { totalOutflows: { not: null } }],
    },
    orderBy: { statementDate: "desc" },
    select: {
      accountName: true, periodStart: true, periodEnd: true,
      totalInflows: true, totalOutflows: true,
      interCoInflows: true, interCoOutflows: true,
    },
  });
  if (rows.length === 0) return null;

  // Bucket by account, keep at most the last 6 statements per account so a
  // very stale row doesn't drag the rate.
  const byAccount = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.accountName ?? "__default__";
    const existing = byAccount.get(key) ?? [];
    if (existing.length >= 6) continue;
    existing.push(r);
    byAccount.set(key, existing);
  }

  let perDayIn = 0;
  let perDayOut = 0;
  let maxSpanDays = 0;
  for (const accountRows of byAccount.values()) {
    let acctIn = 0;
    let acctOut = 0;
    let acctDays = 0;
    for (const r of accountRows) {
      if (!r.periodStart || !r.periodEnd) continue;
      const days = Math.max(1, Math.round((r.periodEnd.getTime() - r.periodStart.getTime()) / DAY_MS) + 1);
      acctDays += days;
      // Subtract InterCo flows so the bank-residual rate reflects only
      // external cash movement (sales receipts, supplier payments, etc),
      // not internal transfers between Celsius entities.
      const ico_in = r.interCoInflows == null ? 0 : Number(r.interCoInflows);
      const ico_out = r.interCoOutflows == null ? 0 : Number(r.interCoOutflows);
      if (r.totalInflows != null)  acctIn  += Math.max(0, Number(r.totalInflows)  - ico_in);
      if (r.totalOutflows != null) acctOut += Math.max(0, Number(r.totalOutflows) - ico_out);
    }
    if (acctDays === 0) continue;
    perDayIn += acctIn / acctDays;
    perDayOut += acctOut / acctDays;
    maxSpanDays = Math.max(maxSpanDays, acctDays);
  }
  if (maxSpanDays === 0) return null;
  return { inflow: perDayIn, outflow: perDayOut, sampleDays: maxSpanDays };
}

// Total invoice outflow paid out over the last 4 months / total days in the
// window — feeds the synthetic-known per-day baseline for the residual calc.
async function historicalInvoicePerDay(outletIds: string[]): Promise<number> {
  const since = new Date(Date.now() - 120 * DAY_MS);
  const rows = await prisma.invoice.findMany({
    where: {
      status: "PAID",
      paidAt: { gte: since },
      ...outletScope(outletIds),
    },
    select: { amount: true },
  });
  if (rows.length === 0) return 0;
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  return total / 120;
}

// Walk a recurring expense's nextDueDate forward by cadence until past the
// horizon end. Returns each occurrence inside the window.
function expandRecurring(
  exp: { id: string; amount: number; cadence: "MONTHLY" | "QUARTERLY" | "YEARLY"; nextDueDate: Date },
  start: Date,
  end: Date,
): { date: Date; amount: number; recurringExpenseId: string }[] {
  const out: { date: Date; amount: number; recurringExpenseId: string }[] = [];
  let cursor = new Date(exp.nextDueDate);
  // Catch up to the window in case nextDueDate is in the past
  while (cursor < start) cursor = addCadence(cursor, exp.cadence);
  while (cursor <= end) {
    out.push({ date: new Date(cursor), amount: exp.amount, recurringExpenseId: exp.id });
    cursor = addCadence(cursor, exp.cadence);
  }
  return out;
}

export async function computeCashflow(opts: {
  weeks?: number;
  // Either a single outletId (legacy) or an outletIds array (multi-filter).
  // Empty / null / undefined = consolidated "all outlets" view.
  outletId?: string | null;
  outletIds?: string[];
}): Promise<CashflowResult> {
  const weeks = Math.max(1, Math.min(26, opts.weeks ?? 8));
  // Normalise to an array; deduplicate just in case.
  const outletIds = Array.from(
    new Set(
      (opts.outletIds ?? []).concat(opts.outletId ? [opts.outletId] : []).filter(Boolean) as string[],
    ),
  );
  const isFiltered = outletIds.length > 0;
  const warnings: string[] = [];

  // Today (local midnight). Buckets start at the next Monday.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const firstMonday = startOfWeek(today);
  const horizonEnd = new Date(firstMonday.getTime() + weeks * 7 * DAY_MS - 1);

  // Opening balance — always consolidated across all bank accounts; we
  // don't have account → outlet mapping, so per-outlet views still see
  // the company's full cash position.
  const opening = await fetchOpeningBalance();
  if (!opening.statementDate) warnings.push("No bank statement uploaded — opening balance is RM 0.00. Upload one to get a real projection.");

  // Bank-line projection — primary source. When categorized lines exist,
  // they drive every bucket field. Synthetic streams below act as a
  // fallback only.
  const bankProj = await bankLineProjection(outletIds);

  // Sales forecast — bank-line DOW averages take precedence; synthetic
  // StoreHub DOW is fallback when no bank-line sales data exists for
  // the scope.
  const synthDow = await dayOfWeekSalesAverages(outletIds);
  const dowAvg = bankProj && bankProj.salesByDow.some((v) => v > 0)
    ? bankProj.salesByDow
    : synthDow;
  const dowTotal = dowAvg.reduce((a, b) => a + b, 0);
  if (dowTotal === 0) warnings.push("No bank-line sales nor StoreHub history for the selected scope — sales forecast is RM 0.");

  // Outflows — invoices in horizon (full-DB scope; outlet filter applies if set)
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: ["DRAFT", "PENDING", "INITIATED", "PARTIALLY_PAID", "DEPOSIT_PAID", "OVERDUE"] },
      dueDate: { gte: today, lte: horizonEnd },
      ...outletScope(outletIds),
    },
    select: { id: true, amount: true, depositAmount: true, amountPaid: true, status: true, dueDate: true },
  });

  // Recurring / payroll / monthly outflows are now driven by the
  // RecurringExpense table — auto-populated per-outlet with exact
  // amounts and due-day-of-month from bank-line history (see
  // scripts/generate-recurring-from-bank-lines.ts). expandRecurring()
  // then fires each entry on its actual due date inside the horizon
  // — no daily smearing, no double-counting.
  //
  // Per-outlet filter: only entries tagged to the selected outlet (or
  // HQ-level entries for shared services) fire. RecurringExpense
  // categories cover RENT, UTILITY, SAAS, PAYROLL_SUPPORT (salary +
  // directors + statutory), and OTHER (loan, tax, compliance).
  const recurring = await prisma.recurringExpense.findMany({
    where: {
      isActive: true,
      ...(isFiltered
        ? { OR: [{ outletId: outletIds.length === 1 ? outletIds[0] : { in: outletIds } }, { outletId: null }] }
        : {}),
    },
  });

  // Synthetic payroll/marketing streams (the legacy hr_payroll_runs
  // and ads_invoice path) are only used as a fallback when no
  // RecurringExpense entries exist for the relevant categories. The
  // per-outlet RecurringExpense entries above replace this for
  // payroll. Marketing's still synthetic since we don't auto-generate
  // marketing recurring entries (most marketing is one-off card spend).
  const hasRecurringPayroll = recurring.some((r) => r.category === "PAYROLL_SUPPORT");
  const payrollProjected = hasRecurringPayroll ? [] : await projectPayroll(today, horizonEnd);
  const marketingProjected = isFiltered ? [] : await projectMarketing(today, horizonEnd);
  if (isFiltered) {
    warnings.push("Marketing run-rate is HQ-only and not allocated to outlets — it's excluded from the filtered view.");
  }

  // Other-bank residual. Two paths:
  //  1. Bank-line projection available → use the per-category buckets
  //     directly (otherInPerDay = unclassified inflow run-rate;
  //     otherOutPerDay = capex/raw-mat/catch-all run-rate). This is
  //     the "projection should be based on bank lines as well" path.
  //  2. Fallback to legacy bankStatementsPerDay residual model — bank
  //     period totals minus the synthetic streams. Only used when no
  //     classified lines exist yet.
  const bankFlows = (!bankProj && !isFiltered) ? await bankFlowsPerDay() : null;
  if (!bankProj && !bankFlows && !isFiltered) {
    warnings.push("No classified bank lines and no statement period totals — \"Other (bank)\" residual is RM 0. Upload a CSV/Excel statement to enable a real projection.");
  }
  let otherInPerDay = 0;
  let otherOutPerDay = 0;
  if (bankProj) {
    // Bank-line model is authoritative — categories already partition
    // the flow exactly, no residual subtraction needed.
    otherInPerDay = bankProj.otherInPerDay;
    otherOutPerDay = bankProj.otherOutPerDay;
  } else if (bankFlows) {
    // Legacy residual fallback (no classified lines yet)
    const dailySalesSynthetic = dowAvg.reduce((a, b) => a + b, 0) / 7;
    const monthlyPayrollAvg = payrollProjected.length > 0
      ? payrollProjected.reduce((s, p) => s + p.amount, 0) / Math.max(1, payrollProjected.length)
      : 0;
    const monthlyMarketingAvg = marketingProjected.length > 0
      ? marketingProjected.reduce((s, m) => s + m.amount, 0) / Math.max(1, marketingProjected.length)
      : 0;
    const recurringPerDay = recurring.reduce((s, r) => {
      const perYear = r.cadence === "MONTHLY" ? 12 : r.cadence === "QUARTERLY" ? 4 : 1;
      return s + Number(r.amount) * perYear / 365;
    }, 0);
    const invoicePerDayHistory = await historicalInvoicePerDay([]);
    const dailySyntheticOut = monthlyPayrollAvg / 30 + monthlyMarketingAvg / 30 + recurringPerDay + invoicePerDayHistory;
    otherInPerDay = Math.max(0, bankFlows.inflow - dailySalesSynthetic);
    otherOutPerDay = Math.max(0, bankFlows.outflow - dailySyntheticOut);
  }

  // Bank-line daily-rate streams. Only used for COGS and the
  // catch-all Other in/out — those are paid frequently throughout
  // the week (multiple supplier runs, refunds, transfers etc.) so a
  // per-day rate is more accurate than a monthly pulse. Payroll /
  // marketing / recurring instead use exact pulse timing from the
  // RecurringExpense expansion above so the projection shows
  // payments on their actual due-day-of-month rather than smeared
  // across every week.
  const bankCogsPerDay = bankProj && bankProj.cogsPerDay > 0 ? bankProj.cogsPerDay : 0;

  // Bucket builder
  const buckets: CashflowBucket[] = [];
  let runningOpening = opening.amount;

  for (let i = 0; i < weeks; i++) {
    const weekStart = new Date(firstMonday.getTime() + i * 7 * DAY_MS);
    const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS - 1);

    // Sales for this week — sum dow averages over the 7 days in the week
    let salesIn = 0;
    for (let d = 0; d < 7; d++) {
      const day = new Date(weekStart.getTime() + d * DAY_MS);
      // For the partial first week (today < weekStart's first day), only count days >= today
      if (day < today) continue;
      salesIn += dowAvg[day.getDay()];
    }

    // Invoices due this week
    const wkInvoices = invoices.filter((iv) => iv.dueDate && iv.dueDate >= weekStart && iv.dueDate <= weekEnd);
    const invoiceOut = wkInvoices.reduce((s, iv) => {
      const amt = Number(iv.amount);
      // amountPaid is the source of truth (covers DEPOSIT_PAID,
      // PARTIALLY_PAID, and any combination of partials). Falls back to
      // depositAmount for legacy DEPOSIT_PAID rows that haven't been
      // touched since the partial-payments migration.
      const paid = iv.amountPaid == null ? 0 : Number(iv.amountPaid);
      if (paid > 0) return s + Math.max(0, amt - paid);
      const dep = iv.depositAmount == null ? 0 : Number(iv.depositAmount);
      return s + (iv.status === "DEPOSIT_PAID" ? Math.max(0, amt - dep) : amt);
    }, 0);

    // Payroll this week
    const payrollOut = payrollProjected
      .filter((p) => p.date >= weekStart && p.date <= weekEnd)
      .reduce((s, p) => s + p.amount, 0);

    // Marketing this week
    const marketingOut = marketingProjected
      .filter((m) => m.date >= weekStart && m.date <= weekEnd)
      .reduce((s, m) => s + m.amount, 0);

    // Other (bank residual) — count days in the week that are
    // >= today, since partial first weeks shouldn't include past days.
    let activeDays = 0;
    for (let d = 0; d < 7; d++) {
      const day = new Date(weekStart.getTime() + d * DAY_MS);
      if (day >= today) activeDays++;
    }
    const otherIn = otherInPerDay * activeDays;
    const otherOut = otherOutPerDay * activeDays;

    // Bank-line daily rate ONLY for COGS (paid to suppliers throughout
    // the week — daily smearing is the right model).
    const cogsOut = bankCogsPerDay * activeDays;

    // RecurringExpense entries fire on their actual due dates inside
    // the week (no smearing). Category determines which bucket they
    // land in: PAYROLL_SUPPORT → Payroll column; everything else →
    // Recurring. Mirrors the bucket grouping in the auto-generator at
    // scripts/generate-recurring-from-bank-lines.ts.
    let payrollFromRecurring = 0;
    let recurringFromRecurring = 0;
    const recurringExpenseIds: string[] = [];
    for (const exp of recurring) {
      const occurrences = expandRecurring(
        { id: exp.id, amount: Number(exp.amount), cadence: exp.cadence, nextDueDate: exp.nextDueDate },
        weekStart,
        weekEnd,
      );
      if (occurrences.length === 0) continue;
      const wkAmount = occurrences.reduce((s, o) => s + o.amount, 0);
      if (exp.category === "PAYROLL_SUPPORT") payrollFromRecurring += wkAmount;
      else recurringFromRecurring += wkAmount;
      if (!recurringExpenseIds.includes(exp.id)) recurringExpenseIds.push(exp.id);
    }

    // Bucket totals
    const totalPayrollOut = payrollOut + payrollFromRecurring;
    const totalMarketingOut = marketingOut;
    const totalRecurringOut = recurringFromRecurring;

    const closing = runningOpening
      + salesIn + otherIn
      - invoiceOut - totalPayrollOut - cogsOut - totalMarketingOut - totalRecurringOut - otherOut;

    buckets.push({
      weekStart: ymd(weekStart),
      weekEnd: ymd(weekEnd),
      opening: round2(runningOpening),
      salesIn: round2(salesIn),
      otherIn: round2(otherIn),
      invoiceOut: round2(invoiceOut),
      payrollOut: round2(totalPayrollOut),
      cogsOut: round2(cogsOut),
      marketingOut: round2(totalMarketingOut),
      recurringOut: round2(totalRecurringOut),
      otherOut: round2(otherOut),
      closing: round2(closing),
      invoiceIds: wkInvoices.map((iv) => iv.id),
      recurringExpenseIds,
    });

    runningOpening = closing;
  }

  // Historical "cash generated per month" — primary KPI Finance asks
  // about. Pulled straight from BankStatement period totals, summed
  // across accounts. When BankStatement.interCoInflows/Outflows are set
  // we subtract them from gross flows so the net excludes internal
  // transfers between Celsius entities — without that, a transfer to
  // an internal account we don't track shows as "cash burned" when
  // it isn't.
  const [monthlyHistory, operatingCashFlow, minByMonth] = await Promise.all([
    loadMonthlyHistory(),
    loadOperatingCashFlow(),
    loadMinBalancePerMonth(),
  ]);
  // Merge min balance into monthlyHistory rows
  for (const row of monthlyHistory) {
    const m = minByMonth.get(row.month);
    if (m) {
      row.minBalance = m.min;
      row.minBalanceDate = m.date;
    }
  }
  const cashGeneration = summariseCashGeneration(monthlyHistory, opening.amount);
  // Projected min balance — lowest closing across the projection horizon
  const projectedMin = buckets.length === 0 ? null : buckets.reduce<{ closing: number; weekStart: string; weekEnd: string } | null>(
    (acc, b) => acc == null || b.closing < acc.closing ? { closing: b.closing, weekStart: b.weekStart, weekEnd: b.weekEnd } : acc,
    null,
  );
  const unflaggedOutlier = monthlyHistory.find(
    (m) => Math.abs(m.netGenerated) > 100000 && (m.interCoInflows ?? 0) === 0 && (m.interCoOutflows ?? 0) === 0,
  );
  if (unflaggedOutlier && !isFiltered) {
    warnings.push(`${unflaggedOutlier.month} net was ${unflaggedOutlier.netGenerated >= 0 ? "+" : ""}RM ${Math.round(unflaggedOutlier.netGenerated).toLocaleString()} — likely an InterCo transfer. Edit that month's statement and fill in the InterCo offset to exclude it from cash generation.`);
  }
  if (monthlyHistory.some((m) => m.accountsReporting < 3) && !isFiltered) {
    warnings.push("Some months have fewer than 3 reporting accounts — uploaded statement set is incomplete for those months.");
  }

  return {
    asOf: ymd(today),
    weeks,
    // Echo back what the API was scoped to so the page can label the result.
    // Still legacy outletId for back-compat; outletIds is the canonical field.
    outletId: outletIds.length === 1 ? outletIds[0] : null,
    outletIds,
    openingBalance: opening,
    bankFlowsPerDay: bankProj
      ? {
          // Bank-line daily averages — Sales DOW + Other inflow on the
          // CR side; COGS + Other outflow on the DR side. Pulse-driven
          // categories (rent/salary/etc.) aren't included here because
          // they fire on specific dates, not daily.
          inflow: round2(
            (bankProj.salesByDow.reduce((a, b) => a + b, 0) / 7) + bankProj.otherInPerDay,
          ),
          outflow: round2(bankProj.cogsPerDay + bankProj.otherOutPerDay),
          sampleDays: bankProj.sampleDays,
        }
      : bankFlows
        ? { inflow: round2(bankFlows.inflow), outflow: round2(bankFlows.outflow), sampleDays: bankFlows.sampleDays }
        : null,
    monthlyHistory,
    operatingCashFlow,
    cashGeneration,
    projectedMin,
    buckets,
    warnings,
  };
}

// Pull last 12 months of BankStatement records and compute monthly
// cash generation via closing-balance roll-forward.
//
// For each (account, month):
//   monthly_change = closingBalance(this month) - closingBalance(prior month)
//
// Sum across accounts → consolidated balance change. Then subtract
// InterCo (transfers to/from accounts outside the 3 we track) so
// internal shuffling doesn't pollute the headline.
//
// Falls back to (totalInflows - totalOutflows) when no prior-month
// closing exists for an account (typically the first month uploaded).
async function loadMonthlyHistory(): Promise<CashflowResult["monthlyHistory"]> {
  const since = new Date();
  since.setMonth(since.getMonth() - 12);
  const rows = await prisma.bankStatement.findMany({
    where: { periodStart: { not: null, gte: since } },
    select: {
      accountName: true, periodStart: true, periodEnd: true,
      closingBalance: true,
      totalInflows: true, totalOutflows: true,
      interCoInflows: true, interCoOutflows: true,
    },
    orderBy: { periodEnd: "asc" },
  });

  // Group by month → list of (account, statement)
  type Stmt = { account: string; closing: number; totalIn: number; totalOut: number; icoIn: number; icoOut: number };
  const byMonth = new Map<string, Stmt[]>();
  // Also keep per-account chronological list to look up prior-month closing
  const byAccount = new Map<string, { month: string; closing: number }[]>();

  for (const r of rows) {
    if (!r.periodStart) continue;
    const monthKey = `${r.periodStart.getFullYear()}-${String(r.periodStart.getMonth() + 1).padStart(2, "0")}`;
    const account = r.accountName ?? "__default__";
    const stmt: Stmt = {
      account,
      closing: Number(r.closingBalance),
      totalIn: Number(r.totalInflows ?? 0),
      totalOut: Number(r.totalOutflows ?? 0),
      icoIn: Number(r.interCoInflows ?? 0),
      icoOut: Number(r.interCoOutflows ?? 0),
    };
    if (!byMonth.has(monthKey)) byMonth.set(monthKey, []);
    byMonth.get(monthKey)!.push(stmt);

    if (!byAccount.has(account)) byAccount.set(account, []);
    byAccount.get(account)!.push({ month: monthKey, closing: stmt.closing });
  }
  // Sort each account's history chronologically
  for (const list of byAccount.values()) list.sort((a, b) => a.month.localeCompare(b.month));

  return Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, stmts]) => {
      // Try balance roll-forward first
      let balanceChange = 0;
      let allHavePrior = true;
      for (const s of stmts) {
        const list = byAccount.get(s.account)!;
        const idx = list.findIndex((x) => x.month === month);
        const prior = idx > 0 ? list[idx - 1] : null;
        if (!prior) { allHavePrior = false; break; }
        balanceChange += s.closing - prior.closing;
      }

      const cashIn  = stmts.reduce((s, x) => s + x.totalIn,  0);
      const cashOut = stmts.reduce((s, x) => s + x.totalOut, 0);
      const icoIn   = stmts.reduce((s, x) => s + x.icoIn,    0);
      const icoOut  = stmts.reduce((s, x) => s + x.icoOut,   0);

      // Net of InterCo: balance change + (icoOut - icoIn) — when InterCo
      // moves money to an untracked 4th account, our 3-account view sees
      // it as outflow but it's not real burn. Adding icoOut back removes
      // that distortion. Symmetric on the inflow side.
      const netFromBalance = balanceChange + (icoOut - icoIn);
      const netFromTotals  = (cashIn - icoIn) - (cashOut - icoOut);

      const netGenerated = allHavePrior ? netFromBalance : netFromTotals;
      const netSource: 'balance' | 'periodTotals' = allHavePrior ? 'balance' : 'periodTotals';

      return {
        month,
        cashIn: round2(cashIn),
        cashOut: round2(cashOut),
        interCoInflows: round2(icoIn),
        interCoOutflows: round2(icoOut),
        netGenerated: round2(netGenerated),
        netSource,
        minBalance: null as number | null,
        minBalanceDate: null as string | null,
        accountsReporting: new Set(stmts.map((s) => s.account)).size,
      };
    });
}

// Reconstruct daily consolidated balance (sum across accounts) and
// return min per month. Uses prior month's closingBalance as the
// starting balance and walks forward day-by-day applying lines and
// carrying balance when there's no activity. Skips months where any
// account has no prior closing (we can't anchor the reconstruction).
//
// QuickBooks-style: their Cash Flow Projector highlights minimum
// projected balance — same idea here for the past, so finance can
// see "we got down to RM 20,676 on Feb 11" not just "Feb net was X".
async function loadMinBalancePerMonth(): Promise<Map<string, { min: number; date: string }>> {
  const since = new Date();
  since.setMonth(since.getMonth() - 12);

  const statements = await prisma.bankStatement.findMany({
    where: { periodStart: { gte: since } },
    select: { id: true, accountName: true, periodStart: true, periodEnd: true, closingBalance: true },
    orderBy: { periodStart: "asc" },
  });
  const lines = await prisma.bankStatementLine.findMany({
    where: { txnDate: { gte: since } },
    select: { txnDate: true, amount: true, direction: true, statementId: true },
  });

  const accountByStmt = new Map<string, string>();
  for (const s of statements) accountByStmt.set(s.id, s.accountName ?? "__default__");

  // Per-account chronological closings
  const closingsPerAccount = new Map<string, { month: string; periodStart: Date; periodEnd: Date; closing: number }[]>();
  for (const s of statements) {
    if (!s.periodStart || !s.periodEnd) continue;
    const account = s.accountName ?? "__default__";
    if (!closingsPerAccount.has(account)) closingsPerAccount.set(account, []);
    closingsPerAccount.get(account)!.push({
      month: ymd(s.periodStart).slice(0, 7),
      periodStart: s.periodStart,
      periodEnd: s.periodEnd,
      closing: Number(s.closingBalance),
    });
  }
  for (const list of closingsPerAccount.values()) {
    list.sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime());
  }

  // Per-account chronological lines
  const linesByAccount = new Map<string, { date: Date; signed: number }[]>();
  for (const l of lines) {
    const account = accountByStmt.get(l.statementId);
    if (!account) continue;
    if (!linesByAccount.has(account)) linesByAccount.set(account, []);
    linesByAccount.get(account)!.push({
      date: l.txnDate,
      signed: l.direction === "CR" ? Number(l.amount) : -Number(l.amount),
    });
  }
  for (const list of linesByAccount.values()) {
    list.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  // For each month, build the per-account daily series and aggregate
  // across accounts. Track min consolidated balance per month.
  // dailyByAccount[account][YYYY-MM-DD] = balance at end of that day
  const dailyByAccount = new Map<string, Map<string, number>>();
  for (const [account, closings] of closingsPerAccount.entries()) {
    const lns = linesByAccount.get(account) ?? [];
    const days = new Map<string, number>();
    for (let i = 1; i < closings.length; i++) {     // start from i=1 — need a prior closing to anchor
      const prior = closings[i - 1];
      const cur = closings[i];
      const monthStart = cur.periodStart;
      const monthEnd = cur.periodEnd;
      let balance = prior.closing;
      const cursor = new Date(monthStart);
      // Apply all lines in [monthStart, monthEnd] day by day
      let li = 0;
      while (li < lns.length && lns[li].date < monthStart) li++;
      while (cursor.getTime() <= monthEnd.getTime()) {
        const dayKey = ymd(cursor);
        while (li < lns.length && ymd(lns[li].date) === dayKey) {
          balance += lns[li].signed;
          li++;
        }
        days.set(dayKey, balance);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    dailyByAccount.set(account, days);
  }

  // Consolidated per day = sum across accounts. Only include a day
  // when ALL accounts have a balance for it (so we don't undercount
  // by missing an account's contribution).
  const accounts = Array.from(closingsPerAccount.keys());
  const dailyConsolidated = new Map<string, number>();
  // Find every distinct day where at least one account has data
  const allDays = new Set<string>();
  for (const days of dailyByAccount.values()) for (const d of days.keys()) allDays.add(d);
  for (const day of allDays) {
    let sum = 0;
    let allHave = true;
    for (const account of accounts) {
      const bal = dailyByAccount.get(account)?.get(day);
      if (bal == null) { allHave = false; break; }
      sum += bal;
    }
    if (allHave) dailyConsolidated.set(day, sum);
  }

  // Min per month
  const minByMonth = new Map<string, { min: number; date: string }>();
  for (const [day, bal] of dailyConsolidated.entries()) {
    const month = day.slice(0, 7);
    const cur = minByMonth.get(month);
    if (!cur || bal < cur.min) minByMonth.set(month, { min: round2(bal), date: day });
  }
  return minByMonth;
}

// Operating Cash Flow per month — sourced from classified bank lines.
// Pure operations only: sales channels in, operating costs out.
// Excludes financing (loans, capital injections), investing (capex,
// equipment, renovations, software-as-investment), owner draws
// (directors' allowance), one-offs (refunds, OTHER_*, transfers),
// and InterCo.
async function loadOperatingCashFlow(): Promise<CashflowResult["operatingCashFlow"]> {
  const since = new Date();
  since.setMonth(since.getMonth() - 12);
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const lines = await prisma.bankStatementLine.findMany({
    where: {
      txnDate: { gte: since },
      isInterCo: false,
    },
    select: { txnDate: true, direction: true, amount: true, category: true },
  });

  type Row = CashflowResult["operatingCashFlow"][number];
  const byMonth = new Map<string, Row>();
  function emptyRow(month: string): Row {
    return {
      month,
      sales: { card: 0, qr: 0, storehub: 0, grab: 0, foodpanda: 0, gastrohub: 0, meetings: 0, total: 0 },
      costs: { payroll: 0, cogs: 0, rent: 0, utilities: 0, marketing: 0, software: 0, taxCompliance: 0, maintenance: 0, total: 0 },
      operatingNet: 0,
    };
  }

  for (const l of lines) {
    if (!l.category) continue;
    const month = `${l.txnDate.getFullYear()}-${String(l.txnDate.getMonth() + 1).padStart(2, "0")}`;
    if (!byMonth.has(month)) byMonth.set(month, emptyRow(month));
    const row = byMonth.get(month)!;
    const amt = Number(l.amount);
    const cat = l.category as string;

    if (l.direction === "CR") {
      switch (cat) {
        case "CARD":           row.sales.card     += amt; break;
        case "QR":             row.sales.qr       += amt; break;
        case "STOREHUB":       row.sales.storehub += amt; break;
        case "GRAB":
        case "GRAB_PUTRAJAYA": row.sales.grab     += amt; break;
        case "FOODPANDA":      row.sales.foodpanda+= amt; break;
        case "GASTROHUB":      row.sales.gastrohub+= amt; break;
        case "MEETINGS_EVENTS":row.sales.meetings += amt; break;
        // Other CR categories (LOAN, CAPITAL, OTHER_INFLOW, refunds)
        // are NOT operating — excluded.
      }
    } else {
      // DR — operating costs only. Excludes:
      //   DIRECTORS_ALLOWANCE (owner draws, not operating)
      //   LOAN (financing)
      //   EQUIPMENTS, INVESTMENTS (capex / investing)
      //   OTHER_OUTFLOW (catch-all, mostly noise)
      //   TRANSFER_NOT_SUCCESSFUL
      switch (cat) {
        case "EMPLOYEE_SALARY":
        case "PARTIMER":
        case "STATUTORY_PAYMENT":
        case "STAFF_CLAIM":
        case "PETTY_CASH":     row.costs.payroll       += amt; break;
        case "RAW_MATERIALS":
        case "DELIVERY":       row.costs.cogs          += amt; break;
        case "RENT":           row.costs.rent          += amt; break;
        case "UTILITIES":      row.costs.utilities     += amt; break;
        case "DIGITAL_ADS":
        case "KOL":
        case "OTHER_MARKETING":
        case "MARKETPLACE_FEE":row.costs.marketing     += amt; break;
        case "SOFTWARE":       row.costs.software      += amt; break;
        case "TAX":
        case "COMPLIANCE":
        case "LICENSING_FEE":
        case "ROYALTY_FEE":
        case "CFS_FEE":
        case "BANK_FEE":       row.costs.taxCompliance += amt; break;
        case "MAINTENANCE":    row.costs.maintenance   += amt; break;
        // Excluded: DIRECTORS_ALLOWANCE, LOAN, EQUIPMENTS, INVESTMENTS, OTHER_OUTFLOW, TRANSFER_NOT_SUCCESSFUL
      }
    }
  }

  // Compute totals + round
  return Array.from(byMonth.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((r) => {
      const salesTotal = r.sales.card + r.sales.qr + r.sales.storehub + r.sales.grab + r.sales.foodpanda + r.sales.gastrohub + r.sales.meetings;
      const costsTotal = r.costs.payroll + r.costs.cogs + r.costs.rent + r.costs.utilities + r.costs.marketing + r.costs.software + r.costs.taxCompliance + r.costs.maintenance;
      r.sales.total = round2(salesTotal);
      r.costs.total = round2(costsTotal);
      r.sales.card = round2(r.sales.card);
      r.sales.qr = round2(r.sales.qr);
      r.sales.storehub = round2(r.sales.storehub);
      r.sales.grab = round2(r.sales.grab);
      r.sales.foodpanda = round2(r.sales.foodpanda);
      r.sales.gastrohub = round2(r.sales.gastrohub);
      r.sales.meetings = round2(r.sales.meetings);
      r.costs.payroll = round2(r.costs.payroll);
      r.costs.cogs = round2(r.costs.cogs);
      r.costs.rent = round2(r.costs.rent);
      r.costs.utilities = round2(r.costs.utilities);
      r.costs.marketing = round2(r.costs.marketing);
      r.costs.software = round2(r.costs.software);
      r.costs.taxCompliance = round2(r.costs.taxCompliance);
      r.costs.maintenance = round2(r.costs.maintenance);
      r.operatingNet = round2(salesTotal - costsTotal);
      return r;
    });
}

// Last-month / 3-month-avg / runway. Excludes incomplete months (fewer
// than the max accountsReporting we have) and the in-progress current
// month so the headline numbers don't get distorted by partial data.
function summariseCashGeneration(
  history: CashflowResult["monthlyHistory"],
  openingBalance: number,
): CashflowResult["cashGeneration"] {
  if (history.length === 0) {
    return { lastMonth: null, avg3Month: null, burnPerMonth: null, runwayMonths: null };
  }
  const maxAccounts = Math.max(...history.map((m) => m.accountsReporting));
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const complete = history.filter(
    (m) => m.month !== currentMonth && m.accountsReporting === maxAccounts,
  );
  const lastMonth = complete.length > 0
    ? { month: complete[complete.length - 1].month, net: complete[complete.length - 1].netGenerated }
    : null;
  const recent3 = complete.slice(-3);
  const avg3 = recent3.length > 0
    ? round2(recent3.reduce((s, m) => s + m.netGenerated, 0) / recent3.length)
    : null;
  const burn = avg3 != null && avg3 < 0 ? -avg3 : null;
  const runway = burn != null && burn > 0 ? round2(openingBalance / burn) : null;
  return { lastMonth, avg3Month: avg3, burnPerMonth: burn, runwayMonths: runway };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
