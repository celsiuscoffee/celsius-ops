// Salary-control accrual — the credit side of the payroll control accounts.
//
// The bank→GL bridge books every payroll cash movement as a DEBIT on a control
// account (3008 net salary, 3004 EPF, 3005 SOCSO, 3006 EIS, 3007 PCB), the way
// Bukku does — the payment settles a liability the payroll run accrued. But the
// HR payroll module isn't producing real accruals yet, so the controls carried
// a growing debit balance (RM1.26M by Jul 2026) and the Balance Sheet misread.
//
// Until HR accruals are live, expense is recognised CASH-BASIS in the month
// paid: per company × month, whatever DEBIT excess sits on a control account is
// cleared against its expense account —
//
//   3008 net salary  →  6500-02 Full timer staff
//   3007 PCB         →  6500-02 (employee tax withheld = part of gross salary)
//   3004 EPF         →  6501-01 EPF — Employer's Contribution
//   3005 SOCSO       →  6501-02 SOCSO — Employer's Contribution
//   3006 EIS         →  6501-03 EIS — Employer's Contribution
//
// (The statutory payments mix employer + employee portions in one transfer, so
// the salary/statutory split is approximate — total staff cost is exact.)
//
// SELF-RECONCILING: each run recomputes delta = debits − credits per control
// per month, and posts only the positive remainder. Re-runs post nothing; new
// bank payments create a fresh delta that the next run tops up; and once the HR
// payroll agent posts real accruals (credits), the delta collapses to zero and
// this becomes a no-op. Part-timer wages are untouched — they post straight to
// expense 6500-03 (cash basis by design).

import { getFinanceClient } from "./supabase";
import { postJournal } from "./ledger";
import { GL_POSTING_CUTOVER } from "./gl-posting-map";
import type { JournalLineInput } from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;

const CONTROL_TO_EXPENSE: Record<string, string> = {
  "3008": "6500-02",
  "3007": "6500-02",
  "3004": "6501-01",
  "3005": "6501-02",
  "3006": "6501-03",
};
const CONTROL_ACCOUNTS = Object.keys(CONTROL_TO_EXPENSE);

export type SalaryAccrualResult = {
  committed: boolean;
  journals: number;
  totalAccrued: number;
  months: { company: string; month: string; amount: number; byControl: Record<string, number> }[];
  errors: { company: string; month: string; error: string }[];
};

function monthEndYmd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// Accrue the outstanding control-account deltas. Dry-run by default.
export async function accrueSalaryControls(opts: { commit?: boolean } = {}): Promise<SalaryAccrualResult> {
  const commit = opts.commit ?? false;
  const client = getFinanceClient();

  // All posted movements on the control accounts, keyed company|month|account.
  type Row = { account_code: string; debit: number; credit: number; fin_transactions: { company_id: string; txn_date: string } };
  const agg = new Map<string, { d: number; c: number }>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("fin_journal_lines")
      .select("account_code, debit, credit, fin_transactions!inner(company_id, txn_date, status)")
      .in("account_code", CONTROL_ACCOUNTS)
      .eq("fin_transactions.status", "posted")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as unknown as Row[]) {
      const month = r.fin_transactions.txn_date.slice(0, 7);
      const key = `${r.fin_transactions.company_id}|${month}|${r.account_code}`;
      const cur = agg.get(key) ?? { d: 0, c: 0 };
      cur.d = round2(cur.d + Number(r.debit));
      cur.c = round2(cur.c + Number(r.credit));
      agg.set(key, cur);
    }
    if (!data || data.length < PAGE) break;
  }

  // Positive deltas per company|month.
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10); // MYT
  const currentMonth = today.slice(0, 7);
  const cutoverMonth = GL_POSTING_CUTOVER.slice(0, 7);
  const byMonth = new Map<string, Record<string, number>>();
  for (const [key, v] of agg) {
    const delta = round2(v.d - v.c);
    if (delta <= 0.005) continue;
    const [company, month, account] = key.split("|");
    if (month > currentMonth) continue;
    if (month < cutoverMonth) continue; // pre-cutover months belong to Bukku; never accrue into them

    const mk = `${company}|${month}`;
    const rec = byMonth.get(mk) ?? {};
    rec[account] = delta;
    byMonth.set(mk, rec);
  }

  const months: SalaryAccrualResult["months"] = [];
  const errors: SalaryAccrualResult["errors"] = [];
  let journals = 0;
  let totalAccrued = 0;

  for (const [mk, byControl] of [...byMonth.entries()].sort()) {
    const [company, month] = mk.split("|");
    // Dr per expense account (3008+3007 merge into 6500-02), Cr per control.
    const drByExpense = new Map<string, number>();
    const lines: JournalLineInput[] = [];
    let total = 0;
    for (const [control, delta] of Object.entries(byControl)) {
      const exp = CONTROL_TO_EXPENSE[control];
      drByExpense.set(exp, round2((drByExpense.get(exp) ?? 0) + delta));
      lines.push({ accountCode: control, credit: delta });
      total = round2(total + delta);
    }
    for (const [exp, amt] of drByExpense) lines.unshift({ accountCode: exp, debit: amt });

    months.push({ company, month, amount: total, byControl });
    journals++;
    totalAccrued = round2(totalAccrued + total);
    if (!commit) continue;

    try {
      await postJournal({
        companyId: company,
        txnDate: month === currentMonth ? today : monthEndYmd(month),
        description: `Salary accrual (cash-basis catch-up) — staff cost paid in ${month} recognised as expense, clearing the payroll control accounts`,
        txnType: "journal",
        agent: "payroll",
        agentVersion: "salary-accrual-v1",
        confidence: 1,
        lines,
      });
    } catch (err) {
      errors.push({ company, month, error: err instanceof Error ? err.message : String(err) });
      journals--;
      totalAccrued = round2(totalAccrued - total);
      months.pop();
    }
  }

  return { committed: commit, journals, totalAccrued, months, errors };
}
