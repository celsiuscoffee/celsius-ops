// Restore the Q2 COGS→consumption GL restatement that was mistakenly reverted,
// FROZEN at the original close values (conezion 152,774 etc.) — NOT a live
// buildByCategory recompute (which has since drifted to ~150,980). These are the
// exact 9 adjusting journals that scripts/restate-q2-cogs.ts posted and that the
// revert deleted: each moves 6000-01 (COGS) to the frozen consumption figure and
// offsets the purchase-vs-consumption difference to Inventory 1002.
//
//   cd apps/backoffice && set -a && . ./.env.local && set +a
//   npx tsx scripts/restore-q2-cogs.ts --dry|--commit

import { createHash } from "node:crypto";
import { getFinanceClient } from "../src/lib/finance/supabase";
import { postJournal } from "../src/lib/finance/ledger";
import { runClose } from "../src/lib/finance/agents/close";
import type { JournalLineInput } from "../src/lib/finance/types";

const COGS = "6000-01", INV = "1002";
const ACTOR = "owner-q2-cogs-restore-2026-07";
const VERSION = "q2-cogs-consumption-v1"; // same as the original, so it reads back identically

// signed COGS delta per (company, period): +ve raises COGS (drawdown, Cr 1002),
// −ve lowers COGS (stock build, Dr 1002). Exactly the amounts that were reverted.
const DELTAS: { company: string; period: string; end: string; cogsDelta: number }[] = [
  { company: "celsius", period: "2026-04", end: "2026-04-30", cogsDelta: 27889.61 },
  { company: "celsius", period: "2026-05", end: "2026-05-31", cogsDelta: -4224.04 },
  { company: "celsius", period: "2026-06", end: "2026-06-30", cogsDelta: -16928.68 },
  { company: "celsiusconezion", period: "2026-04", end: "2026-04-30", cogsDelta: -7418.89 },
  { company: "celsiusconezion", period: "2026-05", end: "2026-05-31", cogsDelta: -7163.18 },
  { company: "celsiusconezion", period: "2026-06", end: "2026-06-30", cogsDelta: -8881.03 },
  { company: "celsiustamarind", period: "2026-04", end: "2026-04-30", cogsDelta: -5596.60 },
  { company: "celsiustamarind", period: "2026-05", end: "2026-05-31", cogsDelta: -7674.10 },
  { company: "celsiustamarind", period: "2026-06", end: "2026-06-30", cogsDelta: -4331.38 },
];

function md5Uuid(s: string): string {
  const h = createHash("md5").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

async function main() {
  const commit = process.argv.includes("--commit");
  const client = getFinanceClient();
  for (const d of DELTAS) {
    const lines: JournalLineInput[] = d.cogsDelta > 0
      ? [{ accountCode: COGS, debit: d.cogsDelta, memo: `COGS to consumption basis — ${d.period}` },
         { accountCode: INV, credit: d.cogsDelta, memo: `Inventory drawn down — ${d.period}` }]
      : [{ accountCode: COGS, credit: -d.cogsDelta, memo: `COGS to consumption basis — ${d.period}` },
         { accountCode: INV, debit: -d.cogsDelta, memo: `Stock build capitalised — ${d.period}` }];
    console.log(`${d.company.padEnd(16)} ${d.period}  COGS Δ${d.cogsDelta.toFixed(2)}`);
    if (!commit) continue;
    const postingKey = md5Uuid(`q2-cogs|${d.company}|${d.period}`);
    const { data: exists } = await client.from("fin_transactions").select("id").eq("posting_key", postingKey).limit(1);
    if (exists && exists.length) { console.log("  SKIP — already posted"); continue; }
    await postJournal({
      companyId: d.company, txnDate: d.end,
      description: `Q2 COGS to consumption basis — ${d.period} (purchase/consumption difference to Inventory 1002)`,
      txnType: "journal", outletId: null, sourceDocId: null, postingKey,
      agent: "manual", agentVersion: VERSION, confidence: 1.0, lines,
    });
    console.log("  POSTED");
  }
  const ENT = ["celsius", "celsiusconezion", "celsiustamarind"];
  const PER = ["2026-04", "2026-05", "2026-06"];
  for (const c of ENT) for (const p of PER) {
    if (!commit) continue;
    const r = await runClose({ companyId: c, period: p, lock: true, actor: ACTOR });
    console.log(`RELOCK ${c} ${p} — COGS RM${r.snapshot.pnl.cogs.toFixed(2)}`);
  }
  console.log(`\n${commit ? "committed" : "dry-run"} — Q2 COGS restored (frozen)`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
