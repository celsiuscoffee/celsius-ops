// Bank-feed → General Ledger posting bridge (the loop's POST step).
//
// Every classified BankStatementLine is a real cash movement that, until now,
// drove the cashflow/P&L *views* but never hit the double-entry ledger — which
// is why the Balance Sheet and Cash Flow were "draft". This posts them.
//
// Model: the EOD Sales agent already accrues daily revenue into DEBTOR accounts
// (Dr 1006 card / 1005 grab / 1000-02 cash+QR, Cr 5000-xx income). So a bank
// INFLOW does not re-recognise income — it CLEARS the debtor that EOD created.
// A bank OUTFLOW recognises the expense/asset/liability at payment (cash basis).
// Either way BANK_CASH (1000-01) is one leg and the mapped contra is the other,
// with the line's direction deciding which side the bank sits on.
//
// Volume: there are tens of thousands of micro-settlements, so lines are
// AGGREGATED into one journal per (company, outlet, category, day) — how a
// bookkeeper posts, and it keeps the ledger legible while still tying out to the
// bank to the cent.
//
// Idempotency is TWO-layered, because line ids are not stable: the Bukku feed
// sync rebuilds its whole window (delete + recreate) every run, which would
// otherwise re-post the window as fresh journals each cycle (this is exactly
// what triple-counted June 2026 before).
//   1. Line layer — each posted line is stamped glTransactionId, so a stamped
//      line is never posted again (and the feed sync now carries stamps across
//      its rebuild).
//   2. Journal layer — each journal's identity is DETERMINISTIC:
//      source_doc_id = md5(company|outlet|contra|day|direction). If a journal
//      for the group already exists, it is REUSED: unlinked (rebuilt) lines are
//      re-stamped onto it, and genuinely new lines for an already-posted day
//      fold in by updating the journal amount (additive).
// A GC pass then deletes bank journals no line references (orphans left by
// rebuilds under older rules) — run only when the backlog fully drained, so a
// bounded run never deletes journals whose lines it hasn't reached yet.

import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { postJournal } from "./ledger";
import { getFinanceClient } from "./supabase";
import type { JournalLineInput } from "./types";
import { BANK_CASH, companyFromAccountName, resolveContra, round2, SKIP_CATS } from "./gl-posting-map";

// Deterministic journal identity for a (company, outlet, contra, day, direction)
// aggregate. Formatted as a UUID so it fits fin_transactions.source_doc_id and
// matches postgres md5(text)::uuid — SQL backfills can reproduce it exactly.
export function bankJournalKey(company: string, outletId: string | null, contra: string, date: string, direction: string): string {
  const h = createHash("md5").update(`bank-gl|${company}|${outletId ?? ""}|${contra}|${date}|${direction}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export { CONTRA_ACCOUNT, companyFromAccountName, contraFor, resolveContra } from "./gl-posting-map";

type Group = {
  company: string;
  outletId: string | null;
  contra: string;        // resolved contra account (control/inter-co/expense/…)
  suspense: boolean;
  category: string;      // representative category, for labelling
  date: string;          // YYYY-MM-DD
  direction: "CR" | "DR";
  amount: number;
  lineIds: string[];
};

export type GlPostResult = {
  committed: boolean;
  scannedLines: number;
  journals: number;        // journals posted (or that would post)
  reusedJournals: number;  // groups folded into an existing deterministic journal
  gcJournals: number;      // orphaned bank journals deleted (no line references)
  postedLines: number;     // bank lines that landed in a journal
  skippedLines: number;    // TRANSFER_NOT_SUCCESSFUL
  suspenseLines: number;   // parked in 1999
  totalDebit: number;
  totalCredit: number;
  byCategory: { category: string; account: string; direction: string; journals: number; lines: number; amount: number; suspense: boolean }[];
  errors: { company: string; category: string; date: string; error: string }[];
};

// Post all not-yet-posted classified bank lines into the ledger. Dry-run by
// default (commit:false) — returns the journals it *would* post plus a coverage
// breakdown so the result can be eyeballed before anything hits the GL.
export async function postBankLinesToGl(
  opts: { commit?: boolean; sinceDays?: number; limit?: number } = {},
): Promise<GlPostResult> {
  const commit = opts.commit ?? false;

  const lines = await prisma.bankStatementLine.findMany({
    where: {
      category: { not: null },
      glTransactionId: null,
      ...(opts.sinceDays ? { txnDate: { gte: new Date(Date.now() - opts.sinceDays * 86_400_000) } } : {}),
    },
    select: {
      id: true, txnDate: true, amount: true, direction: true, category: true, description: true, outletId: true,
      statement: { select: { accountName: true } },
    },
    orderBy: { txnDate: "asc" },
    take: opts.limit,
  });

  // Resolve the contra account per line (so statutory splits by type and inter-co
  // routes by counterparty), then aggregate into one journal per
  // (company, outlet, CONTRA account, day, direction).
  const groups = new Map<string, Group>();
  let skippedLines = 0;
  for (const l of lines) {
    const category = l.category as string;
    if (SKIP_CATS.has(category)) { skippedLines++; continue; }
    const company = companyFromAccountName(l.statement.accountName);
    const date = l.txnDate.toISOString().slice(0, 10);
    const direction = l.direction as "CR" | "DR";
    const { code: contra, suspense } = resolveContra(category, l.description ?? "");
    const key = [company, l.outletId ?? "", contra, date, direction].join("|");
    const g = groups.get(key);
    if (g) { g.amount = round2(g.amount + Number(l.amount)); g.lineIds.push(l.id); }
    else groups.set(key, { company, outletId: l.outletId, contra, suspense, category, date, direction, amount: round2(Number(l.amount)), lineIds: [l.id] });
  }

  const byCat = new Map<string, { account: string; direction: string; journals: number; lines: number; amount: number; suspense: boolean }>();
  const errors: GlPostResult["errors"] = [];
  const fin = getFinanceClient();
  let journals = 0, reusedJournals = 0, postedLines = 0, suspenseLines = 0, totalDebit = 0, totalCredit = 0;

  for (const g of groups.values()) {
    if (g.amount <= 0) continue;
    const contra = g.contra;
    // CR = money in → Dr Bank, Cr contra. DR = money out → Dr contra, Cr Bank.
    const journalLines: JournalLineInput[] = g.direction === "CR"
      ? [{ accountCode: BANK_CASH, debit: g.amount, outletId: g.outletId }, { accountCode: contra, credit: g.amount, outletId: g.outletId }]
      : [{ accountCode: contra, debit: g.amount, outletId: g.outletId }, { accountCode: BANK_CASH, credit: g.amount, outletId: g.outletId }];

    const ck = `${g.category}|${contra}|${g.direction}`;
    const agg = byCat.get(ck) ?? { account: contra, direction: g.direction, journals: 0, lines: 0, amount: 0, suspense: g.suspense };
    agg.journals++; agg.lines += g.lineIds.length; agg.amount = round2(agg.amount + g.amount);
    byCat.set(ck, agg);

    journals++;
    postedLines += g.lineIds.length;
    if (g.suspense) suspenseLines += g.lineIds.length;
    totalDebit = round2(totalDebit + g.amount);
    totalCredit = round2(totalCredit + g.amount);

    if (!commit) continue;
    try {
      const key = bankJournalKey(g.company, g.outletId, contra, g.date, g.direction);
      const { data: existingRows, error: exErr } = await fin
        .from("fin_transactions")
        .select("id, amount")
        .eq("source_doc_id", key)
        .eq("posted_by_agent", "bank")
        .eq("status", "posted")
        .limit(1);
      if (exErr) throw new Error(exErr.message);
      const existing = existingRows?.[0];

      let txnId: string;
      if (!existing) {
        const desc = `Bank ${g.direction === "CR" ? "receipts" : "payments"} — ${g.category}→${contra} ${g.date} (${g.lineIds.length} line${g.lineIds.length > 1 ? "s" : ""})`;
        const res = await postJournal({
          companyId: g.company,
          txnDate: g.date,
          description: desc,
          txnType: "payment",
          outletId: g.outletId,
          agent: "bank",
          agentVersion: "bank-gl-v1",
          confidence: 1,
          sourceDocId: key,
          lines: journalLines,
        });
        txnId = res.transactionId;
      } else {
        // A journal for this (company, outlet, contra, day, direction) exists.
        // If lines still reference it, this group is a late arrival for the day
        // → fold in additively. If none do (the feed rebuild dropped them), the
        // group IS the day again → the journal amount is replaced.
        txnId = existing.id as string;
        const linked = await prisma.bankStatementLine.count({ where: { glTransactionId: txnId } });
        const newTotal = round2((linked > 0 ? Number(existing.amount) : 0) + g.amount);
        const { data: jls, error: jlErr } = await fin
          .from("fin_journal_lines").select("id, debit, credit").eq("transaction_id", txnId);
        if (jlErr) throw new Error(jlErr.message);
        if (!jls || jls.length !== 2) throw new Error(`journal ${txnId} has ${jls?.length ?? 0} lines; expected 2`);
        for (const jl of jls) {
          const upd = Number(jl.debit) > 0 ? { debit: newTotal } : { credit: newTotal };
          const { error } = await fin.from("fin_journal_lines").update(upd).eq("id", jl.id);
          if (error) throw new Error(error.message);
        }
        const { error: tErr } = await fin.from("fin_transactions").update({ amount: newTotal }).eq("id", txnId);
        if (tErr) throw new Error(tErr.message);
        reusedJournals++;
      }
      await prisma.bankStatementLine.updateMany({
        where: { id: { in: g.lineIds } },
        data: { glTransactionId: txnId, glPostedAt: new Date() },
      });
    } catch (err) {
      errors.push({ company: g.company, category: g.category, date: g.date, error: err instanceof Error ? err.message : String(err) });
      journals--; postedLines -= g.lineIds.length;
      totalDebit = round2(totalDebit - g.amount); totalCredit = round2(totalCredit - g.amount);
    }
  }

  // GC: bank journals no line references are leftovers of feed rebuilds (their
  // lines were deleted and re-posted under a fresh key). Only safe when this
  // run drained the whole backlog — a bounded run hasn't re-stamped everything.
  let gcJournals = 0;
  const drained = !opts.limit || lines.length < opts.limit;
  if (commit && drained && lines.length > 0) {
    try {
      const since = lines[0].txnDate.toISOString().slice(0, 10);
      gcJournals = await gcOrphanBankJournals(since);
    } catch (err) {
      errors.push({ company: "-", category: "gc", date: "-", error: err instanceof Error ? err.message : String(err) });
    }
  }

  const byCategory = [...byCat.entries()]
    .map(([k, v]) => ({ category: k.split("|")[0], account: v.account, direction: v.direction, journals: v.journals, lines: v.lines, amount: v.amount, suspense: v.suspense }))
    .sort((a, b) => b.amount - a.amount);

  return {
    committed: commit,
    scannedLines: lines.length,
    journals, reusedJournals, gcJournals, postedLines, skippedLines, suspenseLines,
    totalDebit, totalCredit, byCategory, errors,
  };
}

// Delete posted bank-agent journals that no bank line references. These are
// derived rows whose source lines were rebuilt away; keeping them is exactly
// the double-count. Scoped to the given window and to posted_by_agent='bank' —
// AR/manual journals are never touched.
async function gcOrphanBankJournals(sinceDate: string): Promise<number> {
  const fin = getFinanceClient();
  const { data: txns, error } = await fin
    .from("fin_transactions")
    .select("id")
    .eq("posted_by_agent", "bank")
    .eq("status", "posted")
    .gte("txn_date", sinceDate);
  if (error) throw new Error(error.message);
  const ids = (txns ?? []).map((t) => t.id as string);

  const orphans: string[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const linked = await prisma.bankStatementLine.groupBy({
      by: ["glTransactionId"],
      where: { glTransactionId: { in: chunk } },
    });
    const linkedSet = new Set(linked.map((r) => r.glTransactionId));
    for (const id of chunk) if (!linkedSet.has(id)) orphans.push(id);
  }

  for (let i = 0; i < orphans.length; i += 200) {
    const chunk = orphans.slice(i, i + 200);
    const { error: le } = await fin.from("fin_journal_lines").delete().in("transaction_id", chunk);
    if (le) throw new Error(le.message);
    const { error: te } = await fin.from("fin_transactions").delete().in("id", chunk);
    if (te) throw new Error(te.message);
  }
  return orphans.length;
}
