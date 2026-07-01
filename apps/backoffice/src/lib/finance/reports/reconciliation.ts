// Bank Reconciliation: sales rung up vs settlements received, per channel, off
// the double-entry ledger. Each channel is a debtor account: sales debit it
// (recognised), the bank settlement credits it (received). The net is the
// unreconciled balance, which resolves to known economics: card is settlement
// timing, grab is commission (~43%) plus timing, and the Cash & QR residual is
// online-banking/e-wallet settlements still parked in Suspense (physical cash is
// negligible), pending reclassification to clear the debtor.
//
// This is the cash-IN reconciliation (vs /finance/recon which is cash-OUT AP).

import { getFinanceClient } from "../supabase";

function round2(n: number): number { return Math.round(n * 100) / 100; }

const CHANNELS: { code: string; label: string; note: string }[] = [
  { code: "1006", label: "Card", note: "gap is settlement timing (T+1-2)" },
  { code: "1005", label: "GrabFood", note: "gap is Grab commission (~43%) plus payout timing" },
  { code: "1000-02", label: "Cash & QR", note: "physical cash is negligible; remaining gap is online-banking/e-wallet settlements still parked in Suspense (1999), not yet reclassified to clear this debtor" },
];

export type ReconChannel = {
  code: string; label: string; note: string;
  salesRecognised: number; settledToBank: number; unreconciled: number; pct: number | null;
  months: { month: string; sales: number; settled: number; net: number }[];
};
export type BankReconciliation = {
  companyId: string | null; start: string; end: string;
  channels: ReconChannel[];
  totals: { salesRecognised: number; settledToBank: number; unreconciled: number };
};

export async function buildBankReconciliation(input: { start: string; end: string; companyId?: string | null }): Promise<BankReconciliation> {
  const client = getFinanceClient();

  // Posted transactions in range (optionally one company), keyed to their date.
  let tq = client.from("fin_transactions").select("id, txn_date").eq("status", "posted")
    .gte("txn_date", input.start).lte("txn_date", input.end);
  if (input.companyId) tq = tq.eq("company_id", input.companyId);
  const { data: txns } = await tq;
  const txnDate = new Map((txns ?? []).map((t) => [t.id as string, (t.txn_date as string).slice(0, 7)]));
  const txnIds = [...txnDate.keys()];

  // Debit/credit per debtor account per month.
  const perAcct = new Map<string, Map<string, { d: number; c: number }>>();
  for (const c of CHANNELS) perAcct.set(c.code, new Map());
  for (let i = 0; i < txnIds.length; i += 200) {
    const chunk = txnIds.slice(i, i + 200);
    if (!chunk.length) break;
    const { data: lines } = await client.from("fin_journal_lines")
      .select("transaction_id, account_code, debit, credit")
      .in("transaction_id", chunk)
      .in("account_code", CHANNELS.map((c) => c.code));
    for (const l of lines ?? []) {
      const m = txnDate.get(l.transaction_id as string); if (!m) continue;
      const byMonth = perAcct.get(l.account_code as string); if (!byMonth) continue;
      const cur = byMonth.get(m) ?? { d: 0, c: 0 };
      cur.d = round2(cur.d + Number(l.debit)); cur.c = round2(cur.c + Number(l.credit));
      byMonth.set(m, cur);
    }
  }

  const channels: ReconChannel[] = CHANNELS.map((c) => {
    const byMonth = perAcct.get(c.code)!;
    const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, v]) => ({ month, sales: v.d, settled: v.c, net: round2(v.d - v.c) }));
    const salesRecognised = round2(months.reduce((s, m) => s + m.sales, 0));
    const settledToBank = round2(months.reduce((s, m) => s + m.settled, 0));
    const unreconciled = round2(salesRecognised - settledToBank);
    return { ...c, salesRecognised, settledToBank, unreconciled, pct: salesRecognised ? round2((unreconciled / salesRecognised) * 100) : null, months };
  });

  return {
    companyId: input.companyId ?? null, start: input.start, end: input.end, channels,
    totals: {
      salesRecognised: round2(channels.reduce((s, c) => s + c.salesRecognised, 0)),
      settledToBank: round2(channels.reduce((s, c) => s + c.settledToBank, 0)),
      unreconciled: round2(channels.reduce((s, c) => s + c.unreconciled, 0)),
    },
  };
}
