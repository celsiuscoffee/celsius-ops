// Matcher agent — IO shell around the rules engine (matcher-rules.ts).
//
// Loads unmatched bank lines + open AR invoices / AP bills, runs the
// deterministic engine per line, and on a confident match: writes fin_matches,
// flips the bank line to `matched`, and advances the target's paid_amount /
// payment_status. Sub-threshold lines become `match` exceptions in the inbox
// carrying the engine's best proposal. Every decision is logged to
// fin_agent_decisions for audit + future training of the LLM residual pass.
//
// NOT in v1 (deliberate): posting the cash-clearing journal (DR bank / CR
// debtor) for a matched receipt. The match record + payment_status update is
// the reconciliation state; the clearing journal is a separate accounting move
// we don't auto-post unreviewed. Tracked as a follow-up.
//
// Scope: matches on amount/date/reference only; company scoping and the
// fuzzy residual (fee-net card settlements, batched deposits, partial
// payments) are follow-ups — those lines fall to exceptions today.

import { randomUUID } from "crypto";
import { getFinanceClient, setActor } from "../supabase";
import { matchBankLine, settlementStatus, type BankLine, type Candidate, type MatchDecision } from "./matcher-rules";

export const MATCHER_VERSION = "matcher-v1";

// Commit a single match to the ledger: write fin_matches, advance the target's
// paid_amount / payment_status (invoice & bill only), and flip the bank line to
// `matched`. Shared by the auto-Matcher and the inbox resolver so both apply a
// match identically. Idempotency / double-match prevention is the caller's job
// (the bank-line status guard + the engine's in-memory outstanding decrement).
export async function commitMatch(
  client: ReturnType<typeof getFinanceClient>,
  m: {
    bankTxnId: string;
    candidateType: Candidate["type"];
    candidateId: string;
    amountMatched: number;
    confidence: number;
    agent: string; // "matcher" | "manual"
  }
): Promise<void> {
  const { error: matchErr } = await client.from("fin_matches").insert({
    id: randomUUID(),
    bank_txn_id: m.bankTxnId,
    matched_to_type: m.candidateType,
    matched_to_id: m.candidateId,
    amount_matched: m.amountMatched,
    confidence: m.confidence,
    agent: m.agent,
  });
  if (matchErr) throw matchErr;

  if (m.candidateType === "invoice" || m.candidateType === "bill") {
    const table = m.candidateType === "bill" ? "fin_bills" : "fin_invoices";
    const { data: tgt, error: tErr } = await client
      .from(table)
      .select("total, paid_amount")
      .eq("id", m.candidateId)
      .single();
    if (tErr) throw tErr;
    const total = Number(tgt.total);
    const newPaid = round2(Number(tgt.paid_amount ?? 0) + m.amountMatched);
    const { error: uErr } = await client
      .from(table)
      .update({ paid_amount: newPaid, payment_status: settlementStatus(total, newPaid) })
      .eq("id", m.candidateId);
    if (uErr) throw uErr;
  }

  const { error: bErr } = await client
    .from("fin_bank_transactions")
    .update({ status: "matched" })
    .eq("id", m.bankTxnId);
  if (bErr) throw bErr;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00+08:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

type Target = { total: number; paid: number }; // mutable reconciliation state per candidate

export type MatcherSummary = {
  from: string;
  to: string;
  scanned: number;
  matched: number;
  exceptions: number;
  errors: number;
};

export async function runMatcher(opts: {
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
  dateWindowDays?: number;
}): Promise<MatcherSummary> {
  const client = getFinanceClient();
  await setActor(client, MATCHER_VERSION);
  const window = opts.dateWindowDays ?? 3;
  const pad = window + 1;

  // Unmatched bank lines in range, oldest first (deterministic consumption).
  const { data: bankRows, error: bankErr } = await client
    .from("fin_bank_transactions")
    .select("id, bank_account_code, txn_date, amount, description, reference")
    .eq("status", "unmatched")
    .gte("txn_date", opts.from)
    .lte("txn_date", opts.to)
    .order("txn_date", { ascending: true })
    .limit(10000);
  if (bankErr) throw bankErr;
  const lines: BankLine[] = (bankRows ?? []).map((r) => ({
    id: r.id as string,
    amount: Number(r.amount),
    date: r.txn_date as string,
    description: (r.description as string) ?? "",
    reference: (r.reference as string) ?? null,
    bankAccountCode: r.bank_account_code as string,
  }));

  // Candidate pools, padded by the window so edge dates still match.
  const loFrom = addDays(opts.from, -pad);
  const hiTo = addDays(opts.to, pad);
  const targets = new Map<string, Target>(); // candidateId -> live paid/total

  const { data: invRows, error: invErr } = await client
    .from("fin_invoices")
    .select("id, invoice_number, outlet_id, invoice_date, total, paid_amount, payment_status")
    .in("payment_status", ["unpaid", "partial"])
    .gte("invoice_date", loFrom)
    .lte("invoice_date", hiTo)
    .limit(20000);
  if (invErr) throw invErr;

  const { data: billRows, error: billErr } = await client
    .from("fin_bills")
    .select("id, bill_number, outlet_id, bill_date, total, paid_amount, payment_status")
    .in("payment_status", ["unpaid", "partial"])
    .gte("bill_date", loFrom)
    .lte("bill_date", hiTo)
    .limit(20000);
  if (billErr) throw billErr;

  const pool: Candidate[] = [];
  for (const r of invRows ?? []) {
    const total = Number(r.total);
    const paid = Number(r.paid_amount ?? 0);
    targets.set(r.id as string, { total, paid });
    pool.push({
      type: "invoice",
      id: r.id as string,
      direction: "ar",
      outstanding: total - paid,
      date: r.invoice_date as string,
      number: (r.invoice_number as string) ?? null,
      outletId: (r.outlet_id as string) ?? null,
    });
  }
  for (const r of billRows ?? []) {
    const total = Number(r.total);
    const paid = Number(r.paid_amount ?? 0);
    targets.set(r.id as string, { total, paid });
    pool.push({
      type: "bill",
      id: r.id as string,
      direction: "ap",
      outstanding: total - paid,
      date: r.bill_date as string,
      number: (r.bill_number as string) ?? null,
      outletId: (r.outlet_id as string) ?? null,
    });
  }

  let matched = 0;
  let exceptions = 0;
  let errors = 0;

  for (const line of lines) {
    const decision = matchBankLine(line, pool, { dateWindowDays: window });
    try {
      if (decision.kind === "matched") {
        await applyMatch(client, line, decision, pool, targets);
        matched += 1;
      } else {
        await raiseMatchException(client, line, decision);
        exceptions += 1;
      }
    } catch (err) {
      errors += 1;
      // Leave the bank line `unmatched` so the next run retries it.
      console.warn(`[matcher] ${line.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { from: opts.from, to: opts.to, scanned: lines.length, matched, exceptions, errors };
}

async function applyMatch(
  client: ReturnType<typeof getFinanceClient>,
  line: BankLine,
  decision: Extract<MatchDecision, { kind: "matched" }>,
  pool: Candidate[],
  targets: Map<string, Target>
): Promise<void> {
  await commitMatch(client, {
    bankTxnId: line.id,
    candidateType: decision.candidateType,
    candidateId: decision.candidateId,
    amountMatched: decision.amountMatched,
    confidence: decision.confidence,
    agent: "matcher",
  });

  // Keep the in-memory pool consistent so the engine can't re-propose this
  // candidate (or over-apply it) to a later line in the same run.
  const t = targets.get(decision.candidateId);
  if (t) {
    t.paid = round2(t.paid + decision.amountMatched);
    const c = pool.find((p) => p.id === decision.candidateId);
    if (c) c.outstanding = round2(t.total - t.paid);
  }

  await logDecision(client, line, decision, true);
}

async function raiseMatchException(
  client: ReturnType<typeof getFinanceClient>,
  line: BankLine,
  decision: Extract<MatchDecision, { kind: "exception" }>
): Promise<void> {
  // Idempotent: one open match exception per bank line.
  const { data: existing } = await client
    .from("fin_exceptions")
    .select("id")
    .eq("related_type", "bank_txn")
    .eq("related_id", line.id)
    .eq("type", "match")
    .eq("status", "open")
    .maybeSingle();

  if (!existing?.id) {
    const priority = Math.abs(line.amount) >= 5000 ? "high" : "normal";
    const { error: exErr } = await client.from("fin_exceptions").insert({
      id: randomUUID(),
      type: "match",
      related_type: "bank_txn",
      related_id: line.id,
      agent: "matcher",
      reason: decision.reason,
      proposed_action: decision.proposed
        ? {
            candidate_id: decision.proposed.candidateId,
            candidate_type: decision.proposed.candidateType,
            confidence: decision.proposed.confidence,
            bank_amount: line.amount,
            bank_date: line.date,
            bank_reference: line.reference,
          }
        : { bank_amount: line.amount, bank_date: line.date, bank_reference: line.reference },
      priority,
      status: "open",
    });
    if (exErr) throw exErr;
  }

  const { error: bErr } = await client
    .from("fin_bank_transactions")
    .update({ status: "exception" })
    .eq("id", line.id);
  if (bErr) throw bErr;

  await logDecision(client, line, decision, false);
}

async function logDecision(
  client: ReturnType<typeof getFinanceClient>,
  line: BankLine,
  decision: MatchDecision,
  applied: boolean
): Promise<void> {
  await client.from("fin_agent_decisions").insert({
    id: randomUUID(),
    agent: "matcher",
    agent_version: MATCHER_VERSION,
    input: {
      bank_txn_id: line.id,
      amount: line.amount,
      date: line.date,
      reference: line.reference,
      description: line.description,
    },
    output: decision,
    confidence: decision.kind === "matched" ? decision.confidence : (decision.proposed?.confidence ?? 0),
    applied,
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
