// Exception inbox resolution. The only path through which humans mutate the
// finance ledger. Each resolution updates fin_exceptions + writes back to
// fin_agent_decisions so the categorizer learns from the correction.

import { getFinanceClient } from "./supabase";
import { postJournal } from "./ledger";
import type { JournalLineInput } from "./types";
import { logAgentMessage } from "@celsius/agents/src/messages";
// Fallback dates are MYT calendar days: UTC would land 00:00–08:00 postings on yesterday.
import { todayMyt } from "@/lib/inventory/myt-date";

export type InboxAction =
  | { kind: "approve" }                                                    // accept agent's proposed action
  | { kind: "correct"; accountCode: string; outletId?: string | null }     // override account code
  | { kind: "dismiss"; reason: string };                                   // mark as not actionable (spam, duplicate)

export type InboxResolveResult =
  | { kind: "posted"; transactionId: string; amount: number }
  | { kind: "dismissed" }
  | { kind: "noop"; reason: string };

type FinanceClient = ReturnType<typeof getFinanceClient>;

async function fetchException(client: FinanceClient, exceptionId: string) {
  return client
    .from("fin_exceptions")
    .select("id, company_id, type, related_type, related_id, agent, reason, proposed_action, status")
    .eq("id", exceptionId)
    .single();
}
type ExceptionRow = NonNullable<Awaited<ReturnType<typeof fetchException>>["data"]>;

export async function resolveException(
  exceptionId: string,
  userId: string,
  action: InboxAction
): Promise<InboxResolveResult> {
  // Actor = the resolving user; rides as the x-fin-actor header (migration 095).
  const client = getFinanceClient(userId);

  const { data: exc, error } = await fetchException(client, exceptionId);
  if (error || !exc) throw new Error(`Exception not found: ${exceptionId}`);
  if (exc.status !== "open") {
    return { kind: "noop", reason: `Exception already ${exc.status}` };
  }

  // Atomic claim. The read above is check-then-act: two Approve clicks (or a
  // retried request) both saw `open` and both posted the AP bill journal. A
  // single conditional UPDATE lets exactly one caller through; the loser gets
  // a noop instead of a second journal. resolved_by doubles as the claim
  // marker — it is null on every open exception — and is set for real, or
  // cleared, by the outcome below.
  const { data: claimed, error: claimErr } = await client
    .from("fin_exceptions")
    .update({ resolved_by: userId, resolved_at: new Date().toISOString() })
    .eq("id", exceptionId)
    .eq("status", "open")
    .is("resolved_by", null)
    .select("id");
  if (claimErr) throw claimErr;
  if (!claimed || claimed.length === 0) {
    return { kind: "noop", reason: "Exception is already being resolved by another request" };
  }
  const releaseClaim = async () => {
    await client
      .from("fin_exceptions")
      .update({ resolved_by: null, resolved_at: null })
      .eq("id", exceptionId)
      .eq("status", "open");
  };

  try {
    const result = await resolveClaimedException(client, exc, exceptionId, userId, action);
    if (result.kind === "noop") await releaseClaim(); // nothing happened — let the next caller try
    return result;
  } catch (err) {
    await releaseClaim();
    throw err;
  }
}

async function resolveClaimedException(
  client: FinanceClient,
  exc: ExceptionRow,
  exceptionId: string,
  userId: string,
  action: InboxAction
): Promise<InboxResolveResult> {
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
    return { kind: "dismissed" };
  }

  // AR low-confidence EOD days: the agent posted the journal as a DRAFT and
  // raised this exception as its only human surface. Approve = post the
  // draft as-is (the DB triggers re-validate balance + period on the flip).
  // A correct/reclass flow needs a tender-split editor — not built; say so.
  if (exc.agent === "ar" && exc.type === "categorization") {
    if (action.kind !== "approve") {
      return { kind: "noop", reason: "AR exceptions support approve or dismiss only (tender reclass not built)" };
    }
    if (exc.related_type !== "transaction" || !exc.related_id) {
      return { kind: "noop", reason: "AR exception missing related transaction" };
    }
    const { data: draft } = await client
      .from("fin_transactions")
      .select("id, status, amount")
      .eq("id", exc.related_id as string)
      .maybeSingle();
    if (!draft) return { kind: "noop", reason: "Draft transaction not found" };
    if (draft.status !== "draft") {
      // Already posted/reversed elsewhere — just close the exception.
      await client
        .from("fin_exceptions")
        .update({
          status: "resolved",
          resolved_by: userId,
          resolved_at: new Date().toISOString(),
          resolution: { action: "approve", note: `transaction already ${draft.status}` },
        })
        .eq("id", exceptionId);
      return { kind: "posted", transactionId: draft.id as string, amount: Number(draft.amount) };
    }
    const { error: postErr } = await client
      .from("fin_transactions")
      .update({ status: "posted" })
      .eq("id", draft.id as string);
    if (postErr) throw postErr; // trigger rejection (unbalanced/closed period) surfaces raw
    await client
      .from("fin_exceptions")
      .update({
        status: "resolved",
        resolved_by: userId,
        resolved_at: new Date().toISOString(),
        resolution: { action: "approve" },
      })
      .eq("id", exceptionId);
    return { kind: "posted", transactionId: draft.id as string, amount: Number(draft.amount) };
  }

  // Approve / correct → post the bill journal.
  // Only AP-categorization exceptions are auto-postable from the inbox in
  // Phase 3. Other exception types (match, anomaly) get their own resolvers
  // in later phases.
  if (exc.agent !== "ap" || exc.type !== "categorization") {
    return { kind: "noop", reason: `${exc.agent}/${exc.type} resolver not implemented yet` };
  }

  const proposal = exc.proposed_action as {
    companyId?: string;
    supplierId?: string;
    supplierName?: string;
    outletId?: string | null;
    categorize?: {
      accountCode: string | null;
      confidence: number;
      reasoning: string;
      decisionId?: string | null;
    };
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
    txnDate: proposal.bill.billDate ?? todayMyt(),
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

  // (fin_bills is dead/tombstoned — the ap_bill journal is the record;
  // the parsed bill payload stays on the fin_documents row.)

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
      decisionId: proposal.categorize?.decisionId ?? null,
      relatedId: (exc.related_id as string) ?? null,
      supplierId: proposal.supplierId,
      originalCode: proposal.categorize?.accountCode ?? null,
      correctedTo: { accountCode, outletId, reasoning: "human override" },
      correctedBy: userId,
    });
  } else if (action.kind === "approve" && proposal.categorize?.decisionId) {
    // The proposal was used as-is — the decision counts as applied.
    await client
      .from("fin_agent_decisions")
      .update({ applied: true })
      .eq("id", proposal.categorize.decisionId);
  }

  return { kind: "posted", transactionId: result.transactionId, amount: total };
}

async function recordCorrection(args: {
  decisionId: string | null;
  relatedId: string | null;
  supplierId: string;
  originalCode: string | null;
  correctedTo: { accountCode: string; outletId: string | null; reasoning: string };
  correctedBy: string;
}): Promise<void> {
  const client = getFinanceClient(args.correctedBy);

  // Resolve the decision this correction belongs to, most exact first:
  // 1. The decision id carried in the exception's proposal (new rows).
  // 2. The decision logged against the same source document.
  // 3. The latest decision for the same supplier (legacy rows from before
  //    related_id was populated — better than "latest overall", which
  //    mis-attributed corrections under concurrent ingestion).
  let targetId = args.decisionId;
  if (!targetId && args.relatedId) {
    const { data } = await client
      .from("fin_agent_decisions")
      .select("id")
      .eq("agent", "categorizer")
      .eq("related_type", "document")
      .eq("related_id", args.relatedId)
      .order("created_at", { ascending: false })
      .limit(1);
    targetId = data?.[0]?.id ?? null;
  }
  if (!targetId) {
    const { data } = await client
      .from("fin_agent_decisions")
      .select("id")
      .eq("agent", "categorizer")
      .eq("input->>supplier_id", args.supplierId)
      .order("created_at", { ascending: false })
      .limit(1);
    targetId = data?.[0]?.id ?? null;
  }
  if (!targetId) return;

  await client
    .from("fin_agent_decisions")
    .update({
      corrected: true,
      corrected_to: args.correctedTo,
      corrected_by: args.correctedBy,
      corrected_at: new Date().toISOString(),
    })
    .eq("id", targetId);

  // The correction is the agent learning: next time it sees a similar bill it
  // has a human-verified example to categorize against. Record it on the
  // Conversations feed as a plain-English learning (no real-time push - it's
  // reference, not something the owner must act on now).
  await logAgentMessage({
    fromAgent: "finance_ap_agent",
    toAgent: undefined,
    kind: "learning",
    summary: `A human corrected a categorization${args.originalCode ? ` from account ${args.originalCode}` : ""} to account ${args.correctedTo.accountCode}. The agent now has a verified example to code similar bills against.`,
    detail: args.correctedTo.reasoning,
    refTable: "fin_agent_decisions",
    refId: targetId,
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
