// Bank-feed landing zone (pure) — normalizes a bank line from ANY source
// (Bukku API, Maybank CSV, a test fixture) into a fin_bank_transactions row.
//
// Source-agnostic on purpose: the Bukku adapter only has to map its response
// to BankLineInput, then call ingestBankLines (bank-feed.ts). No IO here.
//
// Dedupe gotcha handled: fin_bank_transactions is unique on
// (bank_account_code, txn_date, amount, description, reference). In Postgres,
// NULLs in a unique constraint are DISTINCT, so two NULL-reference re-imports
// would NOT dedupe. We coerce an absent reference to "" (and an absent
// description to a placeholder, since the column is NOT NULL) so the composite
// key is fully non-null and re-imports are truly idempotent.

import { randomUUID } from "crypto";

export type BankLineInput = {
  bankAccountCode: string; // fin_accounts.code, e.g. "1000-01"
  date: string; // YYYY-MM-DD
  amount: number; // signed: + inflow, − outflow
  description?: string | null;
  reference?: string | null;
  rawLineId?: string | null; // FK to BankStatementLine, if sourced from one
};

export type BankTxnRow = {
  id: string;
  bank_account_code: string;
  txn_date: string;
  amount: number;
  description: string;
  reference: string; // "" when absent — see dedupe note above
  raw_line_id: string | null;
  status: "unmatched";
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function buildBankTxnRow(
  input: BankLineInput
): { ok: true; row: BankTxnRow } | { ok: false; error: string } {
  const code = (input.bankAccountCode || "").trim();
  if (!code) return { ok: false, error: "missing bankAccountCode" };
  if (!DATE_RE.test(input.date)) return { ok: false, error: `invalid date "${input.date}"` };
  const amt = Number(input.amount);
  if (!Number.isFinite(amt) || amt === 0) return { ok: false, error: `invalid amount "${input.amount}"` };

  const description = (input.description ?? "").trim() || "(no description)";
  const reference = (input.reference ?? "").trim();

  return {
    ok: true,
    row: {
      id: randomUUID(),
      bank_account_code: code,
      txn_date: input.date,
      amount: Math.round(amt * 100) / 100,
      description,
      reference,
      raw_line_id: input.rawLineId ?? null,
      status: "unmatched",
    },
  };
}

// Composite dedupe key — mirrors the table's unique constraint exactly.
export function bankTxnKey(r: {
  bank_account_code: string;
  txn_date: string;
  amount: number;
  description: string;
  reference: string;
}): string {
  return [r.bank_account_code, r.txn_date, r.amount.toFixed(2), r.description, r.reference].join("|");
}

// Drop intra-batch duplicates before the upsert (first occurrence wins).
export function dedupeRows(rows: BankTxnRow[]): BankTxnRow[] {
  const seen = new Set<string>();
  const out: BankTxnRow[] = [];
  for (const r of rows) {
    const k = bankTxnKey(r);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(r);
    }
  }
  return out;
}
