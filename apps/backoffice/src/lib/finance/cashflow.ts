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
  // Historical "cash generated per month" — straight from BankStatement
  // period totals, consolidated across accounts. cashIn/cashOut are
  // gross; netGenerated subtracts any InterCo offset Finance has marked
  // so internal transfers don't distort the KPI. The user's primary
  // question: did we generate cash or burn it last month?
  monthlyHistory: Array<{
    month: string;            // YYYY-MM
    cashIn: number;           // gross totalInflows across accounts
    cashOut: number;          // gross totalOutflows
    interCoInflows: number;   // marked InterCo portion of cashIn
    interCoOutflows: number;  // marked InterCo portion of cashOut
    netGenerated: number;     // (cashIn - interCoIn) - (cashOut - interCoOut)
    accountsReporting: number; // 3 = full coverage; less = data gap
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
      status: { in: ["DRAFT", "PENDING", "INITIATED", "DEPOSIT_PAID", "OVERDUE"] },
      dueDate: { gte: today, lte: horizonEnd },
      ...outletScope(outletIds),
    },
    select: { id: true, amount: true, depositAmount: true, status: true, dueDate: true },
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
  const monthlyHistory = await loadMonthlyHistory();
  const cashGeneration = summariseCashGeneration(monthlyHistory, opening.amount);
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
    cashGeneration,
    buckets,
    warnings,
  };
}

// Pull last 12 months of BankStatement period totals, group by calendar
// month of periodStart, and consolidate across accounts. The unique
// (accountName, month) pairs determine `accountsReporting` so the UI
// can flag months with incomplete statement coverage.
async function loadMonthlyHistory(): Promise<CashflowResult["monthlyHistory"]> {
  const since = new Date();
  since.setMonth(since.getMonth() - 12);
  const rows = await prisma.bankStatement.findMany({
    where: {
      periodStart: { not: null, gte: since },
      totalInflows: { not: null },
      totalOutflows: { not: null },
    },
    select: {
      accountName: true, periodStart: true,
      totalInflows: true, totalOutflows: true,
      interCoInflows: true, interCoOutflows: true,
    },
    orderBy: { periodStart: "asc" },
  });

  type Bucket = { cashIn: number; cashOut: number; icoIn: number; icoOut: number; accounts: Set<string> };
  const byMonth = new Map<string, Bucket>();
  for (const r of rows) {
    if (!r.periodStart) continue;
    const key = `${r.periodStart.getFullYear()}-${String(r.periodStart.getMonth() + 1).padStart(2, "0")}`;
    const b = byMonth.get(key) ?? { cashIn: 0, cashOut: 0, icoIn: 0, icoOut: 0, accounts: new Set<string>() };
    b.cashIn += Number(r.totalInflows ?? 0);
    b.cashOut += Number(r.totalOutflows ?? 0);
    if (r.interCoInflows  != null) b.icoIn  += Number(r.interCoInflows);
    if (r.interCoOutflows != null) b.icoOut += Number(r.interCoOutflows);
    b.accounts.add(r.accountName ?? "__default__");
    byMonth.set(key, b);
  }

  return Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, b]) => {
      const adjustedIn  = Math.max(0, b.cashIn  - b.icoIn);
      const adjustedOut = Math.max(0, b.cashOut - b.icoOut);
      return {
        month,
        cashIn: round2(b.cashIn),
        cashOut: round2(b.cashOut),
        interCoInflows: round2(b.icoIn),
        interCoOutflows: round2(b.icoOut),
        netGenerated: round2(adjustedIn - adjustedOut),
        accountsReporting: b.accounts.size,
      };
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
