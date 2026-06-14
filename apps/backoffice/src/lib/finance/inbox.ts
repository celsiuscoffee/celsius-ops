// Exception inbox resolution. The only path through which humans mutate the
// finance ledger. Each resolution updates fin_exceptions + writes back to
// fin_agent_decisions so the categorizer learns from the correction.

import { randomUUID } from "crypto";
import { getFinanceClient } from "./supabase";
import { postJournal } from "./ledger";
import { commitMatch } from "./agents/matcher";
import type { JournalLineInput } from "./types";

type MatchTargetType = "invoice" | "bill" | "transaction";

export type InboxAction =
  | { kind: "approve" }                                                    // accept agent's proposed action
  | { kind: "correct"; accountCode: string; outletId?: string | null }     // override account code (categorization)
  | { kind: "match"; candidateId: string; candidateType: MatchTargetType; amountMatched?: number } // pick/confirm a match target
  | { kind: "dismiss"; reason: string };                                   // mark as not actionable (spam, duplicate)

export type InboxResolveResult =
  | { kind: "posted"; transactionId: string; amount: number }
  | { kind: "matched"; bankTxnId: string; candidateId: string; candidateType: MatchTargetType; amountMatched: number }
  | { kind: "dismissed" }
  | { kind: "noop"; reason: string };

export async function resolveException(
  exceptionId: string,
  userId: string,
  action: InboxAction
): Promise<InboxResolveResult> {
  const client = getFinanceClient();

  const { data: exc, error } = await client
    .from("fin_exceptions")
    .select("id, company_id, type, related_type, related_id, agent, reason, proposed_action, status")
    .eq("id", exceptionId)
    .single();
  if (error || !exc) throw new Error(`Exception not found: ${exceptionId}`);
  if (exc.status !== "open") {
    return { kind: "noop", reason: `Exception already ${exc.status}` };
  }

  // Tell Postgres the actor for the audit trigger.
  await client.rpc("fin_set_actor", { p_actor: userId });

  if (action.kind === "dismiss") {
    await client
      .from("fin_exceptions")
      .update({
        status: "dismissed",
        resolved_by: userId,
        resolved_at: new Date().toISOString(),
        resolution: { action: "dismiss", reason: action.reason },
      })
      .eq("id", exceptionId);
    // A dismissed match exception means "this bank line is intentionally not
    // reconciled" — flag it so the Matcher doesn't keep re-exceptioning it.
    if (exc.type === "match" && exc.related_type === "bank_txn") {
      await client.from("fin_bank_transactions").update({ status: "ignored" }).eq("id", exc.related_id as string);
    }
    return { kind: "dismissed" };
  }

  // Match exceptions have their own resolver (approve the proposal, or pick a
  // candidate explicitly via the `match` action).
  if (exc.type === "match") {
    return resolveMatchException(client, exc, userId, action);
  }

  // Approve / correct → post the bill journal.
  // Only AP-categorization exceptions are auto-postable from the inbox here.
  // Anomaly / missing-doc / out-of-balance get their own resolvers later.
  if (exc.agent !== "ap" || exc.type !== "categorization") {
    return { kind: "noop", reason: `${exc.agent}/${exc.type} resolver not implemented yet` };
  }

  const proposal = exc.proposed_action as {
    companyId?: string;
    supplierId?: string;
    supplierName?: string;
    outletId?: string | null;
    categorize?: { accountCode: string | null; confidence: number; reasoning: string };
    bill?: {
      supplierName: string | null;
      billNumber: string | null;
      billDate: string | null;
      dueDate: string | null;
      subtotal: number | null;
      sst: number | null;
      total: number | null;
      notes: string | null;
    };
  } | null;

  if (!proposal || !proposal.bill || !proposal.supplierId) {
    return { kind: "noop", reason: "Exception has no actionable proposal" };
  }

  const accountCode =
    action.kind === "correct" ? action.accountCode : proposal.categorize?.accountCode ?? null;
  if (!accountCode) {
    return { kind: "noop", reason: "Cannot post without an account code" };
  }
  const outletId =
    action.kind === "correct" && action.outletId !== undefined
      ? action.outletId
      : proposal.outletId ?? null;

  const total = Number(proposal.bill.total ?? 0);
  if (total <= 0) return { kind: "noop", reason: "Bill total missing" };
  const subtotal = Number(
    proposal.bill.subtotal ?? Math.max(total - Number(proposal.bill.sst ?? 0), 0)
  );
  const sst = Number(proposal.bill.sst ?? 0);

  const lines: JournalLineInput[] = [
    {
      accountCode,
      outletId: outletId ?? null,
      debit: round2(subtotal),
      memo: `${proposal.supplierName ?? "Supplier"} — ${proposal.bill.billNumber ?? "no bill #"}`,
    },
  ];
  if (sst > 0) {
    lines.push({
      accountCode: "3003",
      outletId: outletId ?? null,
      debit: round2(sst),
      memo: `SST input — ${proposal.supplierName ?? "supplier"}`,
    });
  }
  lines.push({
    accountCode: "3001",
    outletId: null,
    credit: round2(total),
    memo: `${proposal.supplierName ?? "supplier"} payable`,
  });

  const companyId = (proposal.companyId as string) ?? (exc.company_id as string);
  if (!companyId) {
    return { kind: "noop", reason: "Exception missing company_id" };
  }

  const result = await postJournal({
    companyId,
    txnDate: proposal.bill.billDate ?? new Date().toISOString().slice(0, 10),
    description: `Bill: ${proposal.supplierName ?? "supplier"}${
      proposal.bill.billNumber ? ` #${proposal.bill.billNumber}` : ""
    } (resolved from inbox)`,
    txnType: "ap_bill",
    outletId: outletId ?? null,
    sourceDocId: exc.related_id as string,
    agent: "manual",
    agentVersion: action.kind === "correct" ? "inbox-correct" : "inbox-approve",
    confidence: 1.0,
    lines,
  });

  // Persist the bill record.
  const billId = randomUUID();
  await client.from("fin_bills").insert({
    id: billId,
    company_id: companyId,
    supplier_id: proposal.supplierId,
    bill_number: proposal.bill.billNumber ?? null,
    bill_date: proposal.bill.billDate ?? new Date().toISOString().slice(0, 10),
    due_date: proposal.bill.dueDate ?? null,
    outlet_id: outletId ?? null,
    subtotal: round2(subtotal),
    sst_amount: round2(sst),
    total: round2(total),
    payment_status: "unpaid",
    paid_amount: 0,
    transaction_id: result.transactionId,
    source_doc_id: exc.related_id as string,
    notes: proposal.bill.notes ?? null,
    scheduled_pay_date: proposal.bill.dueDate ?? null,
  });

  // Mark exception resolved.
  await client
    .from("fin_exceptions")
    .update({
      status: "resolved",
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
      resolution: {
        action: action.kind,
        accountCode,
        outletId,
        transactionId: result.transactionId,
      },
    })
    .eq("id", exceptionId);

  // Mark source doc processed.
  await client
    .from("fin_documents")
    .update({ status: "processed", ingested_at: new Date().toISOString() })
    .eq("id", exc.related_id as string);

  // Training signal — find the original categorizer decision and record the
  // correction so the next run learns from it.
  if (action.kind === "correct" && proposal.categorize?.accountCode !== accountCode) {
    await recordCorrection({
      supplierId: proposal.supplierId,
      originalCode: proposal.categorize?.accountCode ?? null,
      correctedTo: { accountCode, outletId, reasoning: "human override" },
      correctedBy: userId,
    });
  }

  return { kind: "posted", transactionId: result.transactionId, amount: total };
}

type FinClient = ReturnType<typeof getFinanceClient>;
type ExceptionRow = {
  id: string;
  type: string;
  related_type: string;
  related_id: string;
  proposed_action: unknown;
};

// Resolve a `match` exception: write the chosen bank-line ↔ invoice/bill match
// via the shared commitMatch, then record the human decision as training signal
// for the Matcher. `approve` accepts the engine's proposal; `match` is an
// explicit human pick (the engine couldn't, or picked wrong).
async function resolveMatchException(
  client: FinClient,
  exc: ExceptionRow,
  userId: string,
  action: InboxAction
): Promise<InboxResolveResult> {
  const bankTxnId = exc.related_id;
  const proposal = (exc.proposed_action ?? null) as
    | { candidate_id?: string; candidate_type?: MatchTargetType }
    | null;

  let candidateId: string | undefined;
  let candidateType: MatchTargetType | undefined;
  let explicitAmount: number | undefined;

  if (action.kind === "match") {
    candidateId = action.candidateId;
    candidateType = action.candidateType;
    explicitAmount = action.amountMatched;
  } else if (action.kind === "approve") {
    candidateId = proposal?.candidate_id;
    candidateType = proposal?.candidate_type;
    if (!candidateId || !candidateType) {
      return { kind: "noop", reason: "No proposed candidate to approve — pick one explicitly with a match action." };
    }
  } else {
    return { kind: "noop", reason: `Action "${action.kind}" is not valid for a match exception; use approve, match, or dismiss.` };
  }

  const { data: bt, error: btErr } = await client
    .from("fin_bank_transactions")
    .select("id, amount, status")
    .eq("id", bankTxnId)
    .single();
  if (btErr || !bt) return { kind: "noop", reason: "Bank transaction not found" };
  if (bt.status === "matched") return { kind: "noop", reason: "Bank line already matched" };

  // Amount: explicit if given, else the bank amount capped at the target's
  // outstanding (so we never over-apply).
  let amountMatched = explicitAmount;
  if (amountMatched == null) {
    let outstanding = Math.abs(Number(bt.amount));
    if (candidateType !== "transaction") {
      const table = candidateType === "bill" ? "fin_bills" : "fin_invoices";
      const { data: tgt } = await client.from(table).select("total, paid_amount").eq("id", candidateId).single();
      if (tgt) outstanding = Math.min(outstanding, round2(Number(tgt.total) - Number(tgt.paid_amount ?? 0)));
    }
    amountMatched = round2(outstanding);
  }

  await commitMatch(client, {
    bankTxnId,
    candidateType,
    candidateId,
    amountMatched,
    confidence: 1.0, // human-confirmed
    agent: "manual",
  });

  await client
    .from("fin_exceptions")
    .update({
      status: "resolved",
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
      resolution: { action: action.kind, candidateId, candidateType, amountMatched },
    })
    .eq("id", exc.id);

  await recordMatchCorrection(bankTxnId, { candidateId, candidateType, amountMatched }, userId, action.kind === "approve");

  return { kind: "matched", bankTxnId, candidateId, candidateType, amountMatched };
}

// Tag the Matcher's logged decision for this bank line as the training signal:
// `approve` confirms the engine's proposal (applied); an explicit `match` is a
// correction (the engine exceptioned but a human matched it).
async function recordMatchCorrection(
  bankTxnId: string,
  correctedTo: { candidateId: string; candidateType: MatchTargetType; amountMatched: number },
  userId: string,
  isApprove: boolean
): Promise<void> {
  const client = getFinanceClient();
  const { data } = await client
    .from("fin_agent_decisions")
    .select("id")
    .eq("agent", "matcher")
    .eq("input->>bank_txn_id", bankTxnId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (!data || data.length === 0) return;

  const patch = isApprove
    ? { applied: true }
    : {
        applied: true,
        corrected: true,
        corrected_to: correctedTo,
        corrected_by: userId,
        corrected_at: new Date().toISOString(),
      };
  await client.from("fin_agent_decisions").update(patch).eq("id", data[0].id);
}

async function recordCorrection(args: {
  supplierId: string;
  originalCode: string | null;
  correctedTo: { accountCode: string; outletId: string | null; reasoning: string };
  correctedBy: string;
}): Promise<void> {
  const client = getFinanceClient();
  // Find the most recent categorizer decision for this supplier.
  const { data } = await client
    .from("fin_agent_decisions")
    .select("id")
    .eq("agent", "categorizer")
    .order("created_at", { ascending: false })
    .limit(20);
  if (!data || data.length === 0) return;
  // Heuristic: tag the most recent decision. A future iteration can join on
  // input.supplier_id when we add a pg index.
  const target = data[0];
  await client
    .from("fin_agent_decisions")
    .update({
      corrected: true,
      corrected_to: args.correctedTo,
      corrected_by: args.correctedBy,
      corrected_at: new Date().toISOString(),
    })
    .eq("id", target.id);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
