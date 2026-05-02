// Close Agent — month-end close runner. Posts depreciation for active fixed
// assets, snapshots P&L/BS/CF for the period, and (when explicitly told)
// flips the period to status='closed' which the DB trigger uses to block
// further posts.
//
// Reopens require fin_periods.status = 'open' + a reason; the API route
// handles that and feeds back into the audit log via fin_set_actor.

import { randomUUID } from "crypto";
import { getFinanceClient } from "../supabase";
import { postJournal } from "../ledger";
import type { JournalLineInput } from "../types";

export const CLOSE_AGENT_VERSION = "close-v1";

export type RunCloseInput = {
  companyId: string;          // legal entity being closed
  period: string;             // "YYYY-MM"
  lock?: boolean;             // if true, flip status='closed' after posting
  actor: string;              // user id or "cron"
};

export type RunCloseResult = {
  companyId: string;
  period: string;
  depreciation: { posted: number; transactionIds: string[] };
  snapshot: { pnl: PnlSnapshot; bs: BsSnapshot };
  locked: boolean;
};

// 1500 maps to its 1550 accumulated-dep counterpart by suffix.
//   1500-00 Coffee machines       → 1550-00 Coffee machines - Acc dep
//   1500-01 Furniture and fittings → 1550-01 Furniture and fittings - Acc dep
function accumulatedDepCode(assetCode: string): string {
  if (!assetCode.startsWith("1500-")) {
    throw new Error(`Cannot derive accumulated-dep code from ${assetCode}`);
  }
  return `1550-${assetCode.slice("1500-".length)}`;
}

// Straight-line monthly depreciation — only method we support today. The
// fin_fixed_assets row tracks accumulated_dep, so we compute the marginal
// charge for THIS period only.
function monthlyCharge(cost: number, usefulLifeMonths: number): number {
  if (usefulLifeMonths <= 0) return 0;
  return Math.round((cost / usefulLifeMonths) * 100) / 100;
}

async function postDepreciation(
  companyId: string,
  period: string,
  _actor: string
): Promise<{ posted: number; transactionIds: string[] }> {
  const client = getFinanceClient();
  const { data: assets, error } = await client
    .from("fin_fixed_assets")
    .select("id, account_code, outlet_id, description, cost, useful_life_months, accumulated_dep, status")
    .eq("company_id", companyId)
    .eq("status", "active");
  if (error) throw error;

  // Last day of the period — depreciation posts on the closing date.
  const [year, month] = period.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0));
  const txnDate = lastDay.toISOString().slice(0, 10);

  const transactionIds: string[] = [];
  let totalCharge = 0;

  for (const asset of assets ?? []) {
    const cost = Number(asset.cost);
    const accumDep = Number(asset.accumulated_dep);
    const useful = asset.useful_life_months as number;

    // Don't depreciate beyond cost.
    const remaining = Math.max(cost - accumDep, 0);
    if (remaining <= 0) {
      // Mark as fully depreciated so we stop iterating it.
      await client
        .from("fin_fixed_assets")
        .update({ status: "fully_depreciated" })
        .eq("id", asset.id);
      continue;
    }
    const charge = Math.min(monthlyCharge(cost, useful), remaining);
    if (charge <= 0) continue;

    const accumCode = accumulatedDepCode(asset.account_code as string);

    // DR 6512 Depreciation expense / CR 1550-xx Accumulated dep
    const lines: JournalLineInput[] = [
      {
        accountCode: "6512",
        outletId: (asset.outlet_id as string) ?? null,
        debit: charge,
        memo: `Dep: ${asset.description}`,
      },
      {
        accountCode: accumCode,
        outletId: (asset.outlet_id as string) ?? null,
        credit: charge,
        memo: `Acc dep: ${asset.description}`,
      },
    ];

    const result = await postJournal({
      companyId,
      txnDate,
      description: `Depreciation ${period} — ${asset.description}`,
      txnType: "depreciation",
      outletId: (asset.outlet_id as string) ?? null,
      sourceDocId: null,
      agent: "close",
      agentVersion: CLOSE_AGENT_VERSION,
      confidence: 1.0,
      lines,
    });

    transactionIds.push(result.transactionId);
    totalCharge += charge;

    // Update the asset row.
    await client
      .from("fin_fixed_assets")
      .update({ accumulated_dep: accumDep + charge })
      .eq("id", asset.id);
  }

  return { posted: Math.round(totalCharge * 100) / 100, transactionIds };
}

export type PnlSnapshot = {
  income: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  netIncome: number;
  byCode: Record<string, number>;
};

export type BsSnapshot = {
  assets: number;
  liabilities: number;
  equity: number;
  byCode: Record<string, number>;
};

// Lightweight snapshot generator for the close. Pulls all posted journals
// for the period and aggregates by account type. The full Reports phase
// (Phase 5) builds the rich versions of these.
async function buildPnl(companyId: string, period: string): Promise<PnlSnapshot> {
  const client = getFinanceClient();
  const [year, month] = period.split("-").map(Number);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}`;

  // Get accounts by type
  const { data: accounts } = await client
    .from("fin_accounts")
    .select("code, type")
    .in("type", ["income", "cogs", "expense"]);
  const accountType = new Map((accounts ?? []).map((a) => [a.code as string, a.type as string]));

  // Get all journal lines for posted transactions in the period.
  const { data: txns } = await client
    .from("fin_transactions")
    .select("id")
    .eq("company_id", companyId)
    .eq("status", "posted")
    .gte("txn_date", start)
    .lte("txn_date", end);
  const txnIds = (txns ?? []).map((t) => t.id as string);
  if (txnIds.length === 0) {
    return { income: 0, cogs: 0, grossProfit: 0, expenses: 0, netIncome: 0, byCode: {} };
  }

  const byCode: Record<string, number> = {};
  let income = 0;
  let cogs = 0;
  let expenses = 0;

  // Chunk to avoid IN clause size limits.
  const chunkSize = 200;
  for (let i = 0; i < txnIds.length; i += chunkSize) {
    const chunk = txnIds.slice(i, i + chunkSize);
    const { data: lines } = await client
      .from("fin_journal_lines")
      .select("account_code, debit, credit")
      .in("transaction_id", chunk);
    for (const l of lines ?? []) {
      const code = l.account_code as string;
      const t = accountType.get(code);
      if (!t) continue;
      const sign = t === "income" ? Number(l.credit) - Number(l.debit) : Number(l.debit) - Number(l.credit);
      byCode[code] = (byCode[code] ?? 0) + sign;
      if (t === "income") income += sign;
      else if (t === "cogs") cogs += sign;
      else if (t === "expense") expenses += sign;
    }
  }

  return {
    income: round2(income),
    cogs: round2(cogs),
    grossProfit: round2(income - cogs),
    expenses: round2(expenses),
    netIncome: round2(income - cogs - expenses),
    byCode: Object.fromEntries(Object.entries(byCode).map(([k, v]) => [k, round2(v)])),
  };
}

async function buildBs(companyId: string, period: string): Promise<BsSnapshot> {
  const client = getFinanceClient();
  const [year, month] = period.split("-").map(Number);
  const end = `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}`;

  const { data: accounts } = await client
    .from("fin_accounts")
    .select("code, type")
    .in("type", ["asset", "liability", "equity"]);
  const accountType = new Map((accounts ?? []).map((a) => [a.code as string, a.type as string]));

  // All posted txns up to and including period end (cumulative balance sheet).
  const { data: txns } = await client
    .from("fin_transactions")
    .select("id")
    .eq("company_id", companyId)
    .eq("status", "posted")
    .lte("txn_date", end);
  const txnIds = (txns ?? []).map((t) => t.id as string);
  if (txnIds.length === 0) {
    return { assets: 0, liabilities: 0, equity: 0, byCode: {} };
  }

  const byCode: Record<string, number> = {};
  let assets = 0;
  let liabilities = 0;
  let equity = 0;

  const chunkSize = 200;
  for (let i = 0; i < txnIds.length; i += chunkSize) {
    const chunk = txnIds.slice(i, i + chunkSize);
    const { data: lines } = await client
      .from("fin_journal_lines")
      .select("account_code, debit, credit")
      .in("transaction_id", chunk);
    for (const l of lines ?? []) {
      const code = l.account_code as string;
      const t = accountType.get(code);
      if (!t) continue;
      const sign = t === "asset" ? Number(l.debit) - Number(l.credit) : Number(l.credit) - Number(l.debit);
      byCode[code] = (byCode[code] ?? 0) + sign;
      if (t === "asset") assets += sign;
      else if (t === "liability") liabilities += sign;
      else if (t === "equity") equity += sign;
    }
  }

  return {
    assets: round2(assets),
    liabilities: round2(liabilities),
    equity: round2(equity),
    byCode: Object.fromEntries(Object.entries(byCode).map(([k, v]) => [k, round2(v)])),
  };
}

export async function runClose(input: RunCloseInput): Promise<RunCloseResult> {
  if (!/^\d{4}-\d{2}$/.test(input.period)) {
    throw new Error(`Invalid period format: ${input.period}`);
  }
  const client = getFinanceClient();
  await client.rpc("fin_set_actor", { p_actor: input.actor });

  // Refuse to close if already closed (caller can reopen first).
  const { data: existing } = await client
    .from("fin_periods")
    .select("status")
    .eq("company_id", input.companyId)
    .eq("period", input.period)
    .maybeSingle();
  if (existing?.status === "closed") {
    throw new Error(`Period ${input.period} for ${input.companyId} is already closed. Reopen first.`);
  }

  // Mark closing while we work
  await client
    .from("fin_periods")
    .upsert(
      { company_id: input.companyId, period: input.period, status: "closing", updated_at: new Date().toISOString() },
      { onConflict: "company_id,period" }
    );

  // 1. Depreciation
  const depreciation = await postDepreciation(input.companyId, input.period, input.actor);

  // 2. Snapshot
  const pnl = await buildPnl(input.companyId, input.period);
  const bs = await buildBs(input.companyId, input.period);

  // 3. Persist snapshot + optional lock
  await client
    .from("fin_periods")
    .upsert(
      {
        company_id: input.companyId,
        period: input.period,
        status: input.lock ? "closed" : "open",
        pnl_snapshot: pnl,
        bs_snapshot: bs,
        closed_at: input.lock ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id,period" }
    );

  return {
    companyId: input.companyId,
    period: input.period,
    depreciation,
    snapshot: { pnl, bs },
    locked: !!input.lock,
  };
}

export async function reopenPeriod(
  companyId: string,
  period: string,
  userId: string,
  reason: string
): Promise<void> {
  const client = getFinanceClient();
  await client.rpc("fin_set_actor", { p_actor: userId });
  await client
    .from("fin_periods")
    .update({
      status: "open",
      reopened_at: new Date().toISOString(),
      reopened_by: userId,
      reopen_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)
    .eq("period", period);
}

export { buildPnl, buildBs };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
