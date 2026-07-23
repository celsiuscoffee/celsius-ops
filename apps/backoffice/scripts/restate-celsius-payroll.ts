// Restate celsius Q2 2026 payroll from cash-basis to the BrioHR accrual.
//
// The GL's salary-accrual (lib/finance/salary-accrual.ts) recognises staff cost
// CASH-BASIS: each month it expenses the delta of the payroll control accounts
// (3004/3005/3006/3008) — whatever salary + statutory CASH cleared the bank.
// Because HR never posted real accrual credits, a pre-cutover control backlog
// (~RM1.26M) bleeds into the monthly P&L, overstating celsius Q2 staff cost by
// RM32,663 vs the BrioHR work-month accrual the sourced/Reports P&L uses
// (people-cost.ts / fin_payroll_actuals).
//
// This posts ONE adjusting journal per month that moves each salary/statutory
// expense account from its current (cash-basis) value to the BrioHR target:
//   6500-02 Full timer staff       -> BrioHR gross salary
//   6501-01 EPF employer           -> BrioHR employer statutory (lump; BrioHR
//                                     does not split EPF/SOCSO/EIS, and the
//                                     sourced P&L shows one statutory line too)
//   6501-02 SOCSO / 6501-03 EIS     -> 0 (folded into the 6501-01 lump)
// The net expense change offsets to the payroll control accounts (salary side to
// 3008, statutory side to 3004), so the timing/backlog difference we are NOT
// expensing stays on the balance sheet in the control accounts — that RM1.26M
// control clean-up is a separate, known task (project_briohr_migration),
// deliberately untouched here. The original cash-basis journals stay POSTED;
// this only layers the adjustment on top (no reversal — buildPnl counts posted
// lines, and reverseTransaction both excludes the original AND posts an offset,
// which would double-subtract).
//
// Idempotent: deterministic posting_key per (company, month), unique-indexed.
// Assumes the three periods are OPEN; re-locks them at the end via runClose.
//
//   cd apps/backoffice && set -a && . ./.env.local && set +a
//   npx tsx scripts/restate-celsius-payroll.ts --dry
//   npx tsx scripts/restate-celsius-payroll.ts --commit

import { createHash } from "node:crypto";
import { getFinanceClient } from "../src/lib/finance/supabase";
import { postJournal } from "../src/lib/finance/ledger";
import { runClose } from "../src/lib/finance/agents/close";
import type { JournalLineInput } from "../src/lib/finance/types";

const COMPANY = "celsius";
const ACTOR = "owner-payroll-restate-2026-07";
const RESTATE_VERSION = "payroll-accrual-restate-v2";
const SALARY_EXPENSE = "6500-02";
const STAT_EXPENSE = ["6501-01", "6501-02", "6501-03"]; // EPF / SOCSO / EIS employer
const SALARY_CONTROL = "3008";
const STAT_CONTROL = "3004";

const MONTHS = [
  { period: "2026-04", first: "2026-04-01", end: "2026-04-30" },
  { period: "2026-05", first: "2026-05-01", end: "2026-05-31" },
  { period: "2026-06", first: "2026-06-01", end: "2026-06-30" },
];

const r2 = (n: number) => Math.round(n * 100) / 100;
function md5Uuid(s: string): string {
  const h = createHash("md5").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// Add a delta to an expense account: +Δ is a debit (more expense), −Δ a credit.
function expLine(code: string, delta: number, period: string): JournalLineInput | null {
  const d = r2(delta);
  if (d === 0) return null;
  return d > 0
    ? { accountCode: code, debit: d, memo: `Payroll accrual adj (BrioHR) — ${period}` }
    : { accountCode: code, credit: -d, memo: `Payroll accrual adj (BrioHR) — ${period}` };
}
// The control offset takes the opposite side to keep the journal balanced.
function ctrlLine(code: string, expenseDelta: number, period: string): JournalLineInput | null {
  const d = r2(expenseDelta);
  if (d === 0) return null;
  return d > 0
    ? { accountCode: code, credit: d, memo: `Payroll control — ${period}` }
    : { accountCode: code, debit: -d, memo: `Payroll control — ${period}` };
}

async function main() {
  const commit = process.argv.includes("--commit");
  const client = getFinanceClient();

  // BrioHR accrual per month (the sourced P&L's people cost).
  const { data: pa } = await client
    .from("fin_payroll_actuals")
    .select("period, salary, employer_stat")
    .eq("company_id", COMPANY)
    .in("period", MONTHS.map((m) => m.first));
  const briohr = new Map<string, { salary: number; stat: number }>();
  for (const r of pa ?? []) {
    const ym = (r.period as string).slice(0, 7);
    const cur = briohr.get(ym) ?? { salary: 0, stat: 0 };
    cur.salary = r2(cur.salary + Number(r.salary ?? 0));
    cur.stat = r2(cur.stat + Number(r.employer_stat ?? 0));
    briohr.set(ym, cur);
  }

  for (const m of MONTHS) {
    const target = briohr.get(m.period);
    if (!target) { console.warn(`  ! no BrioHR figures for ${m.period}`); continue; }

    // Current posted salary/statutory expense for this month.
    const { data: txns } = await client
      .from("fin_transactions").select("id")
      .eq("company_id", COMPANY).eq("status", "posted")
      .gte("txn_date", m.first).lte("txn_date", m.end);
    const ids = (txns ?? []).map((t) => t.id as string);
    const cur: Record<string, number> = {};
    for (let i = 0; i < ids.length; i += 150) {
      const { data: lines } = await client
        .from("fin_journal_lines").select("account_code, debit, credit")
        .in("transaction_id", ids.slice(i, i + 150))
        .in("account_code", [SALARY_EXPENSE, ...STAT_EXPENSE]);
      for (const l of lines ?? []) {
        cur[l.account_code] = r2((cur[l.account_code] ?? 0) + Number(l.debit) - Number(l.credit));
      }
    }
    const curSalary = cur[SALARY_EXPENSE] ?? 0;
    const curStat = STAT_EXPENSE.reduce((s, c) => s + (cur[c] ?? 0), 0);

    // Deltas to reach BrioHR: salary -> gross; 6501-01 -> employer lump; 6501-02/03 -> 0.
    const dSalary = r2(target.salary - curSalary);
    const dEpf = r2(target.stat - (cur["6501-01"] ?? 0));
    const dSocso = r2(0 - (cur["6501-02"] ?? 0));
    const dEis = r2(0 - (cur["6501-03"] ?? 0));
    const dStatTotal = r2(dEpf + dSocso + dEis);

    const lines = [
      expLine(SALARY_EXPENSE, dSalary, m.period),
      expLine("6501-01", dEpf, m.period),
      expLine("6501-02", dSocso, m.period),
      expLine("6501-03", dEis, m.period),
      ctrlLine(SALARY_CONTROL, dSalary, m.period),
      ctrlLine(STAT_CONTROL, dStatTotal, m.period),
    ].filter((l): l is JournalLineInput => l !== null);

    const newSalary = r2(curSalary + dSalary);
    const newStat = r2(curStat + dStatTotal);
    console.log(
      `${m.period}: salary ${curSalary.toFixed(2)}→${newSalary.toFixed(2)} (Δ${dSalary.toFixed(2)}), ` +
      `stat ${curStat.toFixed(2)}→${newStat.toFixed(2)} (Δ${dStatTotal.toFixed(2)}), ` +
      `people ${(newSalary + newStat).toFixed(2)} vs BrioHR ${(target.salary + target.stat).toFixed(2)}`,
    );

    if (!commit) continue;
    const postingKey = md5Uuid(`payroll-restate-v2|${COMPANY}|${m.period}`);
    const { data: exists } = await client.from("fin_transactions").select("id").eq("posting_key", postingKey).limit(1);
    if (exists && exists.length) { console.log(`  SKIP — already posted`); continue; }
    await postJournal({
      companyId: COMPANY, txnDate: m.end,
      description: `Payroll restated to BrioHR accrual — ${m.period} (cash-basis catch-up adjusted to work-month cost)`,
      txnType: "journal", outletId: null, sourceDocId: null, postingKey,
      agent: "manual", agentVersion: RESTATE_VERSION, confidence: 1.0, lines,
    });
    console.log(`  POSTED adjusting journal`);
  }

  // Re-lock (refresh snapshot + close).
  for (const m of MONTHS) {
    if (!commit) { console.log(`DRY re-lock ${m.period}`); continue; }
    const res = await runClose({ companyId: COMPANY, period: m.period, lock: true, actor: ACTOR });
    console.log(`RELOCK ${m.period} — netIncome RM${res.snapshot.pnl.netIncome.toFixed(2)}, expenses RM${res.snapshot.pnl.expenses.toFixed(2)}, locked=${res.locked}`);
  }
  console.log(`\n${commit ? "committed" : "dry-run"} — celsius payroll restated for ${MONTHS.map((m) => m.period).join(", ")}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
