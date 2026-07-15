// AP accrual — brings the operational Invoice subledger into the GL.
//
// The Prisma `Invoice` table is the live AP register (procurement), but it never
// posts to the ledger, so the GL shows ~zero payables and supplier spend hits
// the P&L cash-basis (when the bank pays) rather than when the goods are
// received. This posts a REVERSING accrual at each period end:
//   - recognise open payables as of period end: Dr expense / Cr 3001 A/P
//   - reverse it on the first day of the next period.
// Net effect:
//   • the period's P&L carries the expense of goods received-but-unpaid (accrual)
//   • the period-end Balance Sheet shows 3001 = open payables, tying to Aged
//     Payables (same Invoice source, same filter), and
//   • because it reverses, the cash-basis bank payment that settles the bill next
//     period does NOT double-count — the reversal offsets it. Over the lifecycle
//     the expense lands in the period the bill was incurred, once.
// One accrual + one reversal per (company, period), idempotent by txn_type+date.
// This is the standard month-end AP cutoff, mirroring the mgmt-fee accrual in
// the close agent — no change to the live cash-basis bank poster.

import { prisma } from "@/lib/prisma";
import { getFinanceClient } from "./supabase";
import { postJournal } from "./ledger";
import type { JournalLineInput } from "./types";

export const AP_ACCRUAL_VERSION = "ap-accrual-v1";
const AP_CONTROL = "3001"; // Accounts Payable (liability)

// Invoice.expenseCategory → P&L account. INGREDIENT (COGS raw materials,
// 6000-01) is ~all of open AP; the rest are minor. Unknown falls back to COGS.
// Because the accrual reverses next period and the real cash payment lands in
// the right account via the bank poster, this split only shapes the period-end
// cutoff, never the permanent expense classification.
const EXPENSE_ACCOUNT: Record<string, string> = {
  INGREDIENT: "6000-01",
  MAINTENANCE: "6506",
  ASSET: "6507",
  OTHER: "6507",
};
const DEFAULT_EXPENSE = "6000-01";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type ApAccrual = {
  companyId: string;
  asOf: string;
  total: number; // ties to Aged Payables grandTotal at asOf
  invoiceCount: number;
  byAccount: { account: string; amount: number }[];
};

// Open payables as of a date, grouped by expense account. Uses the SAME filter
// as buildAgedPayables (status not PAID/DRAFT, issueDate <= asOf, outstanding =
// amount - amountPaid) so the accrual total ties to the aging report exactly.
export async function buildApAccrual(companyId: string, asOf: string): Promise<ApAccrual> {
  const client = getFinanceClient();
  const { data: oc } = await client
    .from("fin_outlet_companies")
    .select("outlet_id")
    .eq("company_id", companyId);
  const outletIds = (oc ?? []).map((r) => r.outlet_id as string);
  if (!outletIds.length) return { companyId, asOf, total: 0, invoiceCount: 0, byAccount: [] };

  const asOfDate = new Date(`${asOf}T23:59:59Z`);
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { notIn: ["PAID", "DRAFT"] },
      outletId: { in: outletIds },
      issueDate: { lte: asOfDate },
    },
    select: { amount: true, amountPaid: true, expenseCategory: true },
  });

  const byAcc = new Map<string, number>();
  let total = 0;
  let count = 0;
  for (const inv of invoices) {
    const outstanding = round2(Number(inv.amount) - Number(inv.amountPaid ?? 0));
    if (outstanding <= 0.005) continue;
    const acc = EXPENSE_ACCOUNT[inv.expenseCategory ?? ""] ?? DEFAULT_EXPENSE;
    byAcc.set(acc, round2((byAcc.get(acc) ?? 0) + outstanding));
    total = round2(total + outstanding);
    count++;
  }
  const byAccount = [...byAcc.entries()]
    .map(([account, amount]) => ({ account, amount }))
    .sort((a, b) => b.amount - a.amount);
  return { companyId, asOf, total, invoiceCount: count, byAccount };
}

export type PostApAccrualResult = {
  companyId: string;
  period: string;
  accrued: number;
  invoiceCount: number;
  accrualTxnId: string | null;
  reversalTxnId: string | null;
  skipped: string | null;
};

// Post the reversing accrual for a period (YYYY-MM): accrual on the period's
// last day, reversal on the next period's first day. Idempotent per (company,
// txn_type, date). Mirrors postMgmtFeeShortfall in the close agent.
export async function postApAccrual(
  companyId: string,
  period: string,
  opts: { dryRun?: boolean } = {}
): Promise<PostApAccrualResult> {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error(`Invalid period format: ${period}`);
  const [year, month] = period.split("-").map(Number);
  const accrualDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10); // last day of period
  const reversalDate = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10); // first day of next period

  const accr = await buildApAccrual(companyId, accrualDate);
  const base = { companyId, period, accrued: 0, invoiceCount: accr.invoiceCount, accrualTxnId: null, reversalTxnId: null } as const;
  if (accr.total <= 0.005) return { ...base, skipped: "no open payables" };

  const client = getFinanceClient();
  const existingId = async (txnType: string, date: string): Promise<string | null> => {
    const { data } = await client
      .from("fin_transactions")
      .select("id")
      .eq("company_id", companyId)
      .eq("txn_type", txnType)
      .eq("txn_date", date)
      .limit(1);
    return data && data.length ? (data[0].id as string) : null;
  };

  const already = await existingId("ap_accrual", accrualDate);
  if (already) {
    return { ...base, accrualTxnId: already, reversalTxnId: await existingId("ap_accrual_reversal", reversalDate), skipped: "already accrued" };
  }
  if (opts.dryRun) return { ...base, accrued: accr.total, skipped: "dry-run" };

  // Accrual: Dr expense(s) / Cr 3001 A/P (control not outlet-scoped).
  const accrualLines: JournalLineInput[] = [
    ...accr.byAccount.map((b) => ({ accountCode: b.account, outletId: null, debit: b.amount, memo: `AP accrual ${period}` })),
    { accountCode: AP_CONTROL, outletId: null, credit: accr.total, memo: `Open payables ${accrualDate} (${accr.invoiceCount} bills)` },
  ];
  const accrual = await postJournal({
    companyId,
    txnDate: accrualDate,
    description: `AP accrual ${period} (open supplier bills)`,
    txnType: "ap_accrual",
    outletId: null,
    sourceDocId: null,
    agent: "close",
    agentVersion: AP_ACCRUAL_VERSION,
    confidence: 1.0,
    lines: accrualLines,
  });

  // Reversal: Dr 3001 / Cr expense(s), first day of the next period.
  const reversalLines: JournalLineInput[] = [
    { accountCode: AP_CONTROL, outletId: null, debit: accr.total, memo: `Reverse AP accrual ${period}` },
    ...accr.byAccount.map((b) => ({ accountCode: b.account, outletId: null, credit: b.amount, memo: `Reverse AP accrual ${period}` })),
  ];
  const reversal = await postJournal({
    companyId,
    txnDate: reversalDate,
    description: `AP accrual reversal ${period}`,
    txnType: "ap_accrual_reversal",
    outletId: null,
    sourceDocId: null,
    agent: "close",
    agentVersion: AP_ACCRUAL_VERSION,
    confidence: 1.0,
    lines: reversalLines,
  });

  return { companyId, period, accrued: accr.total, invoiceCount: accr.invoiceCount, accrualTxnId: accrual.transactionId, reversalTxnId: reversal.transactionId, skipped: null };
}
