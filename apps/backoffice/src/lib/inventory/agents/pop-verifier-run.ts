/**
 * POP-match verifier runner — the DB + LLM shell around the pure pop-verifier core.
 *
 * Called from the Telegram POP matcher at its two dead-ends:
 *   - rescueNoMatch():  the deterministic matcher found NO invoice. We ask the judge to
 *                       scan the open invoices for the one this POP really pays.
 *   - judgeDuplicate(): the matcher would block this POP because its bank ref already sits
 *                       on a paid invoice. We ask the judge: same payment re-sent, or a
 *                       distinct payment sharing a ref?
 *
 * MONEY SAFETY — auto-pay is gated in CODE, never on the model's word:
 *   - PROCUREMENT_POP_VERIFIER_ENABLED gates the judge running at all (shadow: it proposes
 *     + flags, but never pays).
 *   - PROCUREMENT_POP_VERIFIER_AUTOPAY additionally allows an actual PAID write, and ONLY
 *     when: verdict="pay" AND confidence ≥ 0.9 AND the amount re-matches in code (±RM1) AND
 *     the payee corroborates (recipient account / name / invoice-ref) AND it's not a genuine
 *     re-send. Otherwise it falls back to "propose" (Telegram message + an invoice flag for
 *     finance to confirm) — so a real payment is never silently dropped, but the AI never
 *     moves money on a hunch.
 *
 * Never throws — any failure returns a "no-op" outcome so the caller falls back to its
 * original deterministic behaviour.
 */
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { appendInvoiceFlags, type InvoiceFlag } from "@/lib/inventory/flag-detector";
import { recentPopLessons } from "@/lib/inventory/agents/pop-lessons";
import { getAgentModeOrDefault, logAgentAction, touchAgentRun, type AgentMode } from "@celsius/agents/src/substrate";
import {
  POP_VERIFIER_SYSTEM,
  POP_VERIFIER_VERSION,
  buildPopVerifierPrompt,
  parsePopVerdict,
  type PopVerifierInput,
  type PopVerifierVerdict,
  type PopForVerify,
  type CandidateInvoice,
} from "@/lib/inventory/agents/pop-verifier";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AUTOPAY_CONFIDENCE = 0.9;
const AUTOPAY_AMOUNT_TOL = 1.0; // RM — code re-check; bigger gaps fall to "propose", not auto-pay

export const POP_VERIFIER_AGENT_KEY = "procurement_pop_verifier";

/**
 * Mode now comes from the agent registry (the `/agents` panel), not env vars —
 * the env gates left this judge dark for its whole life (0 verdicts ever
 * stamped) while the code sat finished. Mapping:
 *   off    → judge never runs (matcher keeps its original dead-end behaviour)
 *   shadow → judge runs, proposes + flags — NEVER writes money
 *   armed  → shadow + the auto-pay path opens (still code-gated: verdict="pay"
 *            AND confidence ≥0.9 AND amount re-match AND payee corroboration)
 * PROCUREMENT_POP_VERIFIER_ENABLED=false remains an emergency env kill switch.
 */
async function popVerifierMode(): Promise<AgentMode> {
  if (process.env.PROCUREMENT_POP_VERIFIER_ENABLED === "false") return "off";
  if (!process.env.ANTHROPIC_API_KEY) return "off";
  return getAgentModeOrDefault(POP_VERIFIER_AGENT_KEY, "off");
}

// Same include the webhook uses, so a rescued invoice can be paid by the normal path unchanged.
const POP_INCLUDE = {
  supplier: { select: { id: true, name: true, telegramChatId: true, bankAccountNumber: true, bankName: true, depositTermsDays: true } },
  outlet: { select: { name: true, code: true } },
  order: { select: { orderNumber: true, claimedBy: { select: { id: true, name: true, bankAccountNumber: true, bankName: true } } } },
} as const;

/* eslint-disable @typescript-eslint/no-explicit-any -- loaded invoice rows are untyped here, like the webhook */
export type NoMatchOutcome =
  | { action: "pay"; invoice: any } // caller: candidates = [invoice]; fall through to the pay path
  | { action: "notify"; message: string } // caller: send this Telegram message; do not pay
  | { action: "none" }; // caller: keep its original "no matching invoice" message

export type DuplicateOutcome =
  | { action: "pay" } // caller: proceed PAST the duplicate block and pay the candidate
  | { action: "notify"; message: string }
  | { action: "none" }; // caller: keep its original "duplicate blocked" message

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const norm = (s: string | null | undefined) => (s ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
const tokens = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function todayMyt(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function payeeName(inv: any): string {
  return inv.supplier?.name ?? inv.order?.claimedBy?.name ?? inv.vendorName ?? "?";
}
function payeeAccount(inv: any): string {
  return digits(inv.supplier?.bankAccountNumber ?? inv.order?.claimedBy?.bankAccountNumber);
}

function toCandidate(inv: any): CandidateInvoice {
  return {
    invoiceNumber: inv.invoiceNumber,
    payeeName: payeeName(inv),
    payeeAccount: payeeAccount(inv) || null,
    amount: Number(inv.amount),
    depositAmount: inv.depositAmount != null ? Number(inv.depositAmount) : null,
    outlet: inv.outlet?.name ?? inv.outlet?.code ?? null,
    status: inv.status,
    dueDate: inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : null,
  };
}

// Independent code re-check that the POP amount really matches this invoice (the LLM's
// "pay" is NOT enough to move money). Returns whether it matches + deposit-vs-full.
function amountMatch(inv: any, popAmount: number): { ok: boolean; isDepositMatch: boolean } {
  const full = Number(inv.amount);
  const dep = inv.depositAmount != null ? Number(inv.depositAmount) : null;
  const matchesFull = Math.abs(full - popAmount) <= AUTOPAY_AMOUNT_TOL;
  const matchesDep = dep != null && Math.abs(dep - popAmount) <= AUTOPAY_AMOUNT_TOL;
  return { ok: matchesFull || matchesDep, isDepositMatch: !matchesFull && matchesDep };
}

// Independent code re-check that the payee corroborates (account / name / invoice ref) — so
// an auto-pay can't fire on amount coincidence alone.
function corroborates(inv: any, pop: PopForVerify): boolean {
  const popAcct = digits(pop.recipientAccount);
  const acct = payeeAccount(inv);
  const acctOk = popAcct.length >= 6 && acct.length >= 6 && (acct.includes(popAcct) || popAcct.includes(acct));

  const pn = norm(pop.recipientName);
  const cn = norm(payeeName(inv));
  let nameOk = false;
  if (pn.length >= 4 && cn.length >= 4) {
    nameOk = pn.includes(cn) || cn.includes(pn);
    if (!nameOk) {
      const tb = new Set(tokens(payeeName(inv)));
      nameOk = tokens(pop.recipientName).some((t) => t.length >= 4 && tb.has(t));
    }
  }

  const r = norm(pop.invoiceReference);
  const i = norm(inv.invoiceNumber);
  const refOk = r.length >= 4 && (i === r || i.endsWith(r) || r.endsWith(i));

  return acctOk || nameOk || refOk;
}

async function judge(input: PopVerifierInput): Promise<PopVerifierVerdict | null> {
  const lessons = await recentPopLessons().catch(() => "");
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 700,
    system: [{ type: "text", text: POP_VERIFIER_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildPopVerifierPrompt(input, lessons) }],
  });
  const out = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return parsePopVerdict(out);
}

async function recordAudit(
  invoiceId: string,
  m: {
    scenario: "no_match" | "duplicate_blocked";
    verdict: PopVerifierVerdict;
    payee: string;
    autoPaid: boolean;
    popAmount: number;
  },
): Promise<void> {
  try {
    const flag: InvoiceFlag = {
      code: "POP_VERIFIER",
      message: `${m.autoPaid ? "AI auto-marked paid" : "AI: possible missed payment"} — POP RM ${m.popAmount.toFixed(
        2,
      )} (${m.scenario}, ${(m.verdict.confidence * 100).toFixed(0)}% conf). ${escapeHtml(m.verdict.reasoning)}`.slice(0, 300),
      detectedAt: new Date().toISOString(),
      // Auto-paid → nothing for finance to do, pre-dismiss so it doesn't nag. A proposal stays
      // ACTIVE so it surfaces in the reconciliation board for a human to confirm.
      ...(m.autoPaid ? { dismissed: true, dismissedAt: new Date().toISOString() } : {}),
      meta: {
        scenario: m.scenario,
        decision: m.verdict.decision,
        confidence: m.verdict.confidence,
        payee: m.payee,
        isGenuineDuplicate: m.verdict.isGenuineDuplicate,
        autoPaid: m.autoPaid,
        version: POP_VERIFIER_VERSION,
      },
    };
    await appendInvoiceFlags(invoiceId, [flag]);
  } catch (e) {
    console.warn("[pop-verifier] audit flag failed:", e instanceof Error ? e.message : e);
  }
}

function proposeMessage(inv: any, popAmount: number, v: PopVerifierVerdict, isDepositMatch: boolean): string {
  return `⚠️ <b>Possible missed payment</b>\nPOP RM ${popAmount.toFixed(2)} looks like it pays <b>${
    inv.invoiceNumber
  }</b> (${escapeHtml(payeeName(inv))}, RM ${Number(inv.amount).toFixed(2)}${
    isDepositMatch ? " — deposit" : ""
  }).\n<i>${escapeHtml(v.reasoning)}</i>\n\nThe matcher missed it — verify &amp; mark paid in the invoices tab (flagged there). [${(
    v.confidence * 100
  ).toFixed(0)}% conf]`;
}

function distinctMessage(inv: any, popAmount: number, v: PopVerifierVerdict): string {
  return `⚠️ <b>Likely NOT a duplicate</b>\nThis POP (RM ${popAmount.toFixed(2)}) looks like a DISTINCT payment for <b>${
    inv.invoiceNumber
  }</b> — the bank ref just repeats, it isn't a re-send.\n<i>${escapeHtml(
    v.reasoning,
  )}</i>\n\nVerify &amp; mark paid in the invoices tab. [${(v.confidence * 100).toFixed(0)}% conf]`;
}

/**
 * Dead-end #1: the deterministic matcher found ZERO candidates. Scan open invoices for the
 * one this POP genuinely pays. Returns a "pay" outcome (caller pays it via the normal path)
 * only when armed + confident + code-corroborated; otherwise proposes or no-ops.
 */
export async function rescueNoMatch(pop: PopForVerify, popAmount: number): Promise<NoMatchOutcome> {
  const mode = await popVerifierMode();
  if (mode === "off") return { action: "none" };
  try {
    await touchAgentRun(POP_VERIFIER_AGENT_KEY);
    const open = await prisma.invoice.findMany({
      where: { status: { in: ["PENDING", "INITIATED", "OVERDUE"] } },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: POP_INCLUDE,
    });
    if (open.length === 0) return { action: "none" };

    const candidates = open.map((inv) => toCandidate(inv as any));
    const verdict = await judge({ pop, today: todayMyt(), scenario: { kind: "no_match", openInvoices: candidates } });
    if (!verdict) return { action: "none" };

    const chosen =
      verdict.targetRef != null && verdict.targetRef <= open.length ? (open[verdict.targetRef - 1] as any) : null;

    if (!chosen || verdict.decision === "no_action") {
      await logAgentAction({
        agentKey: POP_VERIFIER_AGENT_KEY,
        kind: "verdict",
        summary: `no_match POP RM${popAmount.toFixed(2)} → no_action (${(verdict.confidence * 100).toFixed(0)}%)`,
        confidence: verdict.confidence,
        meta: { scenario: "no_match", decision: verdict.decision, mode },
      });
      return { action: "none" };
    }

    const amt = amountMatch(chosen, popAmount);
    const corro = corroborates(chosen, pop);
    const canAuto =
      mode === "armed" && verdict.decision === "pay" && verdict.confidence >= AUTOPAY_CONFIDENCE && amt.ok && corro;

    await recordAudit(chosen.id, { scenario: "no_match", verdict, payee: payeeName(chosen), autoPaid: canAuto, popAmount });
    await logAgentAction({
      agentKey: POP_VERIFIER_AGENT_KEY,
      kind: canAuto ? "auto_pay" : "propose",
      summary: `no_match POP RM${popAmount.toFixed(2)} → ${chosen.invoiceNumber} (${payeeName(chosen)}) ${
        canAuto ? "auto-paid" : "proposed"
      } (${(verdict.confidence * 100).toFixed(0)}%)`,
      refTable: "Invoice",
      refId: chosen.id,
      confidence: verdict.confidence,
      meta: { scenario: "no_match", decision: verdict.decision, amountOk: amt.ok, corroborated: corro, mode },
    });

    if (canAuto) return { action: "pay", invoice: chosen };
    return { action: "notify", message: proposeMessage(chosen, popAmount, verdict, amt.isDepositMatch) };
  } catch (e) {
    console.warn("[pop-verifier] rescueNoMatch failed:", e instanceof Error ? e.message : e);
    return { action: "none" };
  }
}

/**
 * Dead-end #2: the matcher would block this POP as a duplicate (its ref is on a paid invoice).
 * Judge same-payment-re-send vs distinct-payment-sharing-a-ref. Returns "pay" (proceed past
 * the block) only when armed + confident + corroborated AND not a genuine duplicate.
 */
export async function judgeDuplicate(args: {
  pop: PopForVerify;
  popAmount: number;
  invoice: any;
  existingPaid: { invoiceNumber: string; amount: number; paidAt: string | null; paymentRef: string | null };
}): Promise<DuplicateOutcome> {
  const mode = await popVerifierMode();
  if (mode === "off") return { action: "none" };
  try {
    await touchAgentRun(POP_VERIFIER_AGENT_KEY);
    const candidate = toCandidate(args.invoice);
    const verdict = await judge({
      pop: args.pop,
      today: todayMyt(),
      scenario: { kind: "duplicate_blocked", candidate, existingPaid: args.existingPaid },
    });
    if (!verdict) return { action: "none" };

    if (verdict.isGenuineDuplicate || verdict.decision === "no_action") {
      await recordAudit(args.invoice.id, {
        scenario: "duplicate_blocked",
        verdict,
        payee: payeeName(args.invoice),
        autoPaid: false,
        popAmount: args.popAmount,
      });
      await logAgentAction({
        agentKey: POP_VERIFIER_AGENT_KEY,
        kind: "verdict",
        summary: `duplicate POP RM${args.popAmount.toFixed(2)} on ${args.invoice.invoiceNumber} → genuine re-send, block kept (${(verdict.confidence * 100).toFixed(0)}%)`,
        refTable: "Invoice",
        refId: args.invoice.id,
        confidence: verdict.confidence,
        meta: { scenario: "duplicate_blocked", decision: verdict.decision, isGenuineDuplicate: true, mode },
      });
      return { action: "none" }; // genuinely the same payment — keep the block
    }

    const amt = amountMatch(args.invoice, args.popAmount);
    const corro = corroborates(args.invoice, args.pop);
    const canAuto =
      mode === "armed" && verdict.decision === "pay" && verdict.confidence >= AUTOPAY_CONFIDENCE && amt.ok && corro;

    await recordAudit(args.invoice.id, {
      scenario: "duplicate_blocked",
      verdict,
      payee: payeeName(args.invoice),
      autoPaid: canAuto,
      popAmount: args.popAmount,
    });
    await logAgentAction({
      agentKey: POP_VERIFIER_AGENT_KEY,
      kind: canAuto ? "auto_pay" : "propose",
      summary: `duplicate POP RM${args.popAmount.toFixed(2)} on ${args.invoice.invoiceNumber} → distinct payment, ${
        canAuto ? "auto-paid" : "proposed"
      } (${(verdict.confidence * 100).toFixed(0)}%)`,
      refTable: "Invoice",
      refId: args.invoice.id,
      confidence: verdict.confidence,
      meta: { scenario: "duplicate_blocked", decision: verdict.decision, amountOk: amt.ok, corroborated: corro, mode },
    });

    if (canAuto) return { action: "pay" };
    return { action: "notify", message: distinctMessage(args.invoice, args.popAmount, verdict) };
  } catch (e) {
    console.warn("[pop-verifier] judgeDuplicate failed:", e instanceof Error ? e.message : e);
    return { action: "none" };
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
