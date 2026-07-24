// celsius GL payroll += Shafiq's other two-thirds for Q2 (owner: Shafiq under
// Shah Alam only). celsius GL people cost was reconciled to its BrioHR accrual
// (scripts/restate-celsius-payroll.ts); fin_payroll_actuals now carries Shafiq's
// full cost on the Shah Alam line, so celsius's accrual target rose by his ⅔
// (RM2,333.33 salary + RM348.17 employer statutory per month). This layers that
// increase on: Dr 6500-02 + Dr 6501-01 / Cr 3008 + Cr 3004 (control), matching
// how the accrual restatement books it. conezion/tamarind GL is intentionally
// left unchanged (owner chose the minimal scope; Shafiq's split lived only in
// the allocation, never in their GL cash).
//
//   cd apps/backoffice && set -a && . ./.env.local && set +a
//   npx tsx scripts/celsius-shafiq-gl.ts --dry|--commit

import { createHash } from "node:crypto";
import { getFinanceClient } from "../src/lib/finance/supabase";
import { postJournal } from "../src/lib/finance/ledger";
import { runClose } from "../src/lib/finance/agents/close";
import type { JournalLineInput } from "../src/lib/finance/types";

const COMPANY = "celsius";
const ACTOR = "owner-shafiq-sa-2026-07";
const VERSION = "celsius-shafiq-sa-v1";
const SAL = 2333.33, STAT = 348.17; // Shafiq's ⅔, per month
const MONTHS = [
  { period: "2026-04", end: "2026-04-30" },
  { period: "2026-05", end: "2026-05-31" },
  { period: "2026-06", end: "2026-06-30" },
];
function md5Uuid(s: string): string {
  const h = createHash("md5").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

async function main() {
  const commit = process.argv.includes("--commit");
  const client = getFinanceClient();
  for (const m of MONTHS) {
    const lines: JournalLineInput[] = [
      { accountCode: "6500-02", debit: SAL, memo: `Shafiq → Shah Alam (⅔ reallocation) — ${m.period}` },
      { accountCode: "6501-01", debit: STAT, memo: `Shafiq statutory → Shah Alam — ${m.period}` },
      { accountCode: "3008", credit: SAL, memo: `Salary control — ${m.period}` },
      { accountCode: "3004", credit: STAT, memo: `Statutory control — ${m.period}` },
    ];
    console.log(`${m.period}: celsius people +${(SAL + STAT).toFixed(2)} (Shafiq ⅔)`);
    if (!commit) continue;
    const postingKey = md5Uuid(`celsius-shafiq|${m.period}`);
    const { data: exists } = await client.from("fin_transactions").select("id").eq("posting_key", postingKey).limit(1);
    if (exists && exists.length) { console.log("  SKIP — already posted"); continue; }
    await postJournal({
      companyId: COMPANY, txnDate: m.end,
      description: `Shafiq reallocated to Shah Alam (⅔) — ${m.period}`,
      txnType: "journal", outletId: null, sourceDocId: null, postingKey,
      agent: "manual", agentVersion: VERSION, confidence: 1.0, lines,
    });
    console.log("  POSTED");
  }
  for (const m of MONTHS) {
    if (!commit) continue;
    const res = await runClose({ companyId: COMPANY, period: m.period, lock: true, actor: ACTOR });
    console.log(`RELOCK celsius ${m.period} — netIncome RM${res.snapshot.pnl.netIncome.toFixed(2)}, expenses RM${res.snapshot.pnl.expenses.toFixed(2)}`);
  }
  console.log(`\n${commit ? "committed" : "dry-run"} — celsius Shafiq ⅔ GL bump`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
