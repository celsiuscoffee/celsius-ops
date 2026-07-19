// LLM verifier agent — the second pair of eyes for AP matches the rules can't
// auto-clear. The rules verifier (verifyMatch) only passes amount-exact +
// name-confirmed matches; everything else falls to REVIEW. This agent reads
// each REVIEW match the way a bookkeeper would — "is this bank payment actually
// the settlement of this invoice, or a coincidence (a salary, a transfer, a
// different vendor with the same amount)?" — and returns confirm / reject so
// the loop can clear the confirmed ones and drop the rest, shrinking the human
// queue toward zero.
//
// Model: claude-haiku-4-5 (fast + cheap; same tier the categorizer uses).

import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { proposeApMatches, writeApMatch, type ApMatch } from "../ap-match";
import { getFinanceClient } from "../supabase";
import { markDecisionApplied } from "./categorizer";
import { logAgentMessage } from "@celsius/agents/src/messages";
import { askOwner, pendingPromptExists } from "@celsius/agents/src/ask-owner";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const AP_VERIFIER_VERSION = "ap-verifier-v2";

export type ApVerdict = {
  bankLineId: string;
  invoiceId: string;
  verdict: "confirm" | "reject" | "uncertain";
  confidence: number; // 0..1
  reason: string;
  // Pay-and-claim: a staff member paid the vendor out of pocket and the company
  // reimbursed them, so the bank line shows the STAFF NAME, not the vendor. The
  // invoice IS settled - it is NOT a wrong match. Routed to the human finance
  // queue (never auto-cleared on a fuzzy name match).
  payAndClaim: boolean;
  paidBy: string | null;
  decisionId?: string | null; // fin_agent_decisions row logged for this verdict
};

const SYSTEM = `You verify whether a bank payment settles a specific vendor invoice for a coffee chain. The invoice may be for raw materials, packaging, distribution, services, rent, or equipment — any supplier or service vendor (note: vendor names often contain words like "Marketing" or "Distribution" but are goods suppliers, not advertising spend). Be strict: a matching amount alone is NOT enough — Malaysian bank lines for salaries, part-timer wages ("PT Week"), statutory payments (EPF/SOCSO), owner draws, and unrelated companies frequently collide on amount. Confirm ONLY if the bank line's payee/reference clearly corresponds to the invoice's vendor (e.g. invoice "Unique Paper" matches bank "UNIQUE PAPER SDN"). Reject if the bank line is plainly a different kind of payment (payroll/PT-week, statutory, an internal transfer, or a different company). Use "uncertain" when you genuinely cannot tell.

IMPORTANT — pay-and-claim (staff reimbursement): staff often pay a vendor directly out of their own pocket and are later reimbursed by the company. When that happens the bank line shows the STAFF MEMBER'S NAME, not the vendor's — the payment still settles the vendor invoice. This is NOT a mismatch. You are given a list of known staff. If the bank description matches one of those staff names (ignore a leading outlet/location prefix like "Putrajaya" or "Shah Alam", and ignore truncation), treat it as a pay-and-claim: set "pay_and_claim": true and "paid_by" to that staff name, and set verdict to "uncertain" (a human will settle it against the expense claim — do not treat it as a wrong match, and do not confirm it yourself). Only reject a personal-name payee when it does NOT match any known staff (a genuine third party or unrelated payment).

Output ONLY JSON: {"verdict":"confirm|reject|uncertain","confidence":0.0,"reason":"one short line","pay_and_claim":false,"paid_by":null}.`;

function buildPrompt(m: ApMatch, staffNames: string[]): string {
  const staffBlock = staffNames.length
    ? staffNames.map((n) => `- ${n}`).join("\n")
    : "(none provided)";
  return `# Invoice
supplier/payee: ${m.payee}
invoice no: ${m.invoiceNumber ?? "(none)"}
amount: RM ${m.amount.toFixed(2)}
issue date: ${m.issueDate}

# Bank payment (outflow)
description: ${m.bankDesc}
amount: RM ${m.amount.toFixed(2)}
date: ${m.bankDate}
current category: ${m.bankCategory ?? "unclassified"}

# Known staff (may pay a vendor out-of-pocket, then get reimbursed — pay-and-claim)
${staffBlock}

Does this bank payment settle this invoice? If the bank description is one of the known staff above, it is a pay-and-claim (set pay_and_claim true), not a mismatch.`;
}

function parse(text: string, m: ApMatch): ApVerdict {
  const fallback: ApVerdict = { bankLineId: m.bankLineId, invoiceId: m.invoiceId, verdict: "uncertain", confidence: 0, reason: "unparseable verifier response", payAndClaim: false, paidBy: null };
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < 0) return fallback;
  try {
    const o = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    const v = o.verdict === "confirm" || o.verdict === "reject" ? o.verdict : "uncertain";
    const c = Math.max(0, Math.min(1, Number(o.confidence) || 0));
    const payAndClaim = o.pay_and_claim === true;
    return {
      bankLineId: m.bankLineId,
      invoiceId: m.invoiceId,
      // A pay-and-claim is never a wrong match: keep it out of the reject path.
      verdict: payAndClaim ? "uncertain" : v,
      confidence: c,
      reason: String(o.reason ?? "").slice(0, 140),
      payAndClaim,
      paidBy: o.paid_by ? String(o.paid_by).slice(0, 80) : null,
    };
  } catch { return fallback; }
}

// Active staff whose personal name may appear on a pay-and-claim bank line.
// Loaded once per batch and injected so the verifier can tell a staff
// reimbursement from a genuine third-party mismatch.
async function loadStaffNames(): Promise<string[]> {
  try {
    const users = await prisma.user.findMany({
      where: { status: "ACTIVE" },
      select: { fullName: true, name: true },
    });
    const names = new Set<string>();
    for (const u of users) {
      const n = (u.fullName || u.name || "").trim();
      if (n) names.add(n);
    }
    return [...names];
  } catch (e) {
    console.error("[ap-verifier] loadStaffNames failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

export async function verifyApMatch(m: ApMatch, staffNames: string[]): Promise<ApVerdict> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { bankLineId: m.bankLineId, invoiceId: m.invoiceId, verdict: "uncertain", confidence: 0, reason: "ANTHROPIC_API_KEY not set", payAndClaim: false, paidBy: null };
  }
  const res = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 200,
    system: SYSTEM,
    messages: [{ role: "user", content: buildPrompt(m, staffNames) }],
  });
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  const verdict = parse(text, m);
  const decisionId = await logVerdict(m, verdict);
  return { ...verdict, decisionId };
}

// Every verdict is eval data: inbox/EOM corrections against these matches are
// the ground truth for the wrong-invoice-match problem (~113 historical).
// Same table + shape convention as the categorizer's logDecision.
async function logVerdict(m: ApMatch, v: ApVerdict): Promise<string | null> {
  const client = getFinanceClient();
  const id = randomUUID();
  const { error } = await client.from("fin_agent_decisions").insert({
    id,
    agent: "ap-verifier",
    agent_version: AP_VERIFIER_VERSION,
    input: {
      payee: m.payee,
      invoice_number: m.invoiceNumber ?? null,
      invoice_id: m.invoiceId,
      amount: m.amount,
      issue_date: m.issueDate,
      bank_desc: m.bankDesc,
      bank_date: m.bankDate,
      bank_category: m.bankCategory ?? null,
      link_only: m.linkOnly ?? false,
    },
    output: { verdict: v.verdict, reason: v.reason, pay_and_claim: v.payAndClaim, paid_by: v.paidBy },
    confidence: v.confidence,
    related_type: "bank_line",
    related_id: m.bankLineId,
    applied: false, // set true when applyVerifiedReview commits this match
  });
  if (error) {
    console.error("[ap-verifier] fin_agent_decisions insert failed:", error.message);
    return null;
  }
  return id;
}

// Verify a batch of REVIEW-tier matches concurrently (bounded). Returns the
// verdicts; the caller applies confirms (≥ minConfidence) and drops the rest.
export async function verifyApMatches(matches: ApMatch[], opts: { concurrency?: number; staffNames?: string[] } = {}): Promise<ApVerdict[]> {
  const conc = opts.concurrency ?? 6;
  const staffNames = opts.staffNames ?? (await loadStaffNames());
  const out: ApVerdict[] = [];
  for (let i = 0; i < matches.length; i += conc) {
    const batch = matches.slice(i, i + conc);
    out.push(...(await Promise.all(batch.map((m) => verifyApMatch(m, staffNames).catch((): ApVerdict => ({ bankLineId: m.bankLineId, invoiceId: m.invoiceId, verdict: "uncertain", confidence: 0, reason: "verifier error", payAndClaim: false, paidBy: null }))))));
  }
  return out;
}

export type ReviewApplyResult = {
  committed: boolean;
  reviewed: number;
  confirmedApplied: number;
  rejected: number;
  uncertain: number;
  payAndClaim: number;
};

// The autonomous review-tier step: LLM-verify every REVIEW match, auto-apply the
// confident confirms, drop the rejects, leave only genuine uncertainties for a
// human. This is what shrinks the bookkeeper's queue toward nothing.
export async function applyVerifiedReview(opts: { commit?: boolean; sinceDays?: number; minConfidence?: number; markOpenPaid?: boolean } = {}): Promise<ReviewApplyResult> {
  const commit = opts.commit ?? false;
  const minConfidence = opts.minConfidence ?? 0.9;
  // Same policy as applyApMatches: reconcile-only by default (Telegram POP is
  // the primary payer). An LLM-confirmed match that would mark an OPEN invoice
  // paid waits for the EOM bank reconciliation; link-only reconciliations still
  // apply so POP-paid invoices leave the P&L opex pile promptly.
  const markOpenPaid = opts.markOpenPaid ?? false;
  const { review } = await proposeApMatches({ sinceDays: opts.sinceDays });
  const staffNames = await loadStaffNames();
  const verdicts = await verifyApMatches(review, { staffNames });
  const byLine = new Map(verdicts.map((v) => [v.bankLineId, v]));
  let confirmedApplied = 0, rejected = 0, uncertain = 0, payAndClaim = 0;
  for (const m of review) {
    const v = byLine.get(m.bankLineId);
    // Pay-and-claim: staff fronted the vendor payment and was reimbursed, so the
    // bank line carries the staff name. The invoice IS settled - this is NOT a
    // wrong match. Route it to the human finance queue (never auto-clear on a
    // fuzzy name match), and tell the owner what it actually is - no "wrong
    // match" correction.
    if (v?.payAndClaim) {
      payAndClaim++;
      // Ask the owner on Telegram to approve clearing it — one tap on ✅ Clear
      // settles the invoice (dispatched by the pulse webhook). Dedup so the
      // daily re-run doesn't re-ask about the same still-open bank line, and
      // only ask on a committed run (not a dry run).
      let asked = false;
      if (commit && !(await pendingPromptExists("finance_ap_verifier", m.bankLineId))) {
        const promptId = await askOwner({
          agentKey: "finance_ap_verifier",
          kind: "confirm",
          prompt: `Staff pay-and-claim: the ${m.payee} invoice (RM${m.amount.toFixed(2)}) looks like it was paid by ${v.paidBy ?? "a staff member"} out of pocket and reimbursed. Clear it (mark the invoice settled)?`,
          options: [
            { label: "✅ Clear it", value: "clear" },
            { label: "🛑 Not this", value: "reject" },
          ],
          refTable: "fin_bank_lines",
          refId: m.bankLineId,
          payload: { action: "clear_ap_match", approveValue: "clear", match: m },
          expiresInHours: 72,
        });
        asked = !!promptId;
      }
      if (!asked) {
        // Two-way not configured (or already asked / dry run): leave it in the
        // finance inbox with a plain-English note, don't auto-clear.
        await logAgentMessage({
          fromAgent: "finance_ap_verifier",
          toAgent: "owner",
          kind: "handoff",
          summary: `Staff pay-and-claim: the ${m.payee} invoice (RM${m.amount.toFixed(2)}) was paid by ${v.paidBy ?? "a staff member"} and reimbursed. Valid settlement - in your finance inbox to confirm, not cleared automatically.`,
          detail: v.reason,
          refTable: "fin_bank_lines",
          refId: m.bankLineId,
          notify: false,
        });
      }
      continue;
    }
    if (v?.verdict === "reject") {
      rejected++;
      // The verifier caught a wrong match and is teaching the matcher not to
      // clear it. This is the "verifier finds a problem and says what's right"
      // moment the owner wants to see - recorded as a correction on the feed.
      await logAgentMessage({
        fromAgent: "finance_ap_verifier",
        toAgent: "finance_ap_agent",
        kind: "correction",
        summary: `Stopped a wrong match: the bank payment to ${m.payee} (RM${m.amount.toFixed(2)}) is NOT settling that invoice, so it should not be cleared.`,
        detail: v.reason,
        refTable: "fin_bank_lines",
        refId: m.bankLineId,
      });
      continue;
    }
    if (v?.verdict === "confirm" && v.confidence >= minConfidence) {
      if (!m.linkOnly && !markOpenPaid) { uncertain++; continue; }
      if (commit) {
        await writeApMatch(m);
        if (v.decisionId) await markDecisionApplied(v.decisionId);
      }
      confirmedApplied++;
    } else {
      uncertain++;
    }
  }
  return { committed: commit, reviewed: review.length, confirmedApplied, rejected, uncertain, payAndClaim };
}
