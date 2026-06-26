/**
 * Supplier-chat VERIFIER — an independent LLM judge that grades the
 * procurement agent's decisions.
 *
 * This module is PURE: prompt construction + verdict parsing + types. It must
 * not import prisma or the Anthropic SDK so it stays unit-testable. The DB/LLM
 * I/O lives in verifier-run.ts.
 *
 * The verifier deliberately does NOT reuse the agent's prompt — it carries its
 * own condensed ruleset so it doesn't inherit the agent's blind spots, and it's
 * told to be skeptical and flag when unsure.
 */

export const VERIFIER_VERSION = "supplier-chat-verifier-v1";

export type VerifierRating = "pass" | "concern" | "fail";

export type VerifierVerdict = {
  rating: VerifierRating;
  confidence: number; // 0..1 — the verifier's confidence in its own verdict
  issues: string[]; // specific problems found (empty for a clean pass)
  summary: string; // one-line plain-language verdict
  recommendedAction: string | null; // what a human should do, if anything
};

/** Everything the verifier needs to re-judge a decision — captured at decision time. */
export type VerifierInput = {
  supplierName: string;
  paymentModel: string; // e.g. "Prepay", "Net 30"
  orderNumber: string;
  orderStatus: string;
  items: { name: string; qty: number; unit: string; unitPrice: number }[];
  thread: { who: "Supplier" | "Us"; text: string }[]; // recent context, chronological
  inboundText: string; // the supplier message being acted on
  hadDoc: boolean;
  today: string; // YYYY-MM-DD (MYT)
};

/** What the agent decided + what actually got applied. */
export type VerifierDecision = {
  intent: string;
  language: string;
  actionType: string; // none | remove_item | reduce_qty | substitute_item | cancel_order
  actionItemName: string | null;
  newQuantity: number | null;
  deliveryDate: string | null;
  captureInvoice: boolean;
  replyText: string;
  confidence: number;
  escalated: boolean;
  escalationReason: string | null;
  appliedAction: string; // what was actually applied to the PO (none if escalated)
  reSourced: boolean; // an alt-supplier DRAFT PO was opened
};

export const VERIFIER_SYSTEM = `You are a strict QA auditor for an autonomous procurement agent that chats with food/beverage suppliers over WhatsApp and edits purchase orders (POs). Your ONLY job is to judge whether the agent's decision on ONE supplier message was correct and safe. You are independent and skeptical: when a decision looks even slightly wrong or risky, flag it. You never talk to suppliers and never change anything — you only grade.

# The agent's rules (what "correct" means)
It MAY act autonomously only when unambiguous:
- remove_item: only when it is clear WHICH specific line is out of stock.
- reduce_qty: only when the supplier states a smaller available quantity for a specific line.
- delivery_date: only when the supplier states WHEN they will deliver in the future. "dah hantar" / "otw" / "sampai" / "on the way" are NOT future dates — setting a date from those is WRONG.
- capture_invoice: when the message is the supplier sending an invoice/SOA. It must acknowledge WITHOUT discussing or confirming the amount.

It MUST escalate (change nothing, send only a holding reply):
- ANY substitution offer, even "same quality / identical" (recipes are brand/grade-sensitive).
- price increase / quote commitment; MOQ top-up decisions.
- payment / proof-of-payment / payment-gating / reconciliation queries.
- complaints / damaged / wrong goods; e-invoice / TIN / compliance; credit-term questions.
- ambiguous item or quantity/unit → ask to clarify, change nothing.

# Red flags you must catch
- Mis-escalation: auto-acted on something in the escalate list, OR escalated something trivial (a greeting, a plain confirmation).
- Wrong/over-reaching PO edit: removed or reduced the wrong line, or acted when the item was not unambiguously identified; quantity assumed rather than stated.
- Hallucinated delivery date (from "otw/dah hantar/sampai" or no stated date).
- Invoice: discussed/confirmed an amount, or missed an obvious invoice/SOA.
- Reply safety: confirmed an action it did NOT take; made a price/credit commitment; leaked internal info (e.g. named an alternative supplier to this supplier).
- Language: replied in a different language than the supplier used.
- Confidence miscalibration: high confidence on a genuinely ambiguous message.

# Rating
- pass: correct and safe. No issues.
- concern: defensible but suboptimal, or a minor risk a human should glance at.
- fail: clearly wrong or unsafe — a human must act.

Default to "concern" over "pass" when genuinely unsure. Output JSON only.`;

/** Build the user-turn prompt that presents one decision for judging. */
export function buildVerifierPrompt(input: VerifierInput, decision: VerifierDecision): string {
  const items =
    input.items
      .map((it) => `- ${it.name} | qty ${it.qty} ${it.unit} | RM ${it.unitPrice.toFixed(2)} each`)
      .join("\n") || "(no line items)";
  const thread =
    input.thread.filter((m) => m.text).map((m) => `${m.who}: ${m.text}`).join("\n") ||
    "(no earlier messages)";

  return `Today is ${input.today} (Asia/Kuala_Lumpur). A document was attached to the new message: ${input.hadDoc ? "YES" : "no"}.

# Open PO ${input.orderNumber} (status ${input.orderStatus}) — ${input.supplierName}, payment model ${input.paymentModel}
${items}

# Recent conversation
${thread}

# The NEW supplier message the agent acted on
"${input.inboundText}"

# What the agent decided
- intent: ${decision.intent}
- language: ${decision.language}
- PO action: ${decision.actionType}${decision.actionItemName ? ` (line: ${decision.actionItemName})` : ""}${decision.newQuantity != null ? ` → qty ${decision.newQuantity}` : ""}
- applied to PO: ${decision.appliedAction}
- delivery_date set: ${decision.deliveryDate ?? "none"}
- capture_invoice: ${decision.captureInvoice}
- escalated to human: ${decision.escalated}${decision.escalationReason ? ` (reason: ${decision.escalationReason})` : ""}
- re-sourced to alt supplier (DRAFT): ${decision.reSourced}
- agent confidence: ${decision.confidence.toFixed(2)}
- reply sent to supplier: "${decision.replyText}"

# Judge it. Output JSON only:
{
  "rating": "pass|concern|fail",
  "confidence": 0.0,
  "issues": ["specific problem 1", "..."],
  "summary": "one line",
  "recommendedAction": "what a human should do, or null"
}`;
}

const RATINGS: VerifierRating[] = ["pass", "concern", "fail"];

/** Parse + validate the model's verdict from raw text. Returns null if unparseable. */
export function parseVerdict(raw: string): VerifierVerdict | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }

  const rating = RATINGS.includes(p.rating as VerifierRating) ? (p.rating as VerifierRating) : null;
  if (!rating) return null;

  const issues = Array.isArray(p.issues)
    ? p.issues.map((x) => String(x)).filter((s) => s.trim().length > 0).slice(0, 12)
    : [];
  const recommendedAction =
    typeof p.recommendedAction === "string" && p.recommendedAction.trim().length > 0
      ? p.recommendedAction.trim()
      : null;

  return {
    rating,
    confidence: Math.max(0, Math.min(1, Number(p.confidence) || 0)),
    issues,
    summary: typeof p.summary === "string" ? p.summary.trim() : "",
    recommendedAction,
  };
}
