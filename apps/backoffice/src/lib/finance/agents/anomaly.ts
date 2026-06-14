// Anomaly agent — IO shell around the pure detectors (anomaly-detectors.ts).
//
// Loads bills + posted transactions (with journal-line sums) + per-supplier
// bill history for a date range, runs the detectors, and raises one idempotent
// fin_exceptions row per finding. Always-exception by design — it never posts,
// it only surfaces. The inbox resolves what it raises.

import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { getFinanceClient, setActor } from "../supabase";
import { runDetectors, type AnomalyFinding, type BillRow, type TxnRow } from "./anomaly-detectors";

export const ANOMALY_VERSION = "anomaly-v1";

export type AnomalySummary = {
  from: string;
  to: string;
  billsScanned: number;
  txnsScanned: number;
  findings: Record<AnomalyFinding["type"], number>;
  raised: number;
  skippedExisting: number;
};

function monthsBefore(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00+08:00`);
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

export async function runAnomalySweep(opts: { from: string; to: string }): Promise<AnomalySummary> {
  const client = getFinanceClient();
  await setActor(client, ANOMALY_VERSION);

  // Bills in range.
  const { data: billRows, error: billErr } = await client
    .from("fin_bills")
    .select("id, company_id, supplier_id, bill_number, bill_date, total, source_doc_id")
    .gte("bill_date", opts.from)
    .lte("bill_date", opts.to)
    .limit(20000);
  if (billErr) throw billErr;

  // Supplier names (Prisma) for nicer outlier messages.
  const supplierIds = [...new Set((billRows ?? []).map((b) => b.supplier_id).filter((s): s is string => !!s))];
  const supplierNames = new Map<string, string>();
  if (supplierIds.length) {
    const suppliers = await prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true } });
    for (const s of suppliers) supplierNames.set(s.id, s.name);
  }

  const bills: BillRow[] = (billRows ?? []).map((b) => ({
    id: b.id as string,
    companyId: (b.company_id as string) ?? null,
    supplierId: (b.supplier_id as string) ?? null,
    supplierName: b.supplier_id ? supplierNames.get(b.supplier_id as string) ?? null : null,
    billNumber: (b.bill_number as string) ?? null,
    billDate: b.bill_date as string,
    total: Number(b.total),
    sourceDocId: (b.source_doc_id as string) ?? null,
  }));

  // Per-supplier history: the prior 12 months of bills before the window.
  const historyBySupplier = new Map<string, number[]>();
  if (supplierIds.length) {
    const histFrom = monthsBefore(opts.from, 12);
    const { data: histRows, error: histErr } = await client
      .from("fin_bills")
      .select("supplier_id, total")
      .in("supplier_id", supplierIds)
      .gte("bill_date", histFrom)
      .lt("bill_date", opts.from)
      .limit(50000);
    if (histErr) throw histErr;
    for (const h of histRows ?? []) {
      if (!h.supplier_id) continue;
      const list = historyBySupplier.get(h.supplier_id as string) ?? [];
      list.push(Number(h.total));
      historyBySupplier.set(h.supplier_id as string, list);
    }
  }

  // Posted transactions in range + their journal-line sums.
  const { data: txnRows, error: txnErr } = await client
    .from("fin_transactions")
    .select("id, company_id, txn_type, status, source_doc_id")
    .eq("status", "posted")
    .gte("txn_date", opts.from)
    .lte("txn_date", opts.to)
    .limit(20000);
  if (txnErr) throw txnErr;

  const txnIds = (txnRows ?? []).map((t) => t.id as string);
  const sums = new Map<string, { debit: number; credit: number }>();
  for (let i = 0; i < txnIds.length; i += 1000) {
    const chunk = txnIds.slice(i, i + 1000);
    const { data: lineRows, error: lineErr } = await client
      .from("fin_journal_lines")
      .select("transaction_id, debit, credit")
      .in("transaction_id", chunk)
      .limit(100000);
    if (lineErr) throw lineErr;
    for (const l of lineRows ?? []) {
      const s = sums.get(l.transaction_id as string) ?? { debit: 0, credit: 0 };
      s.debit += Number(l.debit ?? 0);
      s.credit += Number(l.credit ?? 0);
      sums.set(l.transaction_id as string, s);
    }
  }

  const txns: TxnRow[] = (txnRows ?? []).map((t) => {
    const s = sums.get(t.id as string) ?? { debit: 0, credit: 0 };
    return {
      id: t.id as string,
      companyId: (t.company_id as string) ?? null,
      txnType: t.txn_type as string,
      status: t.status as string,
      sourceDocId: (t.source_doc_id as string) ?? null,
      sumDebit: s.debit,
      sumCredit: s.credit,
    };
  });

  const findings = runDetectors({ bills, txns, historyBySupplier });

  const counts: Record<AnomalyFinding["type"], number> = { duplicate: 0, out_of_balance: 0, missing_doc: 0, anomaly: 0 };
  let raised = 0;
  let skippedExisting = 0;
  for (const f of findings) {
    counts[f.type] += 1;
    const created = await raiseAnomalyException(client, f);
    if (created) raised += 1;
    else skippedExisting += 1;
  }

  return {
    from: opts.from,
    to: opts.to,
    billsScanned: bills.length,
    txnsScanned: txns.length,
    findings: counts,
    raised,
    skippedExisting,
  };
}

// Idempotent: one open exception per (related_type, related_id, type).
async function raiseAnomalyException(
  client: ReturnType<typeof getFinanceClient>,
  f: AnomalyFinding
): Promise<boolean> {
  const { data: existing } = await client
    .from("fin_exceptions")
    .select("id")
    .eq("related_type", f.relatedType)
    .eq("related_id", f.relatedId)
    .eq("type", f.type)
    .eq("status", "open")
    .maybeSingle();
  if (existing?.id) return false;

  const { error } = await client.from("fin_exceptions").insert({
    id: randomUUID(),
    company_id: f.companyId,
    type: f.type,
    related_type: f.relatedType,
    related_id: f.relatedId,
    agent: "anomaly",
    reason: f.reason,
    proposed_action: f.proposed ?? {},
    priority: f.priority,
    status: "open",
  });
  if (error) throw error;
  return true;
}
