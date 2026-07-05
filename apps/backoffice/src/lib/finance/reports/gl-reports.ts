// Trial Balance + General Ledger — the two foundational GL reports Bukku has
// and we lacked. Both read the posted double-entry ledger (fin_transactions +
// fin_journal_lines), now that the bank→GL bridge populates it.
//
//   Trial Balance  — every account's net balance on its natural side; total
//                    debits must equal total credits (the GL's self-proof).
//   General Ledger: one or more accounts' movements over a period with a
//                   running balance, a voucher reference and a best-effort
//                   contact per entry (the drill-down behind any figure).

import { getFinanceClient } from "../supabase";
import { prisma } from "@/lib/prisma";
import { deriveHintPhrase } from "../category-hints";
import { matchedInvoiceSummaries } from "./pnl-sourced-drill";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type AccountMeta = { name: string; type: string };

async function loadAccounts(): Promise<Map<string, AccountMeta>> {
  const client = getFinanceClient();
  const { data } = await client.from("fin_accounts").select("code, name, type");
  return new Map((data ?? []).map((a) => [a.code as string, { name: a.name as string, type: a.type as string }]));
}

type TxnInfo = { date: string; description: string; type: string; agent: string | null; agentVersion: string | null };

// Posted transaction ids for a company up to (and optionally from) a date.
// Paged, because opening-balance scans cover the whole ledger history and
// Supabase caps unpaged selects at 1000 rows.
async function postedTxns(companyId: string, opts: { from?: string; to: string }): Promise<Map<string, TxnInfo>> {
  const client = getFinanceClient();
  const out = new Map<string, TxnInfo>();
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    let q = client
      .from("fin_transactions")
      .select("id, txn_date, description, txn_type, posted_by_agent, agent_version")
      .eq("company_id", companyId)
      .eq("status", "posted")
      .lte("txn_date", opts.to)
      .order("txn_date", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (opts.from) q = q.gte("txn_date", opts.from);
    const { data } = await q;
    for (const t of data ?? []) {
      out.set(t.id as string, {
        date: t.txn_date as string,
        description: (t.description as string) ?? "",
        type: (t.txn_type as string) ?? "",
        agent: (t.posted_by_agent as string | null) ?? null,
        agentVersion: (t.agent_version as string | null) ?? null,
      });
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

type JournalLineRow = { transaction_id: string; account_code: string; debit: number; credit: number; memo: string | null };

async function* journalLinesFor(txnIds: string[], accountCodes?: string[]) {
  const client = getFinanceClient();
  const PAGE = 1000;
  for (let i = 0; i < txnIds.length; i += 200) {
    const chunk = txnIds.slice(i, i + 200);
    // Page within the chunk too: 200 txns can carry more than 1000 lines
    // (EOD sales journals post ~10 legs each).
    for (let offset = 0; ; offset += PAGE) {
      let q = client
        .from("fin_journal_lines")
        .select("transaction_id, account_code, debit, credit, memo")
        .in("transaction_id", chunk)
        .order("transaction_id", { ascending: true })
        .order("line_order", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (accountCodes?.length) q = accountCodes.length === 1 ? q.eq("account_code", accountCodes[0]) : q.in("account_code", accountCodes);
      const { data } = await q;
      yield (data ?? []) as JournalLineRow[];
      if (!data || data.length < PAGE) break;
    }
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

// ─── General Ledger (multi-account, with running balance) ───────────────────

// transactionId + postedByAgent let the UI expand any journal into its full
// legs (and, for bank-agent journals, the source bank statement lines).
// reference is the short voucher form of the journal id; contact is the
// best-effort counterparty (see deriveContacts below); actor carries the
// human name for manual journals (agent_version stores it).
export type GlEntry = {
  transactionId: string;
  reference: string;
  postedByAgent: string | null;
  actor: string | null;
  contact: string | null;
  date: string;
  txnType: string;
  description: string;
  memo: string | null;
  debit: number;
  credit: number;
  balance: number;
};

export type GlAccountLedger = {
  account: { code: string; name: string; type: string };
  opening: number;
  entries: GlEntry[];
  closing: number;
  totalDebit: number;
  totalCredit: number;
};

export type GeneralLedgerMulti = {
  companyId: string; start: string; end: string;
  accounts: GlAccountLedger[];
};

export type GeneralLedger = {
  companyId: string; accountCode: string; accountName: string; type: string;
  start: string; end: string;
  opening: number; entries: GlEntry[]; closing: number;
  totalDebit: number; totalCredit: number;
};

// Bank-agent journals: look up their source bank lines ONCE for the whole
// request, prefer the matched invoice's supplier name, else the payee phrase
// derived from the bank description (same helper hint-learning uses). Costs
// two batched queries per request regardless of entry count.
async function bankContacts(txnIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (txnIds.length === 0) return out;
  const lines = await prisma.bankStatementLine.findMany({
    where: { glTransactionId: { in: txnIds } },
    select: { glTransactionId: true, description: true, apInvoiceId: true },
    orderBy: { txnDate: "asc" },
  });
  const invById = await matchedInvoiceSummaries(lines.map((l) => l.apInvoiceId));
  const namesByTxn = new Map<string, string[]>();
  for (const l of lines) {
    if (!l.glTransactionId) continue;
    const inv = l.apInvoiceId ? invById.get(l.apInvoiceId) : undefined;
    const name = inv?.vendor ?? deriveHintPhrase(l.description ?? "");
    if (!name) continue;
    const arr = namesByTxn.get(l.glTransactionId) ?? [];
    if (!arr.includes(name)) { arr.push(name); namesByTxn.set(l.glTransactionId, arr); }
  }
  for (const id of txnIds) {
    const names = namesByTxn.get(id) ?? [];
    out.set(id, names.length === 0 ? null : names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`);
  }
  return out;
}

// Best-effort contact for one entry. Bank journals use the batched bank-line
// lookup; ar journals read the sales channel off the leg memo ("GrabFood
// sales, outlet, date"); manual journals show the person who posted.
function contactForEntry(txnId: string, t: TxnInfo, memo: string | null, bank: Map<string, string | null>): string | null {
  if (t.agent === "bank") return bank.get(txnId) ?? null;
  if (t.agent === "ar") {
    // Leg memos read "<Channel> sales <separator> <outlet> <date>"; the
    // separator is a dash variant, matched by escape so none appears here.
    const head = (memo ?? "").split(/\s+[\u2013\u2014-]\s+/)[0].replace(/\s+(sales|revenue)$/i, "").trim();
    return head || null;
  }
  if (t.agent === "manual") return t.agentVersion;
  return null;
}

export async function buildGeneralLedgerMulti(input: { companyId: string; accountCodes: string[]; start: string; end: string }): Promise<GeneralLedgerMulti> {
  const codes = [...new Set(input.accountCodes)];
  const meta = await loadAccounts();

  // Opening balances = net of everything strictly before `start` (for B/S
  // accounts the carried balance; for P&L accounts the period-to-date prior).
  // One pass over history for ALL requested accounts.
  const before = await postedTxns(input.companyId, { to: dayBefore(input.start) });
  const opening = new Map<string, number>();
  for await (const lines of journalLinesFor([...before.keys()], codes)) {
    for (const l of lines) {
      opening.set(l.account_code, round2((opening.get(l.account_code) ?? 0) + Number(l.debit) - Number(l.credit)));
    }
  }

  const inPeriod = await postedTxns(input.companyId, { from: input.start, to: input.end });
  type RawLine = { transactionId: string; memo: string | null; debit: number; credit: number };
  const rawByAccount = new Map<string, RawLine[]>(codes.map((c) => [c, []]));
  const usedTxnIds = new Set<string>();
  for await (const lines of journalLinesFor([...inPeriod.keys()], codes)) {
    for (const l of lines) {
      rawByAccount.get(l.account_code)?.push({
        transactionId: l.transaction_id,
        memo: l.memo,
        debit: round2(Number(l.debit)),
        credit: round2(Number(l.credit)),
      });
      usedTxnIds.add(l.transaction_id);
    }
  }

  // Contact derivation in ONE batched pass for the whole request.
  const bankTxnIds = [...usedTxnIds].filter((id) => inPeriod.get(id)?.agent === "bank");
  const bank = await bankContacts(bankTxnIds);

  const accounts: GlAccountLedger[] = codes.map((code) => {
    const m = meta.get(code);
    const raw = (rawByAccount.get(code) ?? [])
      .map((r) => ({ r, t: inPeriod.get(r.transactionId)! }))
      .sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : 0));
    const open = round2(opening.get(code) ?? 0);
    let running = open, totalDebit = 0, totalCredit = 0;
    const entries: GlEntry[] = raw.map(({ r, t }) => {
      running = round2(running + r.debit - r.credit);
      totalDebit = round2(totalDebit + r.debit);
      totalCredit = round2(totalCredit + r.credit);
      return {
        transactionId: r.transactionId,
        reference: r.transactionId.slice(0, 8).toUpperCase(),
        postedByAgent: t.agent,
        actor: t.agent === "manual" ? t.agentVersion : null,
        contact: contactForEntry(r.transactionId, t, r.memo, bank),
        date: t.date,
        txnType: t.type,
        description: t.description,
        memo: r.memo,
        debit: r.debit,
        credit: r.credit,
        balance: running,
      };
    });
    return {
      account: { code, name: m?.name ?? "(unknown account)", type: m?.type ?? "?" },
      opening: open,
      entries,
      closing: running,
      totalDebit,
      totalCredit,
    };
  });

  return { companyId: input.companyId, start: input.start, end: input.end, accounts };
}

// Single-account GL, the original shape. Delegates to the multi builder so
// both paths compute identically; existing consumers keep the same response
// (entries gain reference/contact/actor as additive fields).
export async function buildGeneralLedger(input: { companyId: string; accountCode: string; start: string; end: string }): Promise<GeneralLedger> {
  const multi = await buildGeneralLedgerMulti({ companyId: input.companyId, accountCodes: [input.accountCode], start: input.start, end: input.end });
  const a = multi.accounts[0];
  return {
    companyId: input.companyId,
    accountCode: a.account.code, accountName: a.account.name, type: a.account.type,
    start: input.start, end: input.end,
    opening: a.opening, entries: a.entries, closing: a.closing,
    totalDebit: a.totalDebit, totalCredit: a.totalCredit,
  };
}

function dayBefore(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
