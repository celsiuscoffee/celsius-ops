// Auditor pack — exports a CSV bundle covering everything an external
// auditor needs for a fiscal year:
//   - Trial balance         (closing balances per account)
//   - General ledger detail (every line, sortable by account / date)
//   - Journal listing       (every transaction header)
//   - AP listing            (bills + payment status)
//   - AR listing            (invoices + payment status)
//   - Fixed asset register
//   - SST filings
//   - Audit log             (every fin_* mutation with actor + timestamp)
//
// Output: a list of {filename, csvText} pairs the API route streams as a
// single ZIP-less manifest. The UI downloads each as a separate file —
// proper ZIP packaging is a follow-up using a streaming archiver.

import { getFinanceClient } from "../supabase";
import { buildPnl } from "./pnl";
import { buildBalanceSheet } from "./balance-sheet";

export type AuditorPackInput = {
  companyId: string;
  fiscalYear: number;          // e.g. 2026
};

export type AuditorPackFile = {
  filename: string;
  csv: string;
};

export async function buildAuditorPack(input: AuditorPackInput): Promise<AuditorPackFile[]> {
  const start = `${input.fiscalYear}-01-01`;
  const end = `${input.fiscalYear}-12-31`;
  const files: AuditorPackFile[] = [];

  files.push(await trialBalanceCsv(input.companyId, end));
  files.push(await glDetailCsv(input.companyId, start, end));
  files.push(await journalListingCsv(input.companyId, start, end));
  files.push(await arListingCsv(input.companyId, start, end));
  files.push(await apListingCsv(input.companyId, start, end));
  files.push(await fixedAssetCsv(input.companyId));
  files.push(await sstCsv(input.companyId, input.fiscalYear));
  files.push(await auditLogCsv(input.companyId, start, end));
  files.push(await pnlCsv(input.companyId, start, end));
  files.push(await bsCsv(input.companyId, end));

  return files;
}

async function trialBalanceCsv(companyId: string, asOf: string): Promise<AuditorPackFile> {
  const bs = await buildBalanceSheet({ companyId, asOf });
  const pnl = await buildPnl({ companyId, start: `${asOf.slice(0, 4)}-01-01`, end: asOf });
  const rows = ["code,name,type,debit,credit"];
  function push(code: string, name: string, type: string, amount: number) {
    const isDebitNormal = type === "asset" || type === "expense" || type === "cogs";
    const debit = isDebitNormal ? Math.max(amount, 0) : Math.max(-amount, 0);
    const credit = isDebitNormal ? Math.max(-amount, 0) : Math.max(amount, 0);
    rows.push(`"${code}","${csvEscape(name)}","${type}",${debit.toFixed(2)},${credit.toFixed(2)}`);
  }
  for (const l of bs.assets.lines) push(l.code, l.name, "asset", l.amount);
  for (const l of bs.liabilities.lines) push(l.code, l.name, "liability", l.amount);
  for (const l of bs.equity.lines) push(l.code, l.name, "equity", l.amount);
  for (const l of pnl.income.lines) push(l.code, l.name, "income", l.amount);
  for (const l of pnl.cogs.lines) push(l.code, l.name, "cogs", l.amount);
  for (const l of pnl.expenses.lines) push(l.code, l.name, "expense", l.amount);
  return { filename: `trial-balance-${asOf}.csv`, csv: rows.join("\n") };
}

async function glDetailCsv(
  companyId: string,
  start: string,
  end: string
): Promise<AuditorPackFile> {
  const client = getFinanceClient();
  const { data: txns } = await client
    .from("fin_transactions")
    .select("id, txn_date, description, txn_type, posted_by_agent, status")
    .eq("company_id", companyId)
    .eq("status", "posted")
    .gte("txn_date", start)
    .lte("txn_date", end)
    .order("txn_date");
  const txnIds = (txns ?? []).map((t) => t.id as string);
  const txnMap = new Map((txns ?? []).map((t) => [t.id as string, t]));

  const rows = ["txn_date,transaction_id,account_code,debit,credit,memo,description,posted_by_agent"];
  if (txnIds.length === 0) return { filename: `gl-detail-${start}_${end}.csv`, csv: rows.join("\n") };

  const chunkSize = 200;
  for (let i = 0; i < txnIds.length; i += chunkSize) {
    const chunk = txnIds.slice(i, i + chunkSize);
    const { data: lines } = await client
      .from("fin_journal_lines")
      .select("transaction_id, account_code, debit, credit, memo, line_order")
      .in("transaction_id", chunk)
      .order("line_order");
    for (const l of lines ?? []) {
      const t = txnMap.get(l.transaction_id as string);
      if (!t) continue;
      rows.push(
        [
          t.txn_date,
          l.transaction_id,
          l.account_code,
          Number(l.debit).toFixed(2),
          Number(l.credit).toFixed(2),
          `"${csvEscape((l.memo as string) ?? "")}"`,
          `"${csvEscape((t.description as string) ?? "")}"`,
          t.posted_by_agent ?? "",
        ].join(",")
      );
    }
  }
  return { filename: `gl-detail-${start}_${end}.csv`, csv: rows.join("\n") };
}

async function journalListingCsv(
  companyId: string,
  start: string,
  end: string
): Promise<AuditorPackFile> {
  const client = getFinanceClient();
  const { data: txns } = await client
    .from("fin_transactions")
    .select("id, txn_date, description, txn_type, amount, posted_by_agent, agent_version, confidence, status, posted_at")
    .eq("company_id", companyId)
    .gte("txn_date", start)
    .lte("txn_date", end)
    .order("txn_date");
  const rows = ["transaction_id,txn_date,description,txn_type,amount,agent,agent_version,confidence,status,posted_at"];
  for (const t of txns ?? []) {
    rows.push(
      [
        t.id,
        t.txn_date,
        `"${csvEscape((t.description as string) ?? "")}"`,
        t.txn_type,
        Number(t.amount).toFixed(2),
        t.posted_by_agent ?? "",
        t.agent_version ?? "",
        t.confidence ?? "",
        t.status,
        t.posted_at ?? "",
      ].join(",")
    );
  }
  return { filename: `journal-listing-${start}_${end}.csv`, csv: rows.join("\n") };
}

async function arListingCsv(
  companyId: string,
  start: string,
  end: string
): Promise<AuditorPackFile> {
  const client = getFinanceClient();
  const { data } = await client
    .from("fin_invoices")
    .select("id, invoice_number, customer_id, outlet_id, channel, invoice_date, due_date, subtotal, sst_amount, total, payment_status, paid_amount")
    .eq("company_id", companyId)
    .gte("invoice_date", start)
    .lte("invoice_date", end)
    .order("invoice_date");
  const rows = ["invoice_number,customer_id,outlet_id,channel,invoice_date,due_date,subtotal,sst,total,status,paid"];
  for (const r of data ?? []) {
    rows.push(
      [
        r.invoice_number,
        r.customer_id ?? "",
        r.outlet_id ?? "",
        r.channel,
        r.invoice_date,
        r.due_date ?? "",
        Number(r.subtotal).toFixed(2),
        Number(r.sst_amount).toFixed(2),
        Number(r.total).toFixed(2),
        r.payment_status,
        Number(r.paid_amount).toFixed(2),
      ].join(",")
    );
  }
  return { filename: `ar-listing-${start}_${end}.csv`, csv: rows.join("\n") };
}

async function apListingCsv(
  companyId: string,
  start: string,
  end: string
): Promise<AuditorPackFile> {
  const client = getFinanceClient();
  const { data } = await client
    .from("fin_bills")
    .select("id, supplier_id, bill_number, bill_date, due_date, outlet_id, subtotal, sst_amount, total, payment_status, paid_amount, scheduled_pay_date")
    .eq("company_id", companyId)
    .gte("bill_date", start)
    .lte("bill_date", end)
    .order("bill_date");
  const rows = ["bill_id,supplier_id,bill_number,bill_date,due_date,outlet_id,subtotal,sst,total,status,paid,scheduled_pay_date"];
  for (const r of data ?? []) {
    rows.push(
      [
        r.id,
        r.supplier_id ?? "",
        r.bill_number ?? "",
        r.bill_date,
        r.due_date ?? "",
        r.outlet_id ?? "",
        Number(r.subtotal).toFixed(2),
        Number(r.sst_amount).toFixed(2),
        Number(r.total).toFixed(2),
        r.payment_status,
        Number(r.paid_amount).toFixed(2),
        r.scheduled_pay_date ?? "",
      ].join(",")
    );
  }
  return { filename: `ap-listing-${start}_${end}.csv`, csv: rows.join("\n") };
}

async function fixedAssetCsv(companyId: string): Promise<AuditorPackFile> {
  const client = getFinanceClient();
  const { data } = await client
    .from("fin_fixed_assets")
    .select("id, account_code, outlet_id, description, acquired_date, cost, useful_life_months, accumulated_dep, status, disposed_date, disposed_amount")
    .eq("company_id", companyId)
    .order("acquired_date");
  const rows = ["asset_id,account_code,outlet_id,description,acquired_date,cost,useful_life_months,accumulated_dep,nbv,status,disposed_date,disposed_amount"];
  for (const r of data ?? []) {
    const cost = Number(r.cost);
    const acc = Number(r.accumulated_dep);
    rows.push(
      [
        r.id,
        r.account_code,
        r.outlet_id ?? "",
        `"${csvEscape((r.description as string) ?? "")}"`,
        r.acquired_date,
        cost.toFixed(2),
        r.useful_life_months,
        acc.toFixed(2),
        (cost - acc).toFixed(2),
        r.status,
        r.disposed_date ?? "",
        r.disposed_amount ?? "",
      ].join(",")
    );
  }
  return { filename: `fixed-assets.csv`, csv: rows.join("\n") };
}

async function sstCsv(companyId: string, fiscalYear: number): Promise<AuditorPackFile> {
  const client = getFinanceClient();
  const { data } = await client
    .from("fin_sst_filings")
    .select("period, output_tax, input_tax, net_payable, filing_status, filed_at, payment_ref")
    .eq("company_id", companyId)
    .like("period", `${fiscalYear}%`)
    .order("period");
  const rows = ["period,output_tax,input_tax,net_payable,status,filed_at,payment_ref"];
  for (const r of data ?? []) {
    rows.push(
      [
        r.period,
        Number(r.output_tax).toFixed(2),
        Number(r.input_tax).toFixed(2),
        Number(r.net_payable).toFixed(2),
        r.filing_status,
        r.filed_at ?? "",
        r.payment_ref ?? "",
      ].join(",")
    );
  }
  return { filename: `sst-${fiscalYear}.csv`, csv: rows.join("\n") };
}

async function auditLogCsv(
  companyId: string,
  start: string,
  end: string
): Promise<AuditorPackFile> {
  const client = getFinanceClient();
  // Audit log isn't company-scoped at the row level (it captures all fin_*
  // writes) but txns/bills/invoices it references are. We export everything
  // for the time window — auditors expect to see system actions.
  const { data } = await client
    .from("fin_audit_log")
    .select("id, table_name, row_id, action, actor, occurred_at")
    .gte("occurred_at", `${start}T00:00:00Z`)
    .lte("occurred_at", `${end}T23:59:59Z`)
    .order("occurred_at");
  const rows = ["id,table_name,row_id,action,actor,occurred_at"];
  for (const r of data ?? []) {
    rows.push(
      [
        r.id,
        r.table_name,
        r.row_id,
        r.action,
        r.actor ?? "",
        r.occurred_at,
      ].join(",")
    );
  }
  return { filename: `audit-log-${start}_${end}.csv`, csv: rows.join("\n") };
}

async function pnlCsv(companyId: string, start: string, end: string): Promise<AuditorPackFile> {
  const pnl = await buildPnl({ companyId, start, end });
  const rows = ["section,code,name,amount"];
  for (const l of pnl.income.lines) rows.push(`income,${l.code},"${csvEscape(l.name)}",${l.amount.toFixed(2)}`);
  rows.push(`income,TOTAL,"Total income",${pnl.income.total.toFixed(2)}`);
  for (const l of pnl.cogs.lines) rows.push(`cogs,${l.code},"${csvEscape(l.name)}",${l.amount.toFixed(2)}`);
  rows.push(`cogs,TOTAL,"Total COGS",${pnl.cogs.total.toFixed(2)}`);
  rows.push(`gross,GROSS,"Gross profit",${pnl.grossProfit.toFixed(2)}`);
  for (const l of pnl.expenses.lines) rows.push(`expense,${l.code},"${csvEscape(l.name)}",${l.amount.toFixed(2)}`);
  rows.push(`expense,TOTAL,"Total expenses",${pnl.expenses.total.toFixed(2)}`);
  rows.push(`net,NET,"Net income",${pnl.netIncome.toFixed(2)}`);
  return { filename: `pnl-${start}_${end}.csv`, csv: rows.join("\n") };
}

async function bsCsv(companyId: string, asOf: string): Promise<AuditorPackFile> {
  const bs = await buildBalanceSheet({ companyId, asOf });
  const rows = ["section,code,name,amount"];
  for (const l of bs.assets.lines) rows.push(`asset,${l.code},"${csvEscape(l.name)}",${l.amount.toFixed(2)}`);
  rows.push(`asset,TOTAL,"Total assets",${bs.assets.total.toFixed(2)}`);
  for (const l of bs.liabilities.lines) rows.push(`liability,${l.code},"${csvEscape(l.name)}",${l.amount.toFixed(2)}`);
  rows.push(`liability,TOTAL,"Total liabilities",${bs.liabilities.total.toFixed(2)}`);
  for (const l of bs.equity.lines) rows.push(`equity,${l.code},"${csvEscape(l.name)}",${l.amount.toFixed(2)}`);
  rows.push(`equity,TOTAL,"Total equity",${bs.equity.total.toFixed(2)}`);
  rows.push(`check,IMBAL,"Imbalance (should be 0)",${bs.imbalance.toFixed(2)}`);
  return { filename: `balance-sheet-${asOf}.csv`, csv: rows.join("\n") };
}

function csvEscape(s: string): string {
  return s.replace(/"/g, '""');
}
