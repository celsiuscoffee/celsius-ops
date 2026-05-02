// SST-02 calculator. Reads journals for a 2-month taxable period (Malaysian
// SST is bi-monthly), computes output tax (sales SST collected) less input
// tax (deferred SST eligible to recover), produces a draft fin_sst_filings
// row with breakdown JSON. Submission to JKDM is manual — we generate the
// payload and the human files it.
//
// Output tax: credits to 3002 Other payables and accruals (SST Payable)
// Input tax:  debits to 3003 SST Deferred (recoverable input SST)
// Net payable = output - input

import { randomUUID } from "crypto";
import { getFinanceClient } from "../supabase";

export const SST_AGENT_VERSION = "sst-v1";

// Returns the SST taxable-period range for a given month.
// Malaysian SST taxable periods are bi-monthly: Jan-Feb, Mar-Apr, May-Jun, ...
// Anchor on Jan: month 1-2 → period "2026-01:02", 3-4 → "2026-03:04", etc.
export function sstPeriodFor(yearMonth: string): { period: string; start: string; end: string } {
  const [yearStr, monthStr] = yearMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const startMonth = month % 2 === 1 ? month : month - 1;
  const endMonth = startMonth + 1;
  const startStr = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const endDay = new Date(year, endMonth, 0).getDate();
  const endStr = `${year}-${String(endMonth).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
  const period = `${year}-${String(startMonth).padStart(2, "0")}:${String(endMonth).padStart(2, "0")}`;
  return { period, start: startStr, end: endStr };
}

export type SstCalc = {
  period: string;
  start: string;
  end: string;
  outputTax: number;
  inputTax: number;
  netPayable: number;
  outputByOutlet: Record<string, number>;
  outputByChannel: Record<string, number>;
  inputBySupplier: Record<string, number>;
  txnCount: number;
};

export async function calculateSst(companyId: string, yearMonth: string): Promise<SstCalc & { companyId: string }> {
  const client = getFinanceClient();
  const { period, start, end } = sstPeriodFor(yearMonth);

  // All posted txns in range — chunked join
  const { data: txns } = await client
    .from("fin_transactions")
    .select("id, outlet_id, txn_type")
    .eq("company_id", companyId)
    .eq("status", "posted")
    .gte("txn_date", start)
    .lte("txn_date", end);
  const txnIds = (txns ?? []).map((t) => t.id as string);
  const txnMeta = new Map((txns ?? []).map((t) => [t.id as string, t]));
  if (txnIds.length === 0) {
    return {
      companyId,
      period, start, end,
      outputTax: 0, inputTax: 0, netPayable: 0,
      outputByOutlet: {}, outputByChannel: {}, inputBySupplier: {},
      txnCount: 0,
    };
  }

  const outputByOutlet: Record<string, number> = {};
  const outputByChannel: Record<string, number> = {};
  const inputBySupplier: Record<string, number> = {};
  let outputTax = 0;
  let inputTax = 0;

  const chunkSize = 200;
  for (let i = 0; i < txnIds.length; i += chunkSize) {
    const chunk = txnIds.slice(i, i + chunkSize);
    const { data: lines } = await client
      .from("fin_journal_lines")
      .select("transaction_id, account_code, debit, credit")
      .in("transaction_id", chunk);
    for (const l of lines ?? []) {
      const code = l.account_code as string;
      const txn = txnMeta.get(l.transaction_id as string);
      if (!txn) continue;

      // Output: credit to 3002 (SST Payable) — collected from customers
      if (code === "3002") {
        const credit = Number(l.credit);
        if (credit > 0) {
          outputTax += credit;
          const outletId = (txn.outlet_id as string) ?? "no-outlet";
          outputByOutlet[outletId] = (outputByOutlet[outletId] ?? 0) + credit;
          // Channel inferred from the txn type for AR; for journals fall back
          const channel = (txn.txn_type as string) ?? "other";
          outputByChannel[channel] = (outputByChannel[channel] ?? 0) + credit;
        }
      }
      // Input: debit to 3003 (SST Deferred) — paid to suppliers
      if (code === "3003") {
        const debit = Number(l.debit);
        if (debit > 0) {
          inputTax += debit;
          // Supplier resolution requires fetching fin_bills for this txn —
          // skipped here for performance; surfaced via the breakdown API
          // when finance opens the line.
          inputBySupplier["aggregate"] = (inputBySupplier["aggregate"] ?? 0) + debit;
        }
      }
    }
  }

  return {
    companyId,
    period, start, end,
    outputTax: round2(outputTax),
    inputTax: round2(inputTax),
    netPayable: round2(outputTax - inputTax),
    outputByOutlet: roundMap(outputByOutlet),
    outputByChannel: roundMap(outputByChannel),
    inputBySupplier: roundMap(inputBySupplier),
    txnCount: txnIds.length,
  };
}

// Persists the calculated SST as a draft fin_sst_filings row. Idempotent on
// (company_id, period). Re-running before filing overwrites the draft.
export async function persistDraft(
  calc: SstCalc & { companyId: string },
  actor: string
): Promise<{ id: string }> {
  const client = getFinanceClient();
  await client.rpc("fin_set_actor", { p_actor: actor });

  const { data: existing } = await client
    .from("fin_sst_filings")
    .select("id, filing_status")
    .eq("company_id", calc.companyId)
    .eq("period", calc.period)
    .maybeSingle();

  if (existing?.filing_status && existing.filing_status !== "draft") {
    throw new Error(`SST period ${calc.period} already filed; cannot overwrite.`);
  }

  const id = (existing?.id as string) ?? randomUUID();
  const row = {
    id,
    company_id: calc.companyId,
    period: calc.period,
    output_tax: calc.outputTax,
    input_tax: calc.inputTax,
    net_payable: calc.netPayable,
    filing_status: "draft",
    details: {
      start: calc.start,
      end: calc.end,
      outputByOutlet: calc.outputByOutlet,
      outputByChannel: calc.outputByChannel,
      inputBySupplier: calc.inputBySupplier,
      txnCount: calc.txnCount,
      computedAt: new Date().toISOString(),
      agentVersion: SST_AGENT_VERSION,
    },
  };

  if (existing) {
    await client.from("fin_sst_filings").update(row).eq("id", id);
  } else {
    await client.from("fin_sst_filings").insert(row);
  }

  return { id };
}

export async function markFiled(
  companyId: string,
  period: string,
  paymentRef: string,
  userId: string
): Promise<void> {
  const client = getFinanceClient();
  await client.rpc("fin_set_actor", { p_actor: userId });
  await client
    .from("fin_sst_filings")
    .update({
      filing_status: "filed",
      filed_at: new Date().toISOString(),
      filed_by: userId,
      payment_ref: paymentRef,
    })
    .eq("company_id", companyId)
    .eq("period", period);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundMap(m: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, round2(v)]));
}
