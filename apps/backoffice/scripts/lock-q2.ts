// One-shot: refresh + lock the Q2 2026 close for all three entities.
//
// Q2 = 2026-04, 2026-05, 2026-06. The close already ran unlocked; since then
// the discount GL repost posted month-end journals into May/June (and April),
// so the stored P&L/BS snapshots are stale. runClose(lock:true) re-runs the
// close steps — all idempotent (depreciation posts nothing outside December;
// mgmt-fee / Grab-clearing / AP-accrual each skip if already posted) — then
// re-snapshots against the current GL and flips fin_periods.status to 'closed',
// which the DB trigger uses to block further posting.
//
// Usage:
//   cd apps/backoffice
//   set -a && . ./.env.local && set +a
//   npx tsx scripts/lock-q2.ts --dry     # show what would lock
//   npx tsx scripts/lock-q2.ts --commit  # refresh snapshot + lock

import { runClose } from "../src/lib/finance/agents/close";
import { getFinanceClient } from "../src/lib/finance/supabase";

const COMPANIES = ["celsius", "celsiusconezion", "celsiustamarind"];
const PERIODS = ["2026-04", "2026-05", "2026-06"];
const ACTOR = "owner-q2-close";

async function main() {
  const commit = process.argv.includes("--commit");
  const client = getFinanceClient();

  const { data: before } = await client
    .from("fin_periods")
    .select("company_id, period, status")
    .in("company_id", COMPANIES)
    .in("period", PERIODS);
  const statusOf = new Map((before ?? []).map((r) => [`${r.company_id}|${r.period}`, r.status as string]));

  for (const period of PERIODS) {
    for (const companyId of COMPANIES) {
      const key = `${companyId}|${period}`;
      const cur = statusOf.get(key) ?? "(none)";
      if (cur === "closed") {
        console.log(`SKIP ${key} — already closed`);
        continue;
      }
      if (!commit) {
        console.log(`DRY  ${key} — status ${cur} → would refresh snapshot + lock`);
        continue;
      }
      const r = await runClose({ companyId, period, lock: true, actor: ACTOR });
      const ni = r.snapshot.pnl.netIncome;
      const disc = r.snapshot.pnl.byCode["5001"] ?? 0;
      console.log(
        `LOCK ${key} — netIncome RM${ni.toFixed(2)}, 5001 RM${disc.toFixed(2)}` +
          `, mgmtFee ${r.mgmtFee.skipped ?? "posted"}, grab ${r.grabClearing.skipped ?? "posted"}` +
          `, apAccrual ${r.apAccrual.skipped ?? "posted"}, locked=${r.locked}`,
      );
    }
  }
  console.log(`\n${commit ? "committed" : "dry-run"}: Q2 = ${PERIODS.join(", ")} × ${COMPANIES.length} entities`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
