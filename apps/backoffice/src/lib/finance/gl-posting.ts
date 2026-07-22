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
//      posting_key = md5(company|outlet|contra|day|direction). If a journal
//      for the group already exists, it is REUSED: unlinked (rebuilt) lines are
//      re-stamped onto it, and genuinely new lines for an already-posted day
//      fold in by updating the journal amount (additive).
// A GC pass then deletes bank journals no line references (orphans left by
// rebuilds under older rules) — run only when the backlog fully drained, so a
// bounded run never deletes journals whose lines it hasn't reached yet.
//
// CUTOVER: only lines dated on/after GL_POSTING_CUTOVER are ever candidates;
// 2025 stays in Bukku. Cross-entity Grab settlements (payout in one company's
// bank, sale accrued in another company's 1005) post a PAIR of journals; see
// resolveGrabSettlementRouting, upsertMirrorJournal, and the mirror-aware GC.

import { createHash } from "crypto";
import { prisma } from "../prisma";
import { postJournal } from "./ledger";
import { getFinanceClient } from "./supabase";
import type { JournalLineInput } from "./types";
import {
  BANK_CASH, companyFromAccountName, GL_POSTING_CUTOVER, resolveContra, resolveContraDirectional,
  resolveGrabSettlementRouting, round2, SKIP_CATS,
} from "./gl-posting-map";
import type { GrabSettlementRouting } from "./gl-posting-map";

// md5 digest formatted as a UUID so it fits fin_transactions.posting_key and
// matches postgres md5(text)::uuid — SQL backfills can reproduce it exactly.
function md5Uuid(input: string): string {
  const h = createHash("md5").update(input).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Deterministic journal identity for a (company, outlet, contra, day, direction)
// aggregate.
export function bankJournalKey(company: string, outletId: string | null, contra: string, date: string, direction: string): string {
  return md5Uuid(`bank-gl|${company}|${outletId ?? ""}|${contra}|${date}|${direction}`);
}

// Cross-entity Grab settlement aggregates get their own key namespace so they
// can never collide with a plain inter-company journal that resolves to the
// same 3600-xx contra on the same day (both would otherwise hash the same
// components and fold into one journal, corrupting the mirror amount).
export function bankCrossEntityJournalKey(company: string, outletId: string | null, contra: string, date: string, direction: string): string {
  return md5Uuid(`bank-gl-x|${company}|${outletId ?? ""}|${contra}|${date}|${direction}`);
}

// The mirror journal's identity derives from the PRIMARY journal's posting key
// string itself, so anything holding a bank journal's posting_key (the poster,
// the GC) can locate its mirror deterministically without knowing the original
// aggregation parameters. Re-runs always land on the same pair of keys.
export function bankMirrorJournalKey(primaryKey: string): string {
  return md5Uuid(`bank-gl-mirror|${primaryKey}`);
}

export {
  CONTRA_ACCOUNT, companyFromAccountName, contraFor, GL_POSTING_CUTOVER,
  INTERCO_DUE_ACCOUNT, resolveContra, resolveContraDirectional, resolveGrabSettlementRouting,
} from "./gl-posting-map";

export type Group = {
  company: string;
  outletId: string | null;
  contra: string;        // resolved contra account (control/inter-co/expense/…)
  suspense: boolean;
  category: string;      // representative category, for labelling
  date: string;          // YYYY-MM-DD
  direction: "CR" | "DR";
  amount: number;
  lineIds: string[];
  // Set for cross-entity Grab settlements: the second journal to post in the
  // outlet's company (Dr due-from-receiver, Cr 1005), mirroring this group's
  // amount. See resolveGrabSettlementRouting in gl-posting-map.ts.
  mirror?: GrabSettlementRouting["mirror"];
};

// Minimal line shape the grouping logic needs. Kept structural so unit tests
// can feed synthetic lines without Prisma.
export type GroupableBankLine = {
  id: string;
  txnDate: Date;
  amount: number;
  direction: "CR" | "DR";
  category: string;
  description: string;
  outletId: string | null;
  accountName: string | null;
};

// Aggregate classified bank lines into posting groups. Pure: company comes
// from the statement account name, the outlet's company from the supplied
// fin_outlet_companies map. Lines dated before GL_POSTING_CUTOVER are dropped
// here as well as in the query, so every caller gets the same hard floor.
export function buildBankGroups(
  lines: GroupableBankLine[],
  outletCompanyById: Map<string, string>,
): { groups: Map<string, Group>; skippedLines: number } {
  const groups = new Map<string, Group>();
  let skippedLines = 0;
  for (const l of lines) {
    const category = l.category;
    if (SKIP_CATS.has(category)) { skippedLines++; continue; }
    const date = l.txnDate.toISOString().slice(0, 10);
    if (date < GL_POSTING_CUTOVER) { skippedLines++; continue; } // pre-cutover: Bukku's books
    const company = companyFromAccountName(l.accountName);
    const direction = l.direction;
    // Cross-entity Grab settlement? Route through the inter-company accounts
    // and remember the mirror journal; otherwise resolve the contra as usual.
    const routing = direction === "CR"
      ? resolveGrabSettlementRouting(category, company, (l.outletId && outletCompanyById.get(l.outletId)) || null)
      : null;
    const { code: contra, suspense } = routing
      ? { code: routing.contra, suspense: false }
      : resolveContraDirectional(category, l.description, direction);
    const key = [company, l.outletId ?? "", contra, date, direction, routing ? `x:${routing.mirror.company}` : ""].join("|");
    const g = groups.get(key);
    if (g) { g.amount = round2(g.amount + l.amount); g.lineIds.push(l.id); }
    else {
      groups.set(key, {
        company, outletId: l.outletId, contra, suspense, category, date, direction,
        amount: round2(l.amount), lineIds: [l.id],
        ...(routing ? { mirror: routing.mirror } : {}),
      });
    }
  }
  return { groups, skippedLines };
}

export type GlPostResult = {
  committed: boolean;
  scannedLines: number;
  journals: number;        // journals posted (or that would post); a cross-entity group counts once here
  reusedJournals: number;  // groups folded into an existing deterministic journal
  mirrorJournals: number;  // cross-entity Grab mirror journals posted alongside their primaries
  gcJournals: number;      // orphaned bank journals deleted (no line references)
  postedLines: number;     // bank lines that landed in a journal
  skippedLines: number;    // TRANSFER_NOT_SUCCESSFUL, plus any pre-cutover stragglers
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

  // Hard cutover floor: lines dated before GL_POSTING_CUTOVER are Bukku's and
  // are never posted, previewed, or counted as backlog, regardless of their
  // classification state. sinceDays can only NARROW the window further.
  const cutoverFloor = new Date(`${GL_POSTING_CUTOVER}T00:00:00Z`);
  const sinceFloor = opts.sinceDays ? new Date(Date.now() - opts.sinceDays * 86_400_000) : cutoverFloor;
  const txnDateFloor = sinceFloor > cutoverFloor ? sinceFloor : cutoverFloor;

  const lines = await prisma.bankStatementLine.findMany({
    where: {
      category: { not: null },
      glTransactionId: null,
      txnDate: { gte: txnDateFloor },
    },
    select: {
      id: true, txnDate: true, amount: true, direction: true, category: true, description: true, outletId: true,
      statement: { select: { accountName: true } },
    },
    orderBy: { txnDate: "asc" },
    take: opts.limit,
  });

  // Outlet to legal-entity map, needed to spot Grab settlements that landed in
  // another company's bank account (fetched once; small table).
  const fin = getFinanceClient();
  const { data: outletCompanies, error: ocErr } = await fin
    .from("fin_outlet_companies")
    .select("outlet_id, company_id");
  if (ocErr) throw new Error(ocErr.message);
  const outletCompanyById = new Map(
    (outletCompanies ?? []).map((r) => [r.outlet_id as string, r.company_id as string]),
  );

  // Resolve the contra account per line (so statutory splits by type, inter-co
  // routes by counterparty, and cross-entity Grab settlements route through the
  // 3600-xx accounts), then aggregate into one journal per
  // (company, outlet, CONTRA account, day, direction).
  const { groups, skippedLines } = buildBankGroups(
    lines.map((l) => ({
      id: l.id,
      txnDate: l.txnDate,
      amount: Number(l.amount),
      direction: l.direction as "CR" | "DR",
      category: l.category as string,
      description: l.description ?? "",
      outletId: l.outletId,
      accountName: l.statement.accountName,
    })),
    outletCompanyById,
  );

  const byCat = new Map<string, { account: string; direction: string; journals: number; lines: number; amount: number; suspense: boolean }>();
  const errors: GlPostResult["errors"] = [];
  let journals = 0, reusedJournals = 0, mirrorJournals = 0, postedLines = 0, suspenseLines = 0, totalDebit = 0, totalCredit = 0;

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
    if (g.mirror) mirrorJournals++;
    postedLines += g.lineIds.length;
    if (g.suspense) suspenseLines += g.lineIds.length;
    totalDebit = round2(totalDebit + g.amount);
    totalCredit = round2(totalCredit + g.amount);

    if (!commit) continue;
    try {
      // Cross-entity Grab aggregates key in their own namespace (see
      // bankCrossEntityJournalKey) so they never fold into a plain inter-co
      // journal that shares the same 3600-xx contra and day.
      const key = g.mirror
        ? bankCrossEntityJournalKey(g.company, g.outletId, contra, g.date, g.direction)
        : bankJournalKey(g.company, g.outletId, contra, g.date, g.direction);
      const { data: existingRows, error: exErr } = await fin
        .from("fin_transactions")
        .select("id, amount")
        .eq("posting_key", key)
        .eq("posted_by_agent", "bank")
        .eq("status", "posted")
        .limit(1);
      if (exErr) throw new Error(exErr.message);
      const existing = existingRows?.[0];

      let txnId: string;
      // The journal amount this group settles on. The mirror (if any) is kept
      // identical to it below.
      let finalTotal = g.amount;
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
          postingKey: key,
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
        finalTotal = newTotal;
        reusedJournals++;
      }
      // Cross-entity Grab: upsert the mirror journal in the outlet's company
      // BEFORE stamping the lines. If the mirror fails, the lines stay
      // unstamped, the group re-forms next run, the primary is found and
      // reused, and the mirror upsert retries. Self-healing.
      if (g.mirror) await upsertMirrorJournal(fin, g, key, finalTotal);
      await prisma.bankStatementLine.updateMany({
        where: { id: { in: g.lineIds } },
        data: { glTransactionId: txnId, glPostedAt: new Date() },
      });
    } catch (err) {
      errors.push({ company: g.company, category: g.category, date: g.date, error: err instanceof Error ? err.message : String(err) });
      journals--; postedLines -= g.lineIds.length;
      if (g.mirror) mirrorJournals--;
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
    journals, reusedJournals, mirrorJournals, gcJournals, postedLines, skippedLines, suspenseLines,
    totalDebit, totalCredit, byCategory, errors,
  };
}

// Post or update the mirror journal for a cross-entity Grab settlement group:
// in the OUTLET's company, Dr 3600-yy due from the receiving company, Cr 1005
// Grabfood debtors. Idempotent via bankMirrorJournalKey(primaryKey); on reuse
// the amounts are REPLACED with the primary's settled total so the pair can
// never drift apart across re-runs and fold-ins.
async function upsertMirrorJournal(
  fin: ReturnType<typeof getFinanceClient>,
  g: Group,
  primaryKey: string,
  total: number,
): Promise<void> {
  const mirror = g.mirror;
  if (!mirror) return;
  const mirrorKey = bankMirrorJournalKey(primaryKey);
  const { data: rows, error: exErr } = await fin
    .from("fin_transactions")
    .select("id")
    .eq("posting_key", mirrorKey)
    .eq("posted_by_agent", "bank")
    .eq("status", "posted")
    .limit(1);
  if (exErr) throw new Error(exErr.message);
  const existing = rows?.[0];

  if (!existing) {
    await postJournal({
      companyId: mirror.company,
      txnDate: g.date,
      description: `Grab settlement received by ${g.company} on behalf of ${mirror.company} ${g.date} (${g.lineIds.length} line${g.lineIds.length > 1 ? "s" : ""}); clears ${mirror.creditAccount} via inter-co ${mirror.debitAccount}`,
      txnType: "payment",
      outletId: g.outletId,
      agent: "bank",
      agentVersion: "bank-gl-v1",
      confidence: 1,
      postingKey: mirrorKey,
      lines: [
        { accountCode: mirror.debitAccount, debit: total, outletId: g.outletId },
        { accountCode: mirror.creditAccount, credit: total, outletId: g.outletId },
      ],
    });
    return;
  }

  const txnId = existing.id as string;
  const { data: jls, error: jlErr } = await fin
    .from("fin_journal_lines").select("id, debit, credit").eq("transaction_id", txnId);
  if (jlErr) throw new Error(jlErr.message);
  if (!jls || jls.length !== 2) throw new Error(`mirror journal ${txnId} has ${jls?.length ?? 0} lines; expected 2`);
  for (const jl of jls) {
    const upd = Number(jl.debit) > 0 ? { debit: total } : { credit: total };
    const { error } = await fin.from("fin_journal_lines").update(upd).eq("id", jl.id);
    if (error) throw new Error(error.message);
  }
  const { error: tErr } = await fin.from("fin_transactions").update({ amount: total }).eq("id", txnId);
  if (tErr) throw new Error(tErr.message);
}

// Delete posted bank-agent journals that no bank line references. These are
// derived rows whose source lines were rebuilt away; keeping them is exactly
// the double-count. Scoped to the given window and to posted_by_agent='bank' —
// AR/manual journals are never touched.
//
// Mirror journals (cross-entity Grab) NEVER carry line stamps: their lines are
// stamped onto the primary. Plain zero-ref logic would wrongly delete every
// live mirror, so mirrors are identified by key derivation. A journal whose
// posting_key equals bankMirrorJournalKey(k) for some present posting_key k is
// k's mirror, and it lives and dies with that primary: kept while the primary
// has line refs, deleted alongside it when the primary is an orphan. A mirror
// whose primary is GONE entirely is not identified (nothing derives its key)
// and falls through to plain zero-ref deletion, which is the correct outcome.
async function gcOrphanBankJournals(sinceDate: string): Promise<number> {
  const fin = getFinanceClient();
  const { data: txns, error } = await fin
    .from("fin_transactions")
    .select("id, posting_key")
    .eq("posted_by_agent", "bank")
    .eq("status", "posted")
    .gte("txn_date", sinceDate);
  if (error) throw new Error(error.message);
  const rows = (txns ?? []).map((t) => ({ id: t.id as string, key: (t.posting_key as string | null) ?? null }));
  const ids = rows.map((r) => r.id);

  const unlinked = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const linked = await prisma.bankStatementLine.groupBy({
      by: ["glTransactionId"],
      where: { glTransactionId: { in: chunk } },
    });
    const linkedSet = new Set(linked.map((r) => r.glTransactionId));
    for (const id of chunk) if (!linkedSet.has(id)) unlinked.add(id);
  }

  // mirror journal id -> its primary journal id, via key derivation.
  const idByKey = new Map<string, string>();
  for (const r of rows) if (r.key) idByKey.set(r.key, r.id);
  const mirrorToPrimary = new Map<string, string>();
  for (const r of rows) {
    if (!r.key) continue;
    const mirrorId = idByKey.get(bankMirrorJournalKey(r.key));
    if (mirrorId && mirrorId !== r.id) mirrorToPrimary.set(mirrorId, r.id);
  }

  const orphans: string[] = [];
  for (const r of rows) {
    if (!unlinked.has(r.id)) continue;
    const primaryId = mirrorToPrimary.get(r.id);
    if (primaryId && !unlinked.has(primaryId)) continue; // live primary keeps its mirror
    orphans.push(r.id);
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
