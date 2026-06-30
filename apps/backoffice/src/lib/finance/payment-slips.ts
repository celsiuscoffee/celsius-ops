// Wage / non-supplier outflows (PT-week part-timers, full-time salary) have no
// supplier invoice to reconcile against. Instead of leaving them unmatched, the
// loop auto-generates a PAYMENT SLIP — the wage-equivalent of an invoice — as a
// fin_documents row keyed to the bank line. Every cash-out then has a supporting
// doc, and these stop polluting the AP review queue (the matcher already skips
// these categories; see ap-match.ts NON_SUPPLIER_CATEGORIES).

import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { getFinanceClient } from "./supabase";
import { companyFromAccountName } from "./gl-posting-map";

// Categories that get a payment slip (wage runs paid straight from the bank).
const SLIP_CATEGORIES = ["PARTIMER", "EMPLOYEE_SALARY"] as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Best-effort pay-period label from the bank narrative ("PT Week 23", "Salary Jun").
function parsePeriod(desc: string): string | null {
  const wk = desc.match(/\b(?:PT\s*)?(?:WEEK|WK)\s*(\d{1,2})\b/i);
  if (wk) return `Week ${wk[1]}`;
  const mon = desc.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\b/i);
  return mon ? mon[0].slice(0, 3) : null;
}

export type PaymentSlipResult = {
  committed: boolean;
  scanned: number;
  created: number;
  alreadySlipped: number;
  byCategory: { category: string; created: number; amount: number }[];
};

// Create payment slips for wage bank lines that don't have one yet. Idempotent:
// a slip's source_ref is the bank line id, so re-runs only fill gaps. Dry-run by
// default.
export async function createWagePaymentSlips(
  opts: { commit?: boolean; sinceDays?: number } = {},
): Promise<PaymentSlipResult> {
  const commit = opts.commit ?? false;

  const lines = await prisma.bankStatementLine.findMany({
    where: {
      direction: "DR",
      category: { in: [...SLIP_CATEGORIES] },
      ...(opts.sinceDays ? { txnDate: { gte: new Date(Date.now() - opts.sinceDays * 86_400_000) } } : {}),
    },
    select: {
      id: true, txnDate: true, description: true, amount: true, category: true, outletId: true,
      statement: { select: { accountName: true } },
    },
    orderBy: { txnDate: "desc" },
  });

  const client = getFinanceClient();

  // Which of these already have a slip? (source_ref = bank line id)
  const existing = new Set<string>();
  const ids = lines.map((l) => l.id);
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    if (!chunk.length) break;
    const { data, error } = await client
      .from("fin_documents")
      .select("source_ref")
      .eq("doc_type", "payment_slip")
      .in("source_ref", chunk);
    if (error) throw error;
    (data ?? []).forEach((d: { source_ref: string | null }) => { if (d.source_ref) existing.add(d.source_ref); });
  }

  const toCreate = lines.filter((l) => !existing.has(l.id));

  const byCat = new Map<string, { created: number; amount: number }>();
  for (const l of toCreate) {
    const cat = l.category as string;
    const agg = byCat.get(cat) ?? { created: 0, amount: 0 };
    agg.created++; agg.amount = round2(agg.amount + Number(l.amount));
    byCat.set(cat, agg);
  }

  if (commit && toCreate.length) {
    const rows = toCreate.map((l) => ({
      id: randomUUID(),
      source: "bank-feed",
      source_ref: l.id,
      doc_type: "payment_slip",
      outlet_id: l.outletId ?? null,
      company_id: companyFromAccountName(l.statement.accountName),
      raw_text: l.description,
      metadata: {
        category: l.category,
        amount: round2(Number(l.amount)),
        period: parsePeriod(l.description ?? ""),
        bankDesc: (l.description ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
        txnDate: ymd(l.txnDate),
      },
      status: "auto",
      received_at: l.txnDate.toISOString(),
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await client.from("fin_documents").insert(rows.slice(i, i + 500));
      if (error) throw error;
    }
  }

  return {
    committed: commit,
    scanned: lines.length,
    created: toCreate.length,
    alreadySlipped: existing.size,
    byCategory: [...byCat.entries()].map(([category, v]) => ({ category, created: v.created, amount: v.amount })).sort((a, b) => b.amount - a.amount),
  };
}
