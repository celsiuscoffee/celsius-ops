// Bukku bank-feed adapter — pure mapping (no IO).
//
// Bukku has no raw bank-feed-line endpoint; its bank module exposes reconciled
// "Money In" (/banking/incomes) and "Money Out" (/banking/expenses) entries.
// We treat Bukku as a bank MIRROR: take date / amount / description / reference
// / bank account from each entry and discard Bukku's GL coding, then land them
// in fin_bank_transactions for OUR Matcher. This keeps "no external system of
// record" intact (see docs/finance-module-spec.md).
//
// Verified against the live Bukku Bank API spec + example responses
// (developers.bukku.my/specs/bukku-bank-api.yaml). Amounts are RM floats
// (positive on both endpoints); incomes are inflows (+), expenses outflows (−).
// The bank/cash account is on deposit_items[].account_code; Bukku's COA codes
// match ours (our COA was seeded from Bukku), so the code maps straight to
// fin_bank_transactions.bank_account_code.

import type { BankLineInput } from "./bank-feed-build";

export type BukkuDepositItem = {
  account_id?: number | null;
  account_code?: string | null;
  account_name?: string | null;
  amount?: number | null;
};

export type BukkuBankTxn = {
  id: number;
  number?: string | null; // doc number, e.g. OR-00001 / PV-00003
  number2?: string | null; // secondary reference
  date: string; // YYYY-MM-DD
  amount?: number | null; // RM, positive on both endpoints
  description?: string | null;
  status?: string | null; // 'ready' | 'draft' | 'void'
  account_id?: number | null;
  deposit_items?: BukkuDepositItem[] | null;
};

export type BukkuListResponse = {
  transactions?: BukkuBankTxn[];
  paging?: { current_page: number; per_page: number; total: number };
};

export type BukkuDirection = "income" | "expense";

// Map one Bukku transaction to a bank line. Returns null for entries we can't
// or shouldn't reconcile (voided/draft, no bank account, zero amount).
export function mapBukkuTxn(txn: BukkuBankTxn, direction: BukkuDirection): BankLineInput | null {
  const status = (txn.status ?? "").toLowerCase();
  if (status && status !== "ready" && status !== "paid") return null; // only posted entries

  const acct = (txn.deposit_items ?? []).find((d) => d.account_code)?.account_code ?? null;
  if (!acct) return null; // no bank account → can't reconcile

  const amt = Number(txn.amount ?? 0);
  if (!Number.isFinite(amt) || amt === 0) return null;

  return {
    bankAccountCode: acct,
    date: (txn.date ?? "").slice(0, 10),
    amount: direction === "expense" ? -amt : amt,
    description: txn.description ?? txn.number ?? "(no description)",
    reference: txn.number ?? txn.number2 ?? null,
    rawLineId: null,
  };
}

export function mapBukkuTransactions(incomes: BukkuBankTxn[], expenses: BukkuBankTxn[]): BankLineInput[] {
  const out: BankLineInput[] = [];
  for (const t of incomes) {
    const line = mapBukkuTxn(t, "income");
    if (line) out.push(line);
  }
  for (const t of expenses) {
    const line = mapBukkuTxn(t, "expense");
    if (line) out.push(line);
  }
  return out;
}
