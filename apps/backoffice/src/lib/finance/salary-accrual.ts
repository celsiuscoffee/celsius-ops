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
// SELF-RECONCILING, BOTH WAYS: each run recomputes, per control per month,
//
//   required = max(0, debits − credits)   ignoring this agent's own journals
//   own      = what this agent has already posted for that month (net)
//   diff     = required − own
//
// diff > 0 tops up (Dr expense / Cr control, as before); diff < 0 posts a
// correction (Dr control / Cr expense) so an over-accrual — a payment later
// reversed or re-dated, a duplicate bank line that was folded, or the HR
// payroll agent starting to post real accruals for a month this agent already
// filled cash-basis — is unwound instead of sitting on the books forever
// (2026-09-25 QA, M13). Re-runs post nothing. Own journals are excluded from
// `required` so a real accrual posted by HR for month M is never mistaken for
// an over-accrual and reversed. Part-timer wages are untouched — they post
// straight to expense 6500-03 (cash basis by design).

import { getFinanceClient } from "./supabase";
import { postJournal } from "./ledger";
import { GL_POSTING_CUTOVER } from "./gl-posting-map";
import type { JournalLineInput } from "./types";
import { todayMyt } from "@/lib/inventory/myt-date";

const round2 = (n: number) => Math.round(n * 100) / 100;

const CONTROL_TO_EXPENSE: Record<string, string> = {
  "3008": "6500-02",
  "3007": "6500-02",
  "3004": "6501-01",
  "3005": "6501-02",
  "3006": "6501-03",
};
const CONTROL_ACCOUNTS = Object.keys(CONTROL_TO_EXPENSE);

export const SALARY_ACCRUAL_AGENT = "payroll";
export const SALARY_ACCRUAL_VERSION = "salary-accrual-v1";
// Anything this module has ever posted, top-up or correction, is "own".
const OWN_VERSION_PREFIX = "salary-accrual-";

export type SalaryAccrualResult = {
  committed: boolean;
  journals: number;
  /** Net amount posted: top-ups positive, corrections negative. */
  totalAccrued: number;
  months: SalaryAccrualPlan[];
  errors: { company: string; month: string; error: string }[];
};

/** One journal to post: signed per-control diffs (Cr when positive, Dr when negative). */
export type SalaryAccrualPlan = {
  company: string;
  month: string;
  txnDate: string;
  /** Net of byControl. */
  amount: number;
  byControl: Record<string, number>;
  /** True when at least one control is being reversed rather than topped up. */
  correction: boolean;
  lines: JournalLineInput[];
};

/** A posted journal line on a control account, as read from the ledger. */
export type ControlLine = {
  account_code: string;
  debit: number;
  credit: number;
  company_id: string;
  txn_date: string;
  agent_version: string | null;
};

function monthEndYmd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * Pure planner: which journals a run should post given every posted control
 * line. Exported for tests; `accrueSalaryControls` feeds it the live ledger.
 */
export function planSalaryAccruals(
  rows: ControlLine[],
  opts: { today: string; cutoverMonth: string },
): SalaryAccrualPlan[] {
  const currentMonth = opts.today.slice(0, 7);
  type Agg = { d: number; c: number; ownD: number; ownC: number };
  const agg = new Map<string, Agg>();
  for (const r of rows) {
    if (!CONTROL_ACCOUNTS.includes(r.account_code)) continue;
    const month = r.txn_date.slice(0, 7);
    const key = `${r.company_id}|${month}|${r.account_code}`;
    const cur = agg.get(key) ?? { d: 0, c: 0, ownD: 0, ownC: 0 };
    const own = (r.agent_version ?? "").startsWith(OWN_VERSION_PREFIX);
    if (own) {
      cur.ownD = round2(cur.ownD + Number(r.debit));
      cur.ownC = round2(cur.ownC + Number(r.credit));
    } else {
      cur.d = round2(cur.d + Number(r.debit));
      cur.c = round2(cur.c + Number(r.credit));
    }
    agg.set(key, cur);
  }

  const byMonth = new Map<string, Record<string, number>>();
  for (const [key, v] of agg) {
    const required = Math.max(0, round2(v.d - v.c));
    const own = round2(v.ownC - v.ownD);
    const diff = round2(required - own);
    if (Math.abs(diff) <= 0.005) continue;
    const [company, month, account] = key.split("|");
    if (month > currentMonth) continue;
    if (month < opts.cutoverMonth) continue; // pre-cutover months belong to Bukku; never accrue into them

    const mk = `${company}|${month}`;
    const rec = byMonth.get(mk) ?? {};
    rec[account] = diff;
    byMonth.set(mk, rec);
  }

  const plans: SalaryAccrualPlan[] = [];
  for (const [mk, byControl] of [...byMonth.entries()].sort()) {
    const [company, month] = mk.split("|");
    // Per control: Cr when topping up, Dr when correcting. Expense side is the
    // signed net per expense account (3008 + 3007 both land on 6500-02).
    const netByExpense = new Map<string, number>();
    const lines: JournalLineInput[] = [];
    let total = 0;
    let correction = false;
    for (const [control, diff] of Object.entries(byControl)) {
      const exp = CONTROL_TO_EXPENSE[control];
      netByExpense.set(exp, round2((netByExpense.get(exp) ?? 0) + diff));
      if (diff > 0) lines.push({ accountCode: control, credit: diff });
      else {
        lines.push({ accountCode: control, debit: round2(-diff) });
        correction = true;
      }
      total = round2(total + diff);
    }
    for (const [exp, net] of netByExpense) {
      if (Math.abs(net) <= 0.005) continue;
      lines.unshift(net > 0 ? { accountCode: exp, debit: net } : { accountCode: exp, credit: round2(-net) });
    }
    plans.push({
      company,
      month,
      txnDate: month === currentMonth ? opts.today : monthEndYmd(month),
      amount: total,
      byControl,
      correction,
      lines,
    });
  }
  return plans;
}

// Accrue the outstanding control-account deltas. Dry-run by default.
export async function accrueSalaryControls(opts: { commit?: boolean } = {}): Promise<SalaryAccrualResult> {
  const commit = opts.commit ?? false;
  const client = getFinanceClient();

  // All posted movements on the control accounts.
  type Row = {
    account_code: string;
    debit: number;
    credit: number;
    fin_transactions: { company_id: string; txn_date: string; agent_version: string | null };
  };
  const rows: ControlLine[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("fin_journal_lines")
      .select("account_code, debit, credit, fin_transactions!inner(company_id, txn_date, status, agent_version)")
      .in("account_code", CONTROL_ACCOUNTS)
      .eq("fin_transactions.status", "posted")
      // .range() without ORDER BY is not a stable page walk: Postgres may hand
      // back overlapping or missing rows between pages, which silently
      // over- or under-states the control-account delta being accrued.
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as unknown as Row[]) {
      rows.push({
        account_code: r.account_code,
        debit: Number(r.debit),
        credit: Number(r.credit),
        company_id: r.fin_transactions.company_id,
        txn_date: r.fin_transactions.txn_date,
        agent_version: r.fin_transactions.agent_version,
      });
    }
    if (!data || data.length < PAGE) break;
  }

  const plans = planSalaryAccruals(rows, { today: todayMyt(), cutoverMonth: GL_POSTING_CUTOVER.slice(0, 7) });

  const months: SalaryAccrualPlan[] = [];
  const errors: SalaryAccrualResult["errors"] = [];
  let totalAccrued = 0;

  for (const plan of plans) {
    if (commit) {
      try {
        await postJournal({
          companyId: plan.company,
          txnDate: plan.txnDate,
          description: plan.correction
            ? `Salary accrual correction — payroll control accounts for ${plan.month} were over-accrued (payment reversed, re-dated or now accrued by HR); unwinding the excess`
            : `Salary accrual (cash-basis catch-up) — staff cost paid in ${plan.month} recognised as expense, clearing the payroll control accounts`,
          txnType: "journal",
          agent: SALARY_ACCRUAL_AGENT,
          agentVersion: SALARY_ACCRUAL_VERSION,
          confidence: 1,
          lines: plan.lines,
        });
      } catch (err) {
        errors.push({ company: plan.company, month: plan.month, error: err instanceof Error ? err.message : String(err) });
        continue;
      }
    }
    months.push(plan);
    totalAccrued = round2(totalAccrued + plan.amount);
  }

  return { committed: commit, journals: months.length, totalAccrued, months, errors };
}
