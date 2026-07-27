// Fixed-asset depreciation — register PPE into fin_fixed_assets and post
// straight-line depreciation each month.
//
// The COA carries PPE (1500-xx), accumulated depreciation (1550-xx) and the
// 6512 expense, and the close agent already knows how to charge depreciation —
// but the asset register was never populated, so it was a permanent no-op and
// RM200k+ of capitalised assets sat on the balance sheet with zero depreciation.
// This module (1) registers the assets already sitting in GL 1500, (2) posts
// idempotent monthly straight-line depreciation, and (3) can catch up the
// months that were missed. Owner-approved policy: straight-line, no residual,
// standard F&B useful lives below.

import { createHash } from "crypto";
import { getFinanceClient } from "./supabase";
import { postJournal } from "./ledger";
import type { JournalLineInput } from "./types";

export const DEPRECIATION_VERSION = "depreciation-v1";

// Useful life (months) per 1500-xx PPE sub-account. Straight-line, nil residual.
export const USEFUL_LIFE_MONTHS: Record<string, number> = {
  "1500-00": 60,  // Coffee machines — 5y
  "1500-01": 120, // Furniture & fittings — 10y
  "1500-02": 60,  // Kitchen equipment — 5y
  "1500-03": 36,  // Office equipment — 3y
  "1500-04": 60,  // Renovation — 5y
  "1500-05": 60,  // Signboard — 5y
};
const DEFAULT_LIFE = 60;

const round2 = (n: number) => Math.round(n * 100) / 100;
function accumCodeFor(assetCode: string): string {
  return `1550-${assetCode.slice("1500-".length)}`;
}
function md5Uuid(s: string): string {
  const h = createHash("md5").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// ── Register the PPE already capitalised in GL 1500 as depreciable assets ──
// Reads the 1500-xx debit postings and creates one fin_fixed_assets row per
// posting (deterministic id from the source txn+account, so re-running is a
// no-op). acquired_date = the posting date; useful life by sub-account.
export type RegisterResult = { created: number; skipped: number; assets: { company: string; account: string; cost: number; acquired: string }[] };

export async function registerPpeFromGl(opts: { dryRun?: boolean } = {}): Promise<RegisterResult> {
  const client = getFinanceClient();
  const { data: lines } = await client.from("fin_journal_lines").select("account_code,debit,credit,transaction_id").like("account_code", "1500-%");
  const txids = [...new Set((lines ?? []).map((l) => l.transaction_id))];
  type TxnRow = { id: string; company_id: string; txn_date: string; description: string | null };
  const txns = new Map<string, TxnRow>();
  for (let i = 0; i < txids.length; i += 200) {
    const { data } = await client.from("fin_transactions").select("id,company_id,txn_date,description").in("id", txids.slice(i, i + 200));
    for (const t of (data ?? []) as TxnRow[]) txns.set(t.id, t);
  }
  const { data: existing } = await client.from("fin_fixed_assets").select("id");
  const have = new Set((existing ?? []).map((a) => a.id));

  let created = 0, skipped = 0;
  const assets: RegisterResult["assets"] = [];
  for (const l of lines ?? []) {
    const net = round2(Number(l.debit) - Number(l.credit));
    if (net < 100) continue; // ignore tiny/credit lines
    const t = txns.get(l.transaction_id);
    if (!t) continue;
    const id = md5Uuid(`ppe|${l.transaction_id}|${l.account_code}`);
    if (have.has(id)) { skipped++; continue; }
    assets.push({ company: t.company_id, account: l.account_code, cost: net, acquired: t.txn_date });
    if (!opts.dryRun) {
      const { error } = await client.from("fin_fixed_assets").insert({
        id, company_id: t.company_id, account_code: l.account_code, outlet_id: null,
        description: (t.description || `PPE ${l.account_code}`).slice(0, 120),
        acquired_date: t.txn_date, cost: net, useful_life_months: USEFUL_LIFE_MONTHS[l.account_code] ?? DEFAULT_LIFE,
        method: "straight_line", accumulated_dep: 0, residual: 0, status: "active",
        notes: `GL txn ${l.transaction_id}`, created_by: DEPRECIATION_VERSION,
      });
      if (error) throw new Error(`register asset failed (${l.account_code}): ${error.message}`);
    }
    created++;
  }
  return { created, skipped, assets };
}

// Whole months an asset was held during `year` — from the later of its
// acquisition month and January, through December. An asset bought in March is
// charged 10 months, not 12.
function monthsHeldInYear(acquiredDate: string, year: number): number {
  const acq = new Date(`${acquiredDate}T00:00:00Z`);
  if (acq.getUTCFullYear() > year) return 0;
  const startMonth = acq.getUTCFullYear() === year ? acq.getUTCMonth() : 0;
  return 12 - startMonth;
}

// ── Post a full YEAR of straight-line depreciation for a company ──
//
// Depreciation is an ANNUAL charge (owner's policy): one journal per company per
// financial year, dated 31 Dec, rather than a monthly drip through every close.
// Each asset is charged for the months it was actually held that year, capped at
// its remaining book value. Idempotent per (company, year) — re-running is a
// no-op, so a re-close never double-charges.
export async function postAnnualDepreciation(companyId: string, year: number, opts: { dryRun?: boolean } = {}): Promise<{ posted: number; transactionId: string | null; skipped: string | null }> {
  const txnDate = `${year}-12-31`;
  const client = getFinanceClient();

  const { data: existing } = await client.from("fin_transactions").select("id").eq("company_id", companyId).eq("txn_type", "depreciation").eq("txn_date", txnDate).limit(1);
  if (existing && existing.length) return { posted: 0, transactionId: existing[0].id as string, skipped: "already posted" };

  const { data: assets } = await client.from("fin_fixed_assets").select("id,account_code,outlet_id,description,cost,useful_life_months,accumulated_dep,residual,status,acquired_date").eq("company_id", companyId).eq("status", "active");
  const lines: JournalLineInput[] = [];
  const updates: { id: string; accumulated_dep: number; status?: string }[] = [];
  let total = 0;
  for (const a of assets ?? []) {
    const months = monthsHeldInYear(a.acquired_date, year);
    if (months <= 0) continue; // acquired after this year
    const cost = Number(a.cost), residual = Number(a.residual ?? 0), accum = Number(a.accumulated_dep), life = Number(a.useful_life_months);
    const depreciable = Math.max(cost - residual, 0);
    const remaining = Math.max(depreciable - accum, 0);
    if (remaining <= 0.005) { updates.push({ id: a.id, accumulated_dep: accum, status: "fully_depreciated" }); continue; }
    const charge = round2(Math.min(life > 0 ? (cost / life) * months : 0, remaining));
    if (charge <= 0) continue;
    const accCode = accumCodeFor(a.account_code);
    lines.push({ accountCode: "6512", outletId: a.outlet_id ?? null, debit: charge, memo: `Dep ${year} (${months}mo): ${a.description}` });
    lines.push({ accountCode: accCode, outletId: a.outlet_id ?? null, credit: charge, memo: `Acc dep ${year}: ${a.description}` });
    updates.push({ id: a.id, accumulated_dep: round2(accum + charge) });
    total += charge;
  }
  if (lines.length === 0) return { posted: 0, transactionId: null, skipped: "no depreciable assets" };
  if (opts.dryRun) return { posted: round2(total), transactionId: null, skipped: "dry-run" };

  const res = await postJournal({ companyId, txnDate, description: `Depreciation ${year} (annual charge)`, txnType: "depreciation", outletId: null, sourceDocId: null, agent: "close", agentVersion: DEPRECIATION_VERSION, confidence: 1.0, lines });
  for (const u of updates) await client.from("fin_fixed_assets").update({ accumulated_dep: u.accumulated_dep, ...(u.status ? { status: u.status } : {}) }).eq("id", u.id);
  return { posted: round2(total), transactionId: res.transactionId, skipped: null };
}
