// Land Q2 2026 COGS on the consumption (BOM) basis in the GL.
//
// The GL books COGS as PURCHASES (6000-01 from AP/bank) — lumpy buying that
// includes stock build and waste. The sourced/Reports P&L books COGS as
// theoretical consumption (sales × recipes at supplier cost). Owner decision
// (2026-07-23): Q2 lands on the consumption basis; the purchase-vs-consumption
// difference is the stock actually built (or drawn down), which belongs on the
// balance sheet as Inventory (1002), not in the P&L. That inventory becomes the
// opening balance for the disciplined-stock-count era; the first real month-end
// count trues it up and the variance is the historical waste/shrinkage.
//
// Per entity per month: adjust COGS (6000-01) from its current GL value to the
// sourced P&L's COGS for that month, offsetting to 1002 Inventory.
//   consumption > purchases (drawdown): Dr 6000-01 / Cr 1002
//   purchases > consumption (build):    Cr 6000-01 / Dr 1002
//
// Idempotent (deterministic posting_key). Assumes the 9 (entity, month) periods
// are OPEN; re-locks them at the end via runClose.
//
//   cd apps/backoffice && set -a && . ./.env.local && set +a
//   npx tsx scripts/restate-q2-cogs.ts --dry
//   npx tsx scripts/restate-q2-cogs.ts --commit

import { createHash } from "node:crypto";
import { getFinanceClient } from "../src/lib/finance/supabase";
import { postJournal } from "../src/lib/finance/ledger";
import { runClose } from "../src/lib/finance/agents/close";
import { buildByCategory, type OutletPick } from "../src/app/api/sales/_lib/reports";
import { prisma } from "../src/lib/prisma";
import type { JournalLineInput } from "../src/lib/finance/types";

const ENTITIES = ["celsius", "celsiusconezion", "celsiustamarind"];
const MONTHS = [
  { period: "2026-04", first: "2026-04-01", end: "2026-04-30" },
  { period: "2026-05", first: "2026-05-01", end: "2026-05-31" },
  { period: "2026-06", first: "2026-06-01", end: "2026-06-30" },
];
const COGS_ACCT = "6000-01";
const INVENTORY = "1002";
const ACTOR = "owner-q2-cogs-2026-07";
const VERSION = "q2-cogs-consumption-v1";

const r2 = (n: number) => Math.round(n * 100) / 100;
function md5Uuid(s: string): string {
  const h = createHash("md5").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

async function glCogs(client: ReturnType<typeof getFinanceClient>, companyId: string, first: string, end: string): Promise<number> {
  const { data: txns } = await client
    .from("fin_transactions").select("id")
    .eq("company_id", companyId).eq("status", "posted")
    .gte("txn_date", first).lte("txn_date", end);
  const ids = (txns ?? []).map((t) => t.id as string);
  let sum = 0;
  for (let i = 0; i < ids.length; i += 150) {
    const { data: lines } = await client
      .from("fin_journal_lines").select("debit, credit")
      .in("transaction_id", ids.slice(i, i + 150))
      .eq("account_code", COGS_ACCT);
    for (const l of lines ?? []) sum += Number(l.debit) - Number(l.credit);
  }
  return r2(sum);
}

// Company's outlets as OutletPick[] for the consumption engine.
async function outletsFor(client: ReturnType<typeof getFinanceClient>, companyId: string): Promise<OutletPick[]> {
  const { data: oc } = await client.from("fin_outlet_companies").select("outlet_id").eq("company_id", companyId);
  const ids = (oc ?? []).map((r) => r.outlet_id as string);
  if (!ids.length) return [];
  const rows = await prisma.outlet.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, storehubId: true, loyaltyOutletId: true, pickupStoreId: true, posNativeCutoverAt: true },
  });
  return rows as OutletPick[];
}

async function main() {
  const commit = process.argv.includes("--commit");
  const client = getFinanceClient();

  console.log("entity            month     GL COGS    consumption      Δ→1002");
  for (const companyId of ENTITIES) {
    const outlets = await outletsFor(client, companyId);
    for (const m of MONTHS) {
      // Pure consumption (sales × recipes), consistent monthly — sums to the
      // quarterly consumption total, unlike buildSourcedPnl which flips to
      // roll-forward for any month a stock count happens to bound.
      const cat = await buildByCategory(outlets, m.first, m.end);
      const target = r2(Number(cat.total?.cogs) || 0);
      const current = await glCogs(client, companyId, m.first, m.end);
      const delta = r2(target - current); // +ve: raise COGS (drawdown); -ve: lower COGS (build)
      console.log(
        `${companyId.padEnd(16)} ${m.period}  ${current.toFixed(2).padStart(10)} ${target.toFixed(2).padStart(13)} ${delta.toFixed(2).padStart(11)}`,
      );
      if (delta === 0) continue;

      // COGS moves by delta; Inventory takes the opposite (build = inventory up).
      const lines: JournalLineInput[] = delta > 0
        ? [
            { accountCode: COGS_ACCT, debit: delta, memo: `COGS to consumption basis — ${m.period}` },
            { accountCode: INVENTORY, credit: delta, memo: `Inventory drawn down — ${m.period}` },
          ]
        : [
            { accountCode: COGS_ACCT, credit: -delta, memo: `COGS to consumption basis — ${m.period}` },
            { accountCode: INVENTORY, debit: -delta, memo: `Stock build capitalised — ${m.period}` },
          ];

      if (!commit) continue;
      const postingKey = md5Uuid(`q2-cogs|${companyId}|${m.period}`);
      const { data: exists } = await client.from("fin_transactions").select("id").eq("posting_key", postingKey).limit(1);
      if (exists && exists.length) { console.log(`    SKIP — already posted`); continue; }
      await postJournal({
        companyId, txnDate: m.end,
        description: `Q2 COGS to consumption basis — ${m.period} (purchase/consumption difference to Inventory 1002)`,
        txnType: "journal", outletId: null, sourceDocId: null, postingKey,
        agent: "manual", agentVersion: VERSION, confidence: 1.0, lines,
      });
    }
  }

  for (const companyId of ENTITIES) {
    for (const m of MONTHS) {
      if (!commit) { continue; }
      const res = await runClose({ companyId, period: m.period, lock: true, actor: ACTOR });
      console.log(`RELOCK ${companyId} ${m.period} — COGS RM${res.snapshot.pnl.cogs.toFixed(2)}, netIncome RM${res.snapshot.pnl.netIncome.toFixed(2)}`);
    }
  }
  console.log(`\n${commit ? "committed" : "dry-run"} — Q2 COGS consumption basis`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
