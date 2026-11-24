// Money › Today (owner, 20 Nov 2026: "one list of money decisions — bills to
// pay, bank lines the matcher wasn't sure of, payroll to approve — each with
// its own button"). Modelled on Gosamē Office's Money › Today.
//
// Pure helpers and the response shape of GET /api/finance/today. The page
// only LISTS decisions: every button opens the page where the decision is
// made today, or calls an existing endpoint with its own checks (the bank
// line match). Nothing here pays, approves payroll or touches the ledger
// (CLAUDE.md hard rule 6).

import { formatInboxAmount } from "@/lib/inbox/format";
import type { InboxItem } from "@/lib/inbox/types";

const DAY = 86_400_000;

// ─── Response shape (GET /api/finance/today) ─────────────────────────────

export type BillRow = {
  id: string;
  supplier: string;
  invoiceNumber: string;
  outlet: string;
  dueDate: string;      // YYYY-MM-DD (Malaysia calendar date)
  amountDue: number;    // what is still owed (amount - amountPaid)
  status: string;       // PENDING · OVERDUE · DEPOSIT_PAID · PARTIALLY_PAID
};

export type PayrollRow = {
  id: string;
  cycle: "monthly" | "weekly";
  periodYear: number | null;
  periodMonth: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  net: number;
  gross: number;
  computedAt: string | null;
};

export type MoneyToday = {
  today: string;          // YYYY-MM-DD, Malaysia
  weekEnd: string;        // today + 6 days: "this week" for bills
  bills: BillRow[];       // supplier bills due by weekEnd, late ones included
  claims: InboxItem[];    // payment requests and staff claims waiting (the Inbox's own source)
  payroll: PayrollRow[];  // runs worked out and waiting to be confirmed
  unavailable: string[];  // sources that failed, so the page can say the list may be short
};

// The part of GET /api/finance/ap-match (the Bank inbox's own read) this page uses.
export type BankMatch = {
  invoiceId: string;
  invoiceNumber: string | null;
  payee: string;
  amount: number;
  bankLineId: string;
  bankDesc: string;
  bankDate: string;
  score: number;
  reasons: string[];
  alreadyPaid: boolean;
};
export type BankInboxRead = { review: BankMatch[]; doublePayments: BankMatch[] };

// ─── Dates (Malaysia) ─────────────────────────────────────────────────────

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

/** YYYY-MM-DD plus n days. */
export function addDays(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

/** "Fri 27 Nov" for a calendar date. */
export function dayWords(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC", weekday: "short", day: "numeric", month: "short",
  });
}

/** "Late, due Mon 16 Nov" · "Due today" · "Due tomorrow" · "Due Fri 27 Nov". */
export function dueWords(due: string, today: string): string {
  const d = daysBetween(today, due);
  if (d < 0) return `Late, due ${dayWords(due)}`;
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  return `Due ${dayWords(due)}`;
}

/** "9:41 AM" in Malaysia time. */
export function timeWords(d: Date): string {
  return d.toLocaleTimeString("en-US", { timeZone: "Asia/Kuala_Lumpur", hour: "numeric", minute: "2-digit" });
}

// ─── Money ───────────────────────────────────────────────────────────────

/** RM with two decimals ("RM 1,234.50"), the Inbox's own format. */
export const rm = formatInboxAmount;

/** The cash key number's note, from Overview's cash line ("MAYBANK … 4384 · as of 2026-11-18"). */
export function cashNote(name: string | null | undefined): string {
  const m = name?.match(/as of (\d{4}-\d{2}-\d{2})/);
  return m ? `Bank statement of ${dayWords(m[1])}` : "From the latest bank statement";
}

/** What is still owed on a bill, never below zero, to the sen. */
export function amountDue(amount: number, amountPaid: number | null | undefined): number {
  return Math.max(0, Math.round((amount - (amountPaid ?? 0)) * 100) / 100);
}

// ─── Lists ───────────────────────────────────────────────────────────────

/** Late bills first, then by due date, then the biggest. */
export function sortBills(rows: BillRow[]): BillRow[] {
  return [...rows].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || b.amountDue - a.amountDue);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "November 2026 payroll" · "Part-timers, 9 – 15 Nov". */
export function payrollTitle(r: PayrollRow): string {
  if (r.cycle === "monthly" && r.periodMonth && r.periodYear) return `${MONTHS[r.periodMonth - 1]} ${r.periodYear} payroll`;
  if (r.periodStart && r.periodEnd) {
    const [s, e] = [dayWords(r.periodStart).slice(4), dayWords(r.periodEnd).slice(4)];
    const sameMonth = r.periodStart.slice(0, 7) === r.periodEnd.slice(0, 7);
    return `Part-timers, ${sameMonth ? s.split(" ")[0] : s} – ${e}`;
  }
  return r.cycle === "weekly" ? "Part-timers' weekly payroll" : "Payroll";
}

/** Oldest period first: "2026-11-01" for November, the start date for a week. */
export function payrollPeriodKey(r: PayrollRow): string {
  if (r.periodStart) return r.periodStart;
  return `${r.periodYear ?? 0}-${String(r.periodMonth ?? 0).padStart(2, "0")}-01`;
}

/** Where a run is reviewed and confirmed today (its own page, its own checks). */
export function payrollHref(r: PayrollRow): string {
  return r.cycle === "weekly" ? "/hr/payroll/weekly" : "/hr/payroll";
}

/** Bills open on the Invoices page, filtered to that one invoice. */
export function billHref(b: BillRow): string {
  return `/inventory/invoices?cardFilter=payable&search=${encodeURIComponent(b.invoiceNumber)}`;
}

/** The bank lines to check: unsure matches, biggest first. Double payments stay separate. */
export function bankRowsToCheck(read: BankInboxRead | undefined): BankMatch[] {
  return [...(read?.review ?? [])].sort((a, b) => b.amount - a.amount);
}

// ─── Key numbers ─────────────────────────────────────────────────────────

export type MoneyTodayCounts = {
  billsTotal: number;
  billsCount: number;
  billsLate: number;
  claimsCount: number;
  bankToCheck: number;
  doublePayments: number;
  payrollWaiting: number;
  payrollNet: number;
  waiting: number;          // every decision on the page
};

export function moneyTodayCounts(data: MoneyToday | undefined, bank: BankInboxRead | undefined): MoneyTodayCounts {
  const bills = data?.bills ?? [];
  const today = data?.today ?? "";
  const billsTotal = Math.round(bills.reduce((s, b) => s + b.amountDue, 0) * 100) / 100;
  const billsLate = today ? bills.filter((b) => b.dueDate < today).length : 0;
  const claimsCount = data?.claims.length ?? 0;
  const bankToCheck = bank?.review.length ?? 0;
  const doublePayments = bank?.doublePayments.length ?? 0;
  const payroll = data?.payroll ?? [];
  const payrollNet = Math.round(payroll.reduce((s, r) => s + r.net, 0) * 100) / 100;
  return {
    billsTotal, billsCount: bills.length, billsLate, claimsCount,
    bankToCheck, doublePayments,
    payrollWaiting: payroll.length, payrollNet,
    waiting: bills.length + claimsCount + bankToCheck + doublePayments + payroll.length,
  };
}

/** "3 bills" · "1 bill". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
