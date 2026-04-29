import { prisma } from "@/lib/prisma";

// Cashflow projection compute. Pure-function-ish: takes a horizon and an
// optional outletId, returns weekly buckets with the breakdown that the
// dashboard renders.
//
// Inputs (all read at request time, no side effects):
//   - Opening balance: latest BankStatement.closingBalance.
//   - Sales forecast: day-of-week average over the last 12 weeks of
//     SalesTransaction (per outlet if filtered, else all), projected forward.
//   - Invoice outflows: unpaid Invoice rows with dueDate in horizon.
//   - Payroll: avg of the last 3 paid hr_payroll_runs, projected once per
//     month on the cycle's payday (or 25th-of-month fallback).
//   - Marketing: avg of the last 3 ads_invoice totals, projected once per
//     month on (or near) the issue_date day-of-month.
//   - RecurringExpense: walked forward by cadence from nextDueDate.
//
// Sales forecast scope: when outletId is null we sum all outlets; otherwise
// we filter both the historical lookback and the projection to that outlet.
// Payroll/marketing run-rates stay HQ-level — they're not split per outlet
// in the source data.

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

  // Sales forecast — day-of-week averages
  const dowAvg = await dayOfWeekSalesAverages(outletIds);
  const dowTotal = dowAvg.reduce((a, b) => a + b, 0);
  if (dowTotal === 0) warnings.push("No StoreHub sales in the last 12 weeks for the selected scope — sales forecast is RM 0.");

  // Outflows — invoices in horizon (full-DB scope; outlet filter applies if set)
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: ["DRAFT", "PENDING", "INITIATED", "DEPOSIT_PAID", "OVERDUE"] },
      dueDate: { gte: today, lte: horizonEnd },
      ...outletScope(outletIds),
    },
    select: { id: true, amount: true, depositAmount: true, status: true, dueDate: true },
  });

  // Outflows — recurring (HQ + outlet-tagged that match scope)
  const recurring = await prisma.recurringExpense.findMany({
    where: {
      isActive: true,
      ...(isFiltered
        ? { OR: [{ outletId: outletIds.length === 1 ? outletIds[0] : { in: outletIds } }, { outletId: null }] }
        : {}),
    },
  });

  // Outflows — payroll + marketing (HQ-level, not outlet-split for v1)
  const payrollProjected = await projectPayroll(today, horizonEnd);
  const marketingProjected = isFiltered ? [] : await projectMarketing(today, horizonEnd);
  if (isFiltered) {
    warnings.push("Marketing run-rate is HQ-only and not allocated to outlets — it's excluded from the filtered view.");
  }

  // Hybrid residual — bank flows per day minus what the synthetic streams
  // would already cover. Only applies in "all outlets" mode since
  // BankStatement isn't outlet-tagged.
  const bankFlows = isFiltered ? null : await bankFlowsPerDay();
  if (!isFiltered && !bankFlows) {
    warnings.push("Bank statement period totals not yet uploaded — \"Other (bank)\" residual is RM 0. Upload a CSV/Excel statement to see the gap between bank actuals and the synthetic forecast.");
  }
  let otherInPerDay = 0;
  let otherOutPerDay = 0;
  if (bankFlows) {
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

    // Recurring this week
    let recurringOut = 0;
    const recurringExpenseIds: string[] = [];
    for (const exp of recurring) {
      const occurrences = expandRecurring(
        { id: exp.id, amount: Number(exp.amount), cadence: exp.cadence, nextDueDate: exp.nextDueDate },
        weekStart,
        weekEnd,
      );
      for (const occ of occurrences) {
        recurringOut += occ.amount;
        if (!recurringExpenseIds.includes(occ.recurringExpenseId)) recurringExpenseIds.push(occ.recurringExpenseId);
      }
    }

    // Other (bank residual) — count days in the week that are >= today, since
    // partial first weeks shouldn't include past days.
    let activeDays = 0;
    for (let d = 0; d < 7; d++) {
      const day = new Date(weekStart.getTime() + d * DAY_MS);
      if (day >= today) activeDays++;
    }
    const otherIn = otherInPerDay * activeDays;
    const otherOut = otherOutPerDay * activeDays;

    const closing = runningOpening + salesIn + otherIn - invoiceOut - payrollOut - marketingOut - recurringOut - otherOut;

    buckets.push({
      weekStart: ymd(weekStart),
      weekEnd: ymd(weekEnd),
      opening: round2(runningOpening),
      salesIn: round2(salesIn),
      otherIn: round2(otherIn),
      invoiceOut: round2(invoiceOut),
      payrollOut: round2(payrollOut),
      marketingOut: round2(marketingOut),
      recurringOut: round2(recurringOut),
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
    bankFlowsPerDay: bankFlows
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
