// One-shot GL repost: put the discount given away onto the ledger.
//
// PR #1041 fixed unified_sales.discount and taught the sourced P&L + the AR
// agent to show discounts (contra-revenue, COA 5001). But the ~1,500 EOD
// journals already posted for Jan-Jul 2026 booked revenue at NET with no 5001
// line (the StoreHub EOD ingestor hardcoded discount=0, and even the POS-native
// days never posted the 5001 leg). So the GL P&L still hid every promo,
// voucher and comp. This backfills that — WITHOUT touching the existing
// journals and WITHOUT moving net income.
//
// For each (company, outlet, month) that gave a discount, post ONE adjusting
// journal dated month-end:
//   Dr 5001 Discount Given        = the month's corrected discount
//   Cr 5000-xx sales accounts     = same total, split across the revenue
//                                   accounts in proportion to what that
//                                   outlet-month actually credited them
// Income section: sales lines rise by the discount, 5001 falls by the same, so
// net income is unchanged — it only makes the giveaway visible. The corrected
// discount comes from the warehouse (unified_sales), so pre-cutover StoreHub
// months (which had zero discount in the GL) are covered too.
//
// Idempotent: each journal carries a deterministic posting_key, and the table's
// unique index on posting_key makes a re-run a no-op.
//
// Usage:
//   cd apps/backoffice
//   npx dotenv -e .env.local -- npx tsx scripts/repost-discount-gl.ts --dry
//   npx dotenv -e .env.local -- npx tsx scripts/repost-discount-gl.ts --commit

import { createHash } from "node:crypto";
import { getFinanceClient } from "../src/lib/finance/supabase";
import { postJournal } from "../src/lib/finance/ledger";
import type { JournalLineInput } from "../src/lib/finance/types";

const DISCOUNT_GIVEN_CODE = "5001";
const AGENT = "manual" as const; // one-off human-initiated backfill
const AGENT_VERSION = "discount-gl-v1";

const round2 = (n: number) => Math.round(n * 100) / 100;
function md5Uuid(s: string): string {
  const h = createHash("md5").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

// Split `total` across the revenue accounts in proportion to their existing
// credited amounts; drop the rounding residual on the largest so the credits
// still sum to `total` exactly (or the journal would not balance the 5001 debit).
function allocate(mix: Record<string, number>, total: number): Record<string, number> {
  const codes = Object.keys(mix).filter((c) => mix[c] > 0);
  const base = codes.reduce((s, c) => s + mix[c], 0);
  if (total <= 0 || base <= 0) return {};
  const out: Record<string, number> = {};
  let assigned = 0;
  for (const c of codes) {
    out[c] = round2((total * mix[c]) / base);
    assigned = round2(assigned + out[c]);
  }
  const biggest = codes.reduce((a, b) => (mix[b] > mix[a] ? b : a));
  out[biggest] = round2(out[biggest] + round2(total - assigned));
  return out;
}

type Row = { ym: string; outlet_id: string; company_id: string; disc: number; mix: Record<string, number> };

async function loadRows(client: ReturnType<typeof getFinanceClient>): Promise<Row[]> {
  // The finance client is PostgREST, so read the two sides separately and join
  // in TS: corrected discount per (outlet, month) from the warehouse, and the
  // GL revenue mix per (company, outlet, month) from the posted EOD journals.
  //
  // unified_sales is a ~55k-row view and PostgREST caps a read at 1000 rows, so
  // page explicitly (discount != 0, non-refund rows — both signs, so StoreHub
  // round-ups net in exactly as the sourced P&L sums them) — a single unpaged
  // .select would silently truncate and undercount every discount.
  const discByKey = new Map<string, number>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: page, error } = await client
      .from("unified_sales")
      .select("outlet_id, biz_date, discount, sale_id")
      .gte("biz_date", "2026-01-01")
      .eq("is_refund", false)
      .neq("discount", 0) // both signs — StoreHub round-ups net in, matching the sourced P&L
      .order("sale_id", { ascending: true }) // unique key — a non-unique sort skips rows at page boundaries
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (page ?? []) as Array<{ outlet_id: string; biz_date: string; discount: number | null }>;
    for (const r of rows) {
      const k = `${r.outlet_id}|${r.biz_date.slice(0, 7)}`;
      discByKey.set(k, round2((discByKey.get(k) ?? 0) + Number(r.discount ?? 0)));
    }
    if (rows.length < PAGE) break;
  }

  // Revenue mix from posted ar_invoice journals. There are ~1,500 of these, so
  // page the header read (PostgREST caps at 1000) before fanning out to lines.
  const txById = new Map<string, { id: string; company_id: string; outlet_id: string; txn_date: string }>();
  for (let from = 0; ; from += PAGE) {
    const { data: page, error } = await client
      .from("fin_transactions")
      .select("id, company_id, outlet_id, txn_date")
      .eq("txn_type", "ar_invoice")
      .eq("status", "posted")
      .gte("txn_date", "2026-01-01")
      .order("id", { ascending: true }) // unique key — stable pagination
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (page ?? []) as Array<{ id: string; company_id: string; outlet_id: string; txn_date: string }>;
    for (const t of rows) txById.set(t.id, t);
    if (rows.length < PAGE) break;
  }
  const ids = [...txById.keys()];
  const mixByKey = new Map<string, { company_id: string; mix: Record<string, number> }>();
  // ~4 revenue credit lines per journal, so 200 txns/chunk stays under the cap.
  for (let i = 0; i < ids.length; i += 200) {
    const { data: lines } = await client
      .from("fin_journal_lines")
      .select("transaction_id, account_code, credit")
      .in("transaction_id", ids.slice(i, i + 200))
      .like("account_code", "5000-%")
      .gt("credit", 0);
    for (const l of (lines ?? []) as Array<{ transaction_id: string; account_code: string; credit: number }>) {
      const t = txById.get(l.transaction_id);
      if (!t) continue;
      const ym = t.txn_date.slice(0, 7);
      const k = `${t.outlet_id}|${ym}`;
      const cur = mixByKey.get(k) ?? { company_id: t.company_id, mix: {} };
      cur.mix[l.account_code] = round2((cur.mix[l.account_code] ?? 0) + Number(l.credit));
      mixByKey.set(k, cur);
    }
  }

  const rows: Row[] = [];
  for (const [k, disc] of discByKey) {
    if (disc <= 0) continue;
    const [outlet_id, ym] = k.split("|");
    const m = mixByKey.get(k);
    if (!m) {
      console.warn(`  ! no GL revenue mix for ${outlet_id} ${ym} (disc RM${disc}) — skipped`);
      continue;
    }
    rows.push({ ym, outlet_id, company_id: m.company_id, disc, mix: m.mix });
  }
  return rows.sort((a, b) => a.ym.localeCompare(b.ym) || a.company_id.localeCompare(b.company_id));
}

async function main() {
  const commit = process.argv.includes("--commit");
  const client = getFinanceClient();
  const rows = await loadRows(client);

  let total = 0;
  let posted = 0;
  let skipped = 0;
  for (const r of rows) {
    const alloc = allocate(r.mix, r.disc);
    const lines: JournalLineInput[] = [
      { accountCode: DISCOUNT_GIVEN_CODE, outletId: r.outlet_id, debit: r.disc, memo: `Discount given (repost) — ${r.ym}` },
      ...Object.entries(alloc).map(([code, amt]) => ({
        accountCode: code,
        outletId: r.outlet_id,
        credit: amt,
        memo: `Sales grossed up for discount (repost) — ${r.ym}`,
      })),
    ];
    const txnDate = monthEnd(r.ym);
    const postingKey = md5Uuid(`discount-gl|${r.company_id}|${r.outlet_id}|${r.ym}`);
    total = round2(total + r.disc);

    const label = `${r.ym} ${r.company_id} ${r.outlet_id.slice(0, 8)}  Dr 5001 ${r.disc.toFixed(2)}  Cr ${Object.entries(alloc).map(([c, a]) => `${c}:${a.toFixed(2)}`).join(" ")}`;
    if (!commit) {
      console.log("DRY  " + label);
      continue;
    }

    // Skip if this adjusting journal already exists (idempotent re-run).
    const { data: exists } = await client.from("fin_transactions").select("id").eq("posting_key", postingKey).limit(1);
    if (exists && exists.length) {
      skipped++;
      console.log("SKIP " + label);
      continue;
    }
    await postJournal({
      companyId: r.company_id,
      txnDate,
      description: `Discount given — ${r.ym} repost to COA 5001 (net income unchanged)`,
      txnType: "journal",
      outletId: r.outlet_id,
      sourceDocId: null,
      postingKey,
      agent: AGENT,
      agentVersion: AGENT_VERSION,
      confidence: 1.0,
      lines,
    });
    posted++;
    console.log("POST " + label);
  }
  console.log(`\n${commit ? "committed" : "dry-run"}: ${rows.length} outlet-months, RM${total.toFixed(2)} discount` + (commit ? `, ${posted} posted, ${skipped} already present` : ""));
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
