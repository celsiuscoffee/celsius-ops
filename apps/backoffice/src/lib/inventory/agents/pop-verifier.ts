/**
 * POP-match VERIFIER — an independent LLM judge that re-checks the deterministic
 * proof-of-payment matcher, to PREVENT double-payments.
 *
 * The deterministic matcher (telegram/webhook resolvePop) is stateless: when it
 * can't land a clean match it hits a dead-end — "❌ no matching invoice" or
 * "⛔ duplicate POP blocked" — and leaves the invoice UNPAID. A real payment then
 * looks unpaid → finance pays again. This judge runs at exactly those two dead-ends
 * and decides whether a genuine payment is being dropped.
 *
 * This module is PURE: prompt construction + verdict parsing + types. No prisma, no
 * Anthropic SDK — the DB/LLM I/O lives in pop-verifier-run.ts, and the money-write
 * guardrails (confidence bar + amount/payee corroboration) are enforced THERE, in
 * code, never left to the model.
 *
 * The judge carries its own ruleset (not the matcher's) so it doesn't inherit the
 * matcher's blind spots, and it is told to be skeptical and to refuse to "pay" on
 * amount alone.
 */

export const POP_VERIFIER_VERSION = "pop-match-verifier-v1";

export type PopVerifierDecision = "pay" | "propose" | "no_action";

export type PopVerifierVerdict = {
  // pay      = this is unambiguously a real payment for exactly one invoice (the runner
  //            still re-checks amount + payee in code before any auto-pay).
  // propose  = a plausible match a human should confirm — surface it, don't auto-pay.
  // no_action= no genuine match / a true re-send duplicate — leave the matcher's outcome.
  decision: PopVerifierDecision;
  targetRef: number | null; // 1-based index into the open-invoice list (no_match scenario)
  isDepositMatch: boolean; // paying the deposit portion rather than the full amount
  isGenuineDuplicate: boolean; // duplicate scenario: true ⇒ same payment already recorded
  confidence: number; // 0..1 — the judge's confidence in its own verdict
  reasoning: string; // one-line plain-language rationale
  issues: string[]; // specific risks a human should know
};

export type PopForVerify = {
  amount: number;
  referenceNumber: string | null;
  recipientName: string | null;
  recipientAccount: string | null;
  recipientBank: string | null;
  invoiceReference: string | null;
  date: string | null;
};

/** One open invoice the POP could belong to (no_match scenario). */
export type CandidateInvoice = {
  invoiceNumber: string;
  payeeName: string; // supplier / staff claimant / one-off vendor
  payeeAccount: string | null; // their bank account on file (digits)
  amount: number;
  depositAmount: number | null;
  outlet: string | null;
  status: string;
  dueDate: string | null;
};

/** The already-PAID invoice that shares this POP's bank reference (duplicate scenario). */
export type ExistingPaidInvoice = {
  invoiceNumber: string;
  amount: number;
  paidAt: string | null;
  paymentRef: string | null;
};

export type PopVerifyScenario =
  | { kind: "no_match"; openInvoices: CandidateInvoice[] }
  | { kind: "duplicate_blocked"; candidate: CandidateInvoice; existingPaid: ExistingPaidInvoice };

export type PopVerifierInput = {
  pop: PopForVerify;
  today: string; // YYYY-MM-DD (MYT)
  scenario: PopVerifyScenario;
};

export const POP_VERIFIER_SYSTEM = `You are a strict QA auditor for an autonomous proof-of-payment (POP) matcher used by a Malaysian F&B company. A POP is a bank-transfer receipt (Maybank etc.) that finance uploads; the matcher tries to attach it to the right unpaid invoice and mark that invoice PAID. Your ONE job is to stop money mistakes — chiefly DOUBLE-PAYMENTS, which happen when a real payment fails to match so the invoice stays unpaid and finance pays it a second time.

You are independent, skeptical, and conservative. You judge ONE POP at one of two dead-ends the deterministic matcher hit, and you output JSON only.

# What "pay" requires (be strict)
Only choose "pay" when the POP unambiguously corresponds to EXACTLY ONE invoice:
- the POP amount equals the invoice's full amount OR its deposit amount, within about RM1 (small rounding / SST), AND
- the payee corroborates: the POP recipient name or recipient account matches that invoice's supplier / staff claimant / vendor, OR the POP's invoice-reference text clearly names that invoice number.
If amount matches but the payee does NOT corroborate → "propose", never "pay".
NEVER infer "pay" from the amount alone. NEVER "pay" when two or more invoices are equally plausible — choose "propose".

# "propose" vs "no_action"
- propose: a plausible single match a human should confirm (amount close but payee weakly corroborated, reference garbled, deposit-vs-full unclear, or your confidence is moderate).
- no_action: nothing here genuinely matches an open invoice — it is safe to leave unmatched for a human to investigate.

# Deposit vs full
Set isDepositMatch=true ONLY when the POP amount matches the invoice's depositAmount and clearly NOT the full amount. Prefer a full-amount match when both could apply.

# Duplicate-blocked scenario
The matcher refused to attach this POP because its bank reference already sits on a PAID invoice. Decide which is true:
- GENUINE re-send (the SAME payment uploaded twice): same amount AND same reference AND same payee as the already-paid invoice → isGenuineDuplicate=true, decision="no_action". Do NOT pay again.
- DISTINCT real payment that merely shares a bank reference or a shared corporate account (different amount, different payee, or a clearly separate invoice) → isGenuineDuplicate=false, and "pay" (if it cleanly matches the candidate) or "propose" (if unsure). This is the false-block that causes the double-pay.

# Confidence
Report your TRUE confidence 0..1. A money write only happens downstream when confidence is very high AND code re-confirms amount + payee, so do not inflate it. When genuinely unsure, prefer "propose" with moderate confidence over "pay".

Output JSON only.`;

/** Build the user-turn prompt presenting one POP + its dead-end scenario for judging. */
export function buildPopVerifierPrompt(input: PopVerifierInput, lessons = ""): string {
  const p = input.pop;
  const popBlock = [
    `- amount paid: RM ${p.amount.toFixed(2)}`,
    `- bank reference: ${p.referenceNumber ?? "—"}`,
    `- recipient name: ${p.recipientName ?? "—"}`,
    `- recipient account: ${p.recipientAccount ?? "—"}`,
    `- recipient bank: ${p.recipientBank ?? "—"}`,
    `- invoice reference text on the POP: ${p.invoiceReference ?? "—"}`,
    `- payment date: ${p.date ?? "—"}`,
  ].join("\n");

  let scenarioBlock: string;
  if (input.scenario.kind === "no_match") {
    const list =
      input.scenario.openInvoices
        .map((inv, i) => {
          const dep = inv.depositAmount != null ? ` | deposit RM ${inv.depositAmount.toFixed(2)}` : "";
          return `[${i + 1}] ${inv.invoiceNumber} | payee ${inv.payeeName}${
            inv.payeeAccount ? ` (acct ${inv.payeeAccount})` : ""
          } | RM ${inv.amount.toFixed(2)}${dep} | ${inv.outlet ?? "?"} | ${inv.status}${
            inv.dueDate ? ` | due ${inv.dueDate}` : ""
          }`;
        })
        .join("\n") || "(no open invoices)";
    scenarioBlock = `# Scenario: the matcher found NO invoice and was about to give up.
# Open (unpaid) invoices it could belong to — pick the one (if any) this POP genuinely pays.
# Return its number in "targetRef" (the [n] index). targetRef=null if none truly matches.
${list}`;
  } else {
    const c = input.scenario.candidate;
    const e = input.scenario.existingPaid;
    scenarioBlock = `# Scenario: DUPLICATE-blocked. The matcher would pay this candidate, but the POP's bank
# reference already sits on a PAID invoice, so it refused. Decide: same payment re-sent, or a
# distinct real payment sharing a reference?
# Candidate invoice to (maybe) pay:
[1] ${c.invoiceNumber} | payee ${c.payeeName}${c.payeeAccount ? ` (acct ${c.payeeAccount})` : ""} | RM ${c.amount.toFixed(
      2,
    )}${c.depositAmount != null ? ` | deposit RM ${c.depositAmount.toFixed(2)}` : ""} | ${c.outlet ?? "?"}
# Already-PAID invoice that shares the reference:
${e.invoiceNumber} | RM ${e.amount.toFixed(2)} | ref ${e.paymentRef ?? "—"}${e.paidAt ? ` | paid ${e.paidAt}` : ""}`;
  }

  return `Today is ${input.today} (Asia/Kuala_Lumpur).
${lessons ? `${lessons}\n` : ""}
# The POP (bank receipt) under review
${popBlock}

${scenarioBlock}

# Judge it. Output JSON only:
{
  "decision": "pay|propose|no_action",
  "targetRef": <the [n] index of the matching open invoice, or null>,
  "isDepositMatch": <true if the POP pays the deposit portion, else false>,
  "isGenuineDuplicate": <true only in the duplicate scenario when it's the same payment re-sent>,
  "confidence": 0.0,
  "reasoning": "one line",
  "issues": ["specific risk a human should know", "..."]
}`;
}

/** Parse + validate the model's verdict from raw text. Returns null if unparseable. */
export function parsePopVerdict(raw: string): PopVerifierVerdict | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }

  const decisions: PopVerifierDecision[] = ["pay", "propose", "no_action"];
  const decision = decisions.includes(p.decision as PopVerifierDecision)
    ? (p.decision as PopVerifierDecision)
    : null;
  if (!decision) return null;

  const targetRefNum = Number(p.targetRef);
  const targetRef = Number.isInteger(targetRefNum) && targetRefNum > 0 ? targetRefNum : null;

  const issues = Array.isArray(p.issues)
    ? p.issues.map((x) => String(x)).filter((s) => s.trim().length > 0).slice(0, 12)
    : [];

  return {
    decision,
    targetRef,
    isDepositMatch: p.isDepositMatch === true,
    isGenuineDuplicate: p.isGenuineDuplicate === true,
    confidence: Math.max(0, Math.min(1, Number(p.confidence) || 0)),
    reasoning: typeof p.reasoning === "string" ? p.reasoning.trim().slice(0, 300) : "",
    issues,
  };
}
