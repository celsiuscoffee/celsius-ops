// Fixed assets register + straight-line depreciation engine.
//
// ONE depreciation math, used everywhere: the register's computed columns, the
// sourced P&L "Depreciation" line, its drill-down, the auditor pack CSV and
// the monthly GL posting all call the same functions here, so the numbers can
// never disagree.
//
// MONTH CONVENTION (the single documented convention):
//   - An asset starts depreciating in the FIRST FULL MONTH AFTER acquired_date.
//     An asset bought 2026-03-15 (or 2026-03-01) takes its first charge in
//     April 2026. No partial-month charges.
//   - Each monthly charge is recognized on the LAST calendar day of its month
//     (matching how the close agent dates depreciation journals). A reporting
//     window [start, end] therefore includes a month's charge exactly when that
//     month's last day falls inside the window.
//   - Monthly charge = round2((cost - residual) / useful_life_months); the
//     FINAL life month takes the remainder so lifetime depreciation sums to
//     exactly cost - residual with no rounding drift.
//   - Disposal stops depreciation from the disposal month onward: the month of
//     disposed_date and every later month take no charge (mirror of the start
//     convention: only full months of ownership depreciate).
//
// Data model: fin_fixed_assets (002_finance_module.sql + 072 register v2).
// account_code is the 1500-xx PP&E account; its 1550-xx accumulated
// depreciation counterpart is derived by suffix; the expense side is always
// 6512 Depreciation of property, plant and equipment.

import { createHash } from "crypto";
import { getFinanceClient } from "./supabase";
import { postJournal } from "./ledger";
import type { JournalLineInput } from "./types";

export const FIXED_ASSETS_AGENT_VERSION = "fixed-assets-v1";
export const DEP_EXPENSE_ACCOUNT = "6512";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type FixedAsset = {
  id: string;
  companyId: string | null;
  outletId: string | null;
  name: string;               // fin_fixed_assets.description
  accountCode: string;        // 1500-xx PP&E account
  cost: number;
  residual: number;
  acquiredDate: string;       // YYYY-MM-DD
  usefulLifeMonths: number;
  method: string;             // straight_line (only method)
  status: string;             // active | disposed | fully_depreciated
  disposedDate: string | null;
  sourceBankLineId: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string | null;
};

// 1500-xx maps to its 1550-xx accumulated depreciation counterpart by suffix
// (1500-02 Kitchen equipment -> 1550-02). Same rule the close agent uses.
export function accumulatedDepCode(assetCode: string): string {
  if (!assetCode.startsWith("1500-")) {
    throw new Error(`Cannot derive accumulated-dep code from ${assetCode}`);
  }
  return `1550-${assetCode.slice("1500-".length)}`;
}

// ── month arithmetic (yearMonth strings "YYYY-MM" <-> linear month index) ────
export function ymIndex(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
}
export function ymFromIndex(i: number): string {
  const y = Math.floor(i / 12);
  const m = (i % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}
export function ymOfDate(dateStr: string): string {
  return dateStr.slice(0, 7);
}
// Last calendar day of a yearMonth, as YYYY-MM-DD.
export function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(last).padStart(2, "0")}`;
}

// The depreciation charge this asset takes in the given yearMonth, under the
// convention documented at the top of this file. 0 outside the asset's life.
export function monthlyDepreciation(asset: FixedAsset, ym: string): number {
  const life = asset.usefulLifeMonths;
  if (life <= 0) return 0;
  const base = round2(asset.cost - asset.residual);
  if (base <= 0) return 0;

  const startIdx = ymIndex(ymOfDate(asset.acquiredDate)) + 1; // first full month after acquisition
  const i = ymIndex(ym) - startIdx;                            // 0-based month of life
  if (i < 0 || i >= life) return 0;

  // Disposal month and later take no charge.
  if (asset.disposedDate && ymIndex(ym) >= ymIndex(ymOfDate(asset.disposedDate))) return 0;

  const monthly = round2(base / life);
  if (i === life - 1) return round2(Math.max(base - monthly * (life - 1), 0)); // remainder month
  return monthly;
}

// Total charge over an inclusive yearMonth range.
export function depreciationForYmRange(asset: FixedAsset, fromYm: string, toYm: string): number {
  let total = 0;
  for (let i = ymIndex(fromYm); i <= ymIndex(toYm); i++) {
    total += monthlyDepreciation(asset, ymFromIndex(i));
  }
  return round2(total);
}

// Total charge for a date window [start, end] (YYYY-MM-DD): sums the months
// whose LAST day falls inside the window (charges are dated on month end).
export function depreciationForWindow(asset: FixedAsset, start: string, end: string): number {
  let total = 0;
  for (let i = ymIndex(ymOfDate(start)); i <= ymIndex(ymOfDate(end)); i++) {
    const ym = ymFromIndex(i);
    const me = monthEnd(ym);
    if (me >= start && me <= end) total += monthlyDepreciation(asset, ym);
  }
  return round2(total);
}

// Accumulated depreciation through the end of the month containing asOf.
export function accumulatedDepreciation(asset: FixedAsset, asOf: string): number {
  const startYm = ymFromIndex(ymIndex(ymOfDate(asset.acquiredDate)) + 1);
  const asOfYm = ymOfDate(asOf);
  if (ymIndex(asOfYm) < ymIndex(startYm)) return 0;
  return depreciationForYmRange(asset, startYm, asOfYm);
}

export function netBookValue(asset: FixedAsset, asOf: string): number {
  return round2(asset.cost - accumulatedDepreciation(asset, asOf));
}

// ── register access ──────────────────────────────────────────────────────────
type AssetRow = {
  id: string; company_id: string | null; outlet_id: string | null; description: string;
  account_code: string; cost: number | string; residual: number | string | null;
  acquired_date: string; useful_life_months: number; method: string; status: string;
  disposed_date: string | null; source_bank_line_id: string | null; notes: string | null;
  created_by: string | null; created_at: string | null;
};

export function mapAssetRow(r: AssetRow): FixedAsset {
  return {
    id: r.id,
    companyId: r.company_id,
    outletId: r.outlet_id,
    name: r.description,
    accountCode: r.account_code,
    cost: round2(Number(r.cost)),
    residual: round2(Number(r.residual ?? 0)),
    acquiredDate: r.acquired_date,
    usefulLifeMonths: r.useful_life_months,
    method: r.method,
    status: r.status,
    disposedDate: r.disposed_date,
    sourceBankLineId: r.source_bank_line_id,
    notes: r.notes,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

const ASSET_COLUMNS =
  "id, company_id, outlet_id, description, account_code, cost, residual, acquired_date, useful_life_months, method, status, disposed_date, source_bank_line_id, notes, created_by, created_at";

export async function listFixedAssets(companyId?: string | null): Promise<FixedAsset[]> {
  const client = getFinanceClient();
  let q = client.from("fin_fixed_assets").select(ASSET_COLUMNS).order("acquired_date", { ascending: false });
  if (companyId) q = q.eq("company_id", companyId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as AssetRow[]).map(mapAssetRow);
}

// Per-asset depreciation totals for a reporting window. The P&L line, its
// drill and the run-depreciation preview all read from this.
export async function depreciationByAsset(input: {
  companyId?: string | null;
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  outletId?: string | null;
}): Promise<{ asset: FixedAsset; amount: number }[]> {
  const assets = await listFixedAssets(input.companyId);
  const out: { asset: FixedAsset; amount: number }[] = [];
  for (const a of assets) {
    if (input.outletId && a.outletId !== input.outletId) continue;
    const amount = depreciationForWindow(a, input.start, input.end);
    if (amount > 0) out.push({ asset: a, amount });
  }
  return out;
}

export async function depreciationTotal(input: {
  companyId?: string | null;
  start: string;
  end: string;
  outletId?: string | null;
}): Promise<number> {
  const rows = await depreciationByAsset(input);
  return round2(rows.reduce((s, r) => s + r.amount, 0));
}

// ── GL posting ───────────────────────────────────────────────────────────────
// Deterministic identity for a company-month depreciation journal, formatted
// as a uuid to fit fin_transactions.posting_key (same trick as bankJournalKey
// in gl-posting.ts). The unique index on posting_key makes re-posting a month
// physically impossible.
export function depreciationPostingKey(companyId: string, yearMonth: string): string {
  const h = createHash("md5").update(`fixed-asset-dep|${companyId}|${yearMonth}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type DepreciationRunCompany = {
  companyId: string;
  total: number;
  byAsset: { id: string; name: string; accountCode: string; amount: number }[];
  alreadyPosted: boolean;
  transactionId: string | null; // set when posted (new or pre-existing)
};

// Post ONE balanced journal per company for the month's depreciation:
//   Dr 6512 Depreciation expense (total)
//   Cr 1550-xx Accumulated depreciation (one line per PP&E account)
// dated on the month's last day, agent 'close' (the AgentName the ledger types
// allow for period work), txn_type 'depreciation'. Idempotent via posting_key:
// re-running a month finds the existing journal and does nothing.
export async function runDepreciation(input: {
  yearMonth: string;                 // "YYYY-MM"
  commit: boolean;                   // false = dry-run preview
  companyIds?: string[];             // default: every company with assets
}): Promise<{ yearMonth: string; committed: boolean; companies: DepreciationRunCompany[] }> {
  if (!/^\d{4}-\d{2}$/.test(input.yearMonth)) {
    throw new Error(`yearMonth must be YYYY-MM, got ${input.yearMonth}`);
  }
  const client = getFinanceClient();
  const assets = await listFixedAssets(null);

  // Group the month's charges per company.
  const perCompany = new Map<string, { total: number; byAsset: DepreciationRunCompany["byAsset"]; byAccount: Map<string, number> }>();
  for (const a of assets) {
    if (!a.companyId) continue;
    if (input.companyIds && !input.companyIds.includes(a.companyId)) continue;
    const charge = monthlyDepreciation(a, input.yearMonth);
    if (charge <= 0) continue;
    const g = perCompany.get(a.companyId) ?? { total: 0, byAsset: [], byAccount: new Map<string, number>() };
    g.total = round2(g.total + charge);
    g.byAsset.push({ id: a.id, name: a.name, accountCode: a.accountCode, amount: charge });
    const acc = accumulatedDepCode(a.accountCode);
    g.byAccount.set(acc, round2((g.byAccount.get(acc) ?? 0) + charge));
    perCompany.set(a.companyId, g);
  }

  const txnDate = monthEnd(input.yearMonth);
  const companies: DepreciationRunCompany[] = [];

  for (const [companyId, g] of perCompany) {
    const postingKey = depreciationPostingKey(companyId, input.yearMonth);
    const { data: existingRows, error: exErr } = await client
      .from("fin_transactions")
      .select("id")
      .eq("posting_key", postingKey)
      .eq("status", "posted")
      .limit(1);
    if (exErr) throw new Error(exErr.message);
    const existing = existingRows?.[0];

    if (existing) {
      companies.push({ companyId, total: g.total, byAsset: g.byAsset, alreadyPosted: true, transactionId: existing.id as string });
      continue;
    }
    if (!input.commit) {
      companies.push({ companyId, total: g.total, byAsset: g.byAsset, alreadyPosted: false, transactionId: null });
      continue;
    }

    const lines: JournalLineInput[] = [
      { accountCode: DEP_EXPENSE_ACCOUNT, debit: g.total, memo: `Depreciation ${input.yearMonth} (${g.byAsset.length} asset${g.byAsset.length > 1 ? "s" : ""})` },
      ...[...g.byAccount.entries()].map(([acc, amt]) => ({
        accountCode: acc,
        credit: amt,
        memo: `Accumulated depreciation ${input.yearMonth}`,
      })),
    ];
    const res = await postJournal({
      companyId,
      txnDate,
      description: `Depreciation ${input.yearMonth}, straight-line, ${g.byAsset.length} asset${g.byAsset.length > 1 ? "s" : ""}`,
      txnType: "depreciation",
      agent: "close",
      agentVersion: FIXED_ASSETS_AGENT_VERSION,
      confidence: 1,
      postingKey,
      lines,
    });
    companies.push({ companyId, total: g.total, byAsset: g.byAsset, alreadyPosted: false, transactionId: res.transactionId });
  }

  return { yearMonth: input.yearMonth, committed: input.commit, companies: companies.sort((a, b) => a.companyId.localeCompare(b.companyId)) };
}
