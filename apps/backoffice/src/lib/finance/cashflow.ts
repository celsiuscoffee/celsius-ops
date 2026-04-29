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
  invoiceOut: number;
  payrollOut: number;
  marketingOut: number;
  recurringOut: number;
  closing: number;
  // Drill-down ids — finance can click to see what's in each bucket.
  invoiceIds: string[];
  recurringExpenseIds: string[];
};

export type CashflowResult = {
  asOf: string;
  weeks: number;
  outletId: string | null;
  openingBalance: { amount: number; statementDate: string | null };
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

// Avg daily sales by day-of-week (0=Sun..6=Sat) from the last 12 weeks.
async function dayOfWeekSalesAverages(outletId: string | null): Promise<number[]> {
  const lookbackStart = new Date(Date.now() - 12 * 7 * DAY_MS);
  const rows = await prisma.salesTransaction.findMany({
    where: {
      transactedAt: { gte: lookbackStart },
      ...(outletId ? { outletId } : {}),
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

async function fetchOpeningBalance(): Promise<{ amount: number; statementDate: string | null }> {
  const latest = await prisma.bankStatement.findFirst({
    orderBy: { statementDate: "desc" },
  });
  if (!latest) return { amount: 0, statementDate: null };
  return {
    amount: Number(latest.closingBalance),
    statementDate: ymd(latest.statementDate),
  };
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
  outletId?: string | null;
}): Promise<CashflowResult> {
  const weeks = Math.max(1, Math.min(26, opts.weeks ?? 8));
  const outletId = opts.outletId ?? null;
  const warnings: string[] = [];

  // Today (local midnight). Buckets start at the next Monday.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const firstMonday = startOfWeek(today);
  const horizonEnd = new Date(firstMonday.getTime() + weeks * 7 * DAY_MS - 1);

  // Opening balance
  const opening = await fetchOpeningBalance();
  if (!opening.statementDate) warnings.push("No bank statement uploaded — opening balance is RM 0.00. Upload one to get a real projection.");

  // Sales forecast — day-of-week averages
  const dowAvg = await dayOfWeekSalesAverages(outletId);
  const dowTotal = dowAvg.reduce((a, b) => a + b, 0);
  if (dowTotal === 0) warnings.push("No StoreHub sales in the last 12 weeks for the selected scope — sales forecast is RM 0.");

  // Outflows — invoices in horizon (full-DB scope; outlet filter applies if set)
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: ["DRAFT", "PENDING", "INITIATED", "DEPOSIT_PAID", "OVERDUE"] },
      dueDate: { gte: today, lte: horizonEnd },
      ...(outletId ? { outletId } : {}),
    },
    select: { id: true, amount: true, depositAmount: true, status: true, dueDate: true },
  });

  // Outflows — recurring (HQ + outlet-tagged that match scope)
  const recurring = await prisma.recurringExpense.findMany({
    where: {
      isActive: true,
      ...(outletId ? { OR: [{ outletId }, { outletId: null }] } : {}),
    },
  });

  // Outflows — payroll + marketing (HQ-level, not outlet-split for v1)
  const payrollProjected = await projectPayroll(today, horizonEnd);
  const marketingProjected = outletId ? [] : await projectMarketing(today, horizonEnd);
  if (outletId && !warnings.some((w) => w.includes("marketing"))) {
    warnings.push("Marketing run-rate is HQ-only and not allocated to outlets — it's excluded from the per-outlet view.");
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

    const closing = runningOpening + salesIn - invoiceOut - payrollOut - marketingOut - recurringOut;

    buckets.push({
      weekStart: ymd(weekStart),
      weekEnd: ymd(weekEnd),
      opening: round2(runningOpening),
      salesIn: round2(salesIn),
      invoiceOut: round2(invoiceOut),
      payrollOut: round2(payrollOut),
      marketingOut: round2(marketingOut),
      recurringOut: round2(recurringOut),
      closing: round2(closing),
      invoiceIds: wkInvoices.map((iv) => iv.id),
      recurringExpenseIds,
    });

    runningOpening = closing;
  }

  return {
    asOf: ymd(today),
    weeks,
    outletId,
    openingBalance: opening,
    buckets,
    warnings,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
