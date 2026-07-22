// Close Agent — month-end close runner. Posts depreciation for active fixed
// assets, accrues the management fee shortfall owed to HQ (6.8% of the
// month's revenue less what was already paid), clears the Grab debtor for the
// month (commission + the Conezion interco leg — model in close-prep.ts),
// snapshots P&L/BS for the period, and (when explicitly told) flips the
// period to status='closed' which the DB trigger uses to block further posts.
//
// Reopens require fin_periods.status = 'open' + a reason; the API route
// handles that and feeds back into the audit log via fin_set_actor.

import { getFinanceClient } from "../supabase";
import { postJournal } from "../ledger";
import type { JournalLineInput } from "../types";
import {
  mgmtFeeAccrual, MGMT_FEE_EXPENSE_CODE, DUE_TO_HQ_CODE,
  grabClearingForPeriod, MARKETPLACE_FEE_CODE, GRAB_DEBTOR_CODE, DUE_TO_CONEZION_CODE,
} from "../close-prep";
import { postApAccrual, type PostApAccrualResult } from "../ap-accrual";

export const CLOSE_AGENT_VERSION = "close-v3";

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
  mgmtFee: { accrued: number; transactionId: string | null; skipped: string | null };
  grabClearing: { commission: number; intercoLeg: number; transactionId: string | null; skipped: string | null };
  apAccrual: PostApAccrualResult;
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

// Accrue the management fee shortfall for the period: DR 6511-06 Management
// fees / CR 3600-02 Due to HQ. Idempotent — one accrual per (company, period),
// keyed by txn_type + txn_date on the period's last day. HQ itself never
// accrues (it is the fee's recipient; its income side stays on the sourced
// P&L's cash-recognised REV-MGMT line to avoid double-counting).
async function postMgmtFeeShortfall(
  companyId: string,
  period: string,
): Promise<RunCloseResult["mgmtFee"]> {
  const fee = await mgmtFeeAccrual(companyId, period);
  if (!fee.applicable) return { accrued: 0, transactionId: null, skipped: "not applicable (HQ)" };
  if (fee.shortfall <= 0) {
    return { accrued: 0, transactionId: null, skipped: `fee settled in cash (paid RM ${fee.paid})` };
  }

  const [year, month] = period.split("-").map(Number);
  const txnDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  // Idempotency: skip when this period already carries an accrual.
  const client = getFinanceClient();
  const { data: existing } = await client
    .from("fin_transactions")
    .select("id")
    .eq("company_id", companyId)
    .eq("txn_type", "mgmt_fee_accrual")
    .eq("txn_date", txnDate)
    .limit(1);
  if (existing && existing.length > 0) {
    return { accrued: 0, transactionId: existing[0].id as string, skipped: "already accrued" };
  }

  const lines: JournalLineInput[] = [
    { accountCode: MGMT_FEE_EXPENSE_CODE, outletId: null, debit: fee.shortfall, memo: `Mgmt fee accrual ${period} (6.8% of RM ${fee.revenue} less RM ${fee.paid} paid)` },
    { accountCode: DUE_TO_HQ_CODE, outletId: null, credit: fee.shortfall, memo: `Due to HQ — mgmt fee ${period}` },
  ];
  const result = await postJournal({
    companyId,
    txnDate,
    description: `Management fee accrual ${period}`,
    txnType: "mgmt_fee_accrual",
    outletId: null,
    sourceDocId: null,
    agent: "close",
    agentVersion: CLOSE_AGENT_VERSION,
    confidence: 1.0,
    lines,
  });
  return { accrued: fee.shortfall, transactionId: result.transactionId, skipped: null };
}

// Post the month's Grab debtor clearing (see close-prep.ts for the model and
// why it is rate-derived). One balanced journal per company per period,
// idempotent via txn_type='grab_clearing' + the period's closing date:
//   Conezion:  Dr 3600-02 payout + Dr 6519 commission / Cr 1005 gross
//   HQ:        Dr 1005 payout + Dr 6519 commission / Cr 3600-01 payout + Cr 1005 commission
//   Tamarind:  Dr 6519 commission / Cr 1005 commission
async function postGrabClearing(
  companyId: string,
  period: string,
): Promise<RunCloseResult["grabClearing"]> {
  const g = await grabClearingForPeriod(companyId, period);
  if (!g.applicable) return { commission: 0, intercoLeg: 0, transactionId: null, skipped: "no Grab activity" };
  if (g.commission <= 0 && g.intercoLeg <= 0) {
    return { commission: 0, intercoLeg: 0, transactionId: null, skipped: "nothing to clear" };
  }

  const [year, month] = period.split("-").map(Number);
  const txnDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  const client = getFinanceClient();
  const { data: existing } = await client
    .from("fin_transactions")
    .select("id")
    .eq("company_id", companyId)
    .eq("txn_type", "grab_clearing")
    .eq("txn_date", txnDate)
    .limit(1);
  if (existing && existing.length > 0) {
    return { commission: 0, intercoLeg: 0, transactionId: existing[0].id as string, skipped: "already cleared" };
  }

  const rateNote = `rate ${g.payoutRate} from Tamarind trailing actuals`;
  const lines: JournalLineInput[] = [];
  if (companyId === "celsiusconezion") {
    lines.push(
      { accountCode: DUE_TO_HQ_CODE, outletId: null, debit: g.intercoLeg, memo: `Grab payouts ${period} collected by HQ (${rateNote})` },
      { accountCode: MARKETPLACE_FEE_CODE, outletId: null, debit: g.commission, memo: `Grab commission ${period}` },
      { accountCode: GRAB_DEBTOR_CODE, outletId: null, credit: round2(g.intercoLeg + g.commission), memo: `Clear Grab debtor ${period}` },
    );
  } else if (companyId === "celsius") {
    if (g.intercoLeg > 0) {
      lines.push(
        { accountCode: GRAB_DEBTOR_CODE, outletId: null, debit: g.intercoLeg, memo: `Return Conezion payouts absorbed by 1005 ${period}` },
        { accountCode: DUE_TO_CONEZION_CODE, outletId: null, credit: g.intercoLeg, memo: `Due to Conezion — Grab payouts ${period} (${rateNote})` },
      );
    }
    if (g.commission > 0) {
      lines.push(
        { accountCode: MARKETPLACE_FEE_CODE, outletId: null, debit: g.commission, memo: `Grab commission ${period} (${rateNote})` },
        { accountCode: GRAB_DEBTOR_CODE, outletId: null, credit: g.commission, memo: `Clear Grab commission ${period}` },
      );
    }
  } else {
    lines.push(
      { accountCode: MARKETPLACE_FEE_CODE, outletId: null, debit: g.commission, memo: `Grab commission ${period} (${rateNote})` },
      { accountCode: GRAB_DEBTOR_CODE, outletId: null, credit: g.commission, memo: `Clear Grab commission ${period}` },
    );
  }

  const result = await postJournal({
    companyId,
    txnDate,
    description: `Grab debtor clearing ${period}`,
    txnType: "grab_clearing",
    outletId: null,
    sourceDocId: null,
    agent: "close",
    agentVersion: CLOSE_AGENT_VERSION,
    confidence: 1.0,
    lines,
  });
  return { commission: g.commission, intercoLeg: g.intercoLeg, transactionId: result.transactionId, skipped: null };
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

  // 2. Management fee accrual (shortfall owed to HQ) — before the snapshot so
  //    the period's P&L and Due-to-HQ balance include it.
  const mgmtFee = await postMgmtFeeShortfall(input.companyId, input.period);

  // 3. Grab debtor clearing (commission + Conezion interco) — also before the
  //    snapshot so the period's P&L carries the marketplace fee.
  const grabClearing = await postGrabClearing(input.companyId, input.period);

  // 4. AP accrual — recognise open supplier bills as payables (Dr expense /
  //    Cr 3001), reversing next period so the cash-basis bank payment doesn't
  //    double-count. Brings the Invoice subledger into the GL; 3001 at period
  //    end ties to Aged Payables. Before the snapshot so the P&L/BS carry it.
  const apAccrual = await postApAccrual(input.companyId, input.period);

  // 5. Snapshot
  const pnl = await buildPnl(input.companyId, input.period);
  const bs = await buildBs(input.companyId, input.period);

  // 6. Persist snapshot + optional lock
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
    mgmtFee,
    grabClearing,
    apAccrual,
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
