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
import { prisma } from "@/lib/prisma";
import { accumulatedDepreciation, listFixedAssets, netBookValue } from "../fixed-assets";
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
  // Live AR source: the EOD sales agent's posted ar_invoice journals
  // (fin_invoices was never populated and is tombstoned — migration 097).
  const client = getFinanceClient();
  const { data } = await client
    .from("fin_transactions")
    .select("id, txn_date, description, outlet_id, amount, posted_by_agent, status")
    .eq("company_id", companyId)
    .eq("txn_type", "ar_invoice")
    .eq("status", "posted")
    .gte("txn_date", start)
    .lte("txn_date", end)
    .order("txn_date");
  const rows = ["txn_id,txn_date,description,outlet_id,amount,posted_by,status"];
  for (const r of data ?? []) {
    rows.push(
      [
        r.id,
        r.txn_date,
        JSON.stringify(r.description ?? ""),
        r.outlet_id ?? "",
        Number(r.amount).toFixed(2),
        r.posted_by_agent ?? "",
        r.status,
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
  // Live AP source: the procurement Invoice table (fin_bills was never
  // populated and is tombstoned — migration 097). Amounts are FULL invoice
  // totals even when PARTIALLY_PAID (warehouse contract). Company scoping
  // goes through the outlet→company mapping.
  const client = getFinanceClient();
  const { data: mappings } = await client
    .from("fin_outlet_companies")
    .select("outlet_id")
    .eq("company_id", companyId);
  const outletIds = (mappings ?? []).map((m) => m.outlet_id as string);
  const invoices = outletIds.length
    ? await prisma.invoice.findMany({
        where: {
          outletId: { in: outletIds },
          issueDate: { gte: new Date(start), lte: new Date(`${end}T23:59:59.999Z`) },
        },
        orderBy: { issueDate: "asc" },
        select: {
          id: true, supplierId: true, invoiceNumber: true, issueDate: true,
          dueDate: true, outletId: true, amount: true, status: true,
          paymentType: true, expenseCategory: true,
        },
      })
    : [];
  const rows = ["invoice_id,supplier_id,invoice_number,issue_date,due_date,outlet_id,amount,status,payment_type,expense_category"];
  for (const r of invoices) {
    rows.push(
      [
        r.id,
        r.supplierId ?? "",
        r.invoiceNumber,
        r.issueDate.toISOString().slice(0, 10),
        r.dueDate ? r.dueDate.toISOString().slice(0, 10) : "",
        r.outletId,
        Number(r.amount).toFixed(2),
        r.status,
        r.paymentType ?? "",
        r.expenseCategory,
      ].join(",")
    );
  }
  return { filename: `ap-listing-${start}_${end}.csv`, csv: rows.join("\n") };
}

async function fixedAssetCsv(companyId: string): Promise<AuditorPackFile> {
  // Real register export. Accumulated depreciation and NBV are DERIVED from
  // the same straight-line engine the P&L and GL posting use (one month
  // convention everywhere), computed as of today.
  const assets = await listFixedAssets(companyId);
  const today = new Date().toISOString().slice(0, 10);
  const rows = ["asset_id,name,company,account_code,outlet_id,acquired_date,cost,residual,useful_life_months,accumulated_dep,nbv,status,disposed_date"];
  for (const a of assets) {
    const acc = accumulatedDepreciation(a, today);
    rows.push(
      [
        a.id,
        `"${csvEscape(a.name)}"`,
        a.companyId ?? "",
        a.accountCode,
        a.outletId ?? "",
        a.acquiredDate,
        a.cost.toFixed(2),
        a.residual.toFixed(2),
        a.usefulLifeMonths,
        acc.toFixed(2),
        netBookValue(a, today).toFixed(2),
        a.status,
        a.disposedDate ?? "",
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
