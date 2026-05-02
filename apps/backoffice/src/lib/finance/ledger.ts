// The single primitive every finance agent uses to post a balanced journal.
// Validates the entry, sets the audit actor, inserts the transaction + lines,
// and flips status to 'posted'. The DB trigger fin_check_balanced enforces
// debit=credit on the way to 'posted' — we double-check here to fail fast.

import { randomUUID } from "crypto";
import { getFinanceClient } from "./supabase";
import type {
  PostJournalInput,
  PostJournalResult,
  JournalLineInput,
} from "./types";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function validateLines(lines: JournalLineInput[]): { totalDebit: number; totalCredit: number } {
  if (!lines.length) throw new Error("postJournal: no lines provided");
  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of lines) {
    const debit = round2(line.debit ?? 0);
    const credit = round2(line.credit ?? 0);
    if (debit < 0 || credit < 0) {
      throw new Error(`postJournal: negative amount on line ${line.accountCode}`);
    }
    if (debit > 0 && credit > 0) {
      throw new Error(`postJournal: line ${line.accountCode} has both debit and credit`);
    }
    if (debit === 0 && credit === 0) {
      throw new Error(`postJournal: line ${line.accountCode} has no amount`);
    }
    totalDebit += debit;
    totalCredit += credit;
  }
  if (round2(totalDebit) !== round2(totalCredit)) {
    throw new Error(
      `postJournal: unbalanced — debit=${totalDebit.toFixed(2)} credit=${totalCredit.toFixed(2)}`
    );
  }
  return { totalDebit: round2(totalDebit), totalCredit: round2(totalCredit) };
}

export async function postJournal(input: PostJournalInput): Promise<PostJournalResult> {
  const { totalDebit } = validateLines(input.lines);
  const client = getFinanceClient();
  const actor = `${input.agent}-${input.agentVersion}`;

  const { error: actorError } = await client.rpc("fin_set_actor", { p_actor: actor });
  if (actorError && actorError.code !== "42883") throw actorError;

  const txnId = randomUUID();
  const status = input.draft ? "draft" : "posted";

  const { error: txnError } = await client.from("fin_transactions").insert({
    id: txnId,
    company_id: input.companyId,
    txn_date: input.txnDate,
    description: input.description,
    outlet_id: input.outletId ?? null,
    amount: totalDebit,
    currency: "MYR",
    source_doc_id: input.sourceDocId ?? null,
    txn_type: input.txnType,
    posted_by_agent: input.agent,
    agent_version: input.agentVersion,
    confidence: input.confidence,
    status: "draft",
  });
  if (txnError) throw txnError;

  const lineRows = input.lines.map((line, i) => ({
    id: randomUUID(),
    transaction_id: txnId,
    account_code: line.accountCode,
    outlet_id: line.outletId ?? input.outletId ?? null,
    debit: round2(line.debit ?? 0),
    credit: round2(line.credit ?? 0),
    memo: line.memo ?? null,
    line_order: i,
  }));

  const { error: linesError } = await client.from("fin_journal_lines").insert(lineRows);
  if (linesError) {
    // Roll back the txn header so we don't leave an orphan.
    await client.from("fin_transactions").delete().eq("id", txnId);
    throw linesError;
  }

  if (!input.draft) {
    const { error: postError } = await client
      .from("fin_transactions")
      .update({ status: "posted" })
      .eq("id", txnId);
    if (postError) {
      // Trigger may have rejected (unbalanced or closed period). Surface raw error.
      throw postError;
    }
  }

  return {
    transactionId: txnId,
    journalLineIds: lineRows.map((r) => r.id),
    amount: totalDebit,
    status,
  };
}

// Reverses a posted transaction by creating an offsetting journal. The original
// is marked status='reversed' and linked via reversed_by_id. Used by:
//  - Compliance agent when LHDN rejects an e-invoice (cancel + re-issue)
//  - Manual corrections from the exception inbox
//  - Period reopen flows
export async function reverseTransaction(
  originalId: string,
  opts: { reason: string; agent: PostJournalInput["agent"]; agentVersion: string }
): Promise<PostJournalResult> {
  const client = getFinanceClient();

  const { data: original, error } = await client
    .from("fin_transactions")
    .select("id, company_id, txn_date, description, outlet_id, source_doc_id, txn_type, status")
    .eq("id", originalId)
    .single();
  if (error || !original) throw new Error(`Original transaction not found: ${originalId}`);
  if (original.status === "reversed") throw new Error("Transaction already reversed");

  const { data: lines, error: linesError } = await client
    .from("fin_journal_lines")
    .select("account_code, outlet_id, debit, credit, memo")
    .eq("transaction_id", originalId);
  if (linesError || !lines) throw linesError ?? new Error("No lines for original");

  const reversedLines: JournalLineInput[] = lines.map((l) => ({
    accountCode: l.account_code,
    outletId: l.outlet_id,
    debit: Number(l.credit),
    credit: Number(l.debit),
    memo: l.memo ?? undefined,
  }));

  const result = await postJournal({
    companyId: original.company_id as string,
    txnDate: new Date().toISOString().slice(0, 10),
    description: `Reversal of ${originalId}: ${opts.reason}`,
    txnType: "reversal",
    outletId: original.outlet_id,
    sourceDocId: original.source_doc_id,
    agent: opts.agent,
    agentVersion: opts.agentVersion,
    confidence: 1.0,
    lines: reversedLines,
  });

  await client
    .from("fin_transactions")
    .update({ status: "reversed", reversed_by_id: result.transactionId })
    .eq("id", originalId);

  return result;
}
