// Trial Balance + General Ledger — the two foundational GL reports Bukku has
// and we lacked. Both read the posted double-entry ledger (fin_transactions +
// fin_journal_lines), now that the bank→GL bridge populates it.
//
//   Trial Balance  — every account's net balance on its natural side; total
//                    debits must equal total credits (the GL's self-proof).
//   General Ledger — one account's movements over a period with a running
//                    balance (the drill-down behind any figure).

import { getFinanceClient } from "../supabase";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type AccountMeta = { name: string; type: string };

async function loadAccounts(): Promise<Map<string, AccountMeta>> {
  const client = getFinanceClient();
  const { data } = await client.from("fin_accounts").select("code, name, type");
  return new Map((data ?? []).map((a) => [a.code as string, { name: a.name as string, type: a.type as string }]));
}

// Posted transaction ids for a company up to (and optionally from) a date.
async function postedTxns(companyId: string, opts: { from?: string; to: string }): Promise<Map<string, { date: string; description: string; type: string; agent: string | null }>> {
  const client = getFinanceClient();
  let q = client
    .from("fin_transactions")
    .select("id, txn_date, description, txn_type, posted_by_agent")
    .eq("company_id", companyId)
    .eq("status", "posted")
    .lte("txn_date", opts.to);
  if (opts.from) q = q.gte("txn_date", opts.from);
  const { data } = await q;
  return new Map((data ?? []).map((t) => [t.id as string, { date: t.txn_date as string, description: (t.description as string) ?? "", type: (t.txn_type as string) ?? "", agent: (t.posted_by_agent as string | null) ?? null }]));
}

async function* journalLinesFor(txnIds: string[], accountCode?: string) {
  const client = getFinanceClient();
  for (let i = 0; i < txnIds.length; i += 200) {
    const chunk = txnIds.slice(i, i + 200);
    let q = client.from("fin_journal_lines").select("transaction_id, account_code, debit, credit, memo").in("transaction_id", chunk);
    if (accountCode) q = q.eq("account_code", accountCode);
    const { data } = await q;
    yield (data ?? []) as { transaction_id: string; account_code: string; debit: number; credit: number; memo: string | null }[];
  }
}

// ─── Trial Balance ──────────────────────────────────────────────────────────

export type TbRow = { code: string; name: string; type: string; debit: number; credit: number };
export type TrialBalance = {
  companyId: string; asOf: string;
  rows: TbRow[];
  totalDebit: number; totalCredit: number; balanced: boolean;
};

export async function buildTrialBalance(input: { companyId: string; asOf: string }): Promise<TrialBalance> {
  const meta = await loadAccounts();
  const txns = await postedTxns(input.companyId, { to: input.asOf });
  const net = new Map<string, number>(); // account → debit−credit
  for await (const lines of journalLinesFor([...txns.keys()])) {
    for (const l of lines) {
      net.set(l.account_code, round2((net.get(l.account_code) ?? 0) + Number(l.debit) - Number(l.credit)));
    }
  }

  const rows: TbRow[] = [];
  let totalDebit = 0, totalCredit = 0;
  for (const [code, bal] of [...net.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (Math.abs(bal) < 0.005) continue;
    const m = meta.get(code);
    const debit = bal > 0 ? round2(bal) : 0;
    const credit = bal < 0 ? round2(-bal) : 0;
    rows.push({ code, name: m?.name ?? "(unknown account)", type: m?.type ?? "?", debit, credit });
    totalDebit = round2(totalDebit + debit);
    totalCredit = round2(totalCredit + credit);
  }
  return { companyId: input.companyId, asOf: input.asOf, rows, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 };
}

// ─── General Ledger (one account, with running balance) ─────────────────────

// transactionId + postedByAgent let the UI expand a bank-agent journal into
// its source bank statement lines (fix a wrong booking from the report).
export type GlEntry = { transactionId: string; postedByAgent: string | null; date: string; txnType: string; description: string; memo: string | null; debit: number; credit: number; balance: number };
export type GeneralLedger = {
  companyId: string; accountCode: string; accountName: string; type: string;
  start: string; end: string;
  opening: number; entries: GlEntry[]; closing: number;
  totalDebit: number; totalCredit: number;
};

export async function buildGeneralLedger(input: { companyId: string; accountCode: string; start: string; end: string }): Promise<GeneralLedger> {
  const meta = await loadAccounts();
  const am = meta.get(input.accountCode);

  // Opening balance = net of everything strictly before `start` (for B/S accounts
  // this is the carried balance; for P&L accounts the period-to-date prior).
  const before = await postedTxns(input.companyId, { to: dayBefore(input.start) });
  let opening = 0;
  for await (const lines of journalLinesFor([...before.keys()], input.accountCode)) {
    for (const l of lines) opening = round2(opening + Number(l.debit) - Number(l.credit));
  }

  const inPeriod = await postedTxns(input.companyId, { from: input.start, to: input.end });
  const raw: { transactionId: string; postedByAgent: string | null; date: string; txnType: string; description: string; memo: string | null; debit: number; credit: number }[] = [];
  for await (const lines of journalLinesFor([...inPeriod.keys()], input.accountCode)) {
    for (const l of lines) {
      const t = inPeriod.get(l.transaction_id)!;
      raw.push({ transactionId: l.transaction_id, postedByAgent: t.agent, date: t.date, txnType: t.type, description: t.description, memo: l.memo, debit: round2(Number(l.debit)), credit: round2(Number(l.credit)) });
    }
  }
  raw.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let running = opening, totalDebit = 0, totalCredit = 0;
  const entries: GlEntry[] = raw.map((r) => {
    running = round2(running + r.debit - r.credit);
    totalDebit = round2(totalDebit + r.debit);
    totalCredit = round2(totalCredit + r.credit);
    return { ...r, balance: running };
  });

  return {
    companyId: input.companyId, accountCode: input.accountCode, accountName: am?.name ?? "(unknown)", type: am?.type ?? "?",
    start: input.start, end: input.end, opening: round2(opening), entries, closing: running, totalDebit, totalCredit,
  };
}

function dayBefore(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
