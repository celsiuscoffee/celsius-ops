/**
 * Verifier runner — the DB + LLM shell around the pure verifier core.
 *
 * Reads an agent decision snapshot (raw.verifierInput / raw.verifierDecision
 * stamped by supplier-chat-agent), asks an independent Claude judge to grade it,
 * and stamps the verdict back onto the message's raw.verifier.
 *
 * SAFE: shadow-mode (PROCUREMENT_VERIFIER_ENABLED), flags only — never edits a
 * PO, never messages a supplier. Idempotent: a message already carrying
 * raw.verifier is skipped.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import {
  VERIFIER_SYSTEM,
  VERIFIER_VERSION,
  buildVerifierPrompt,
  parseVerdict,
  type VerifierInput,
  type VerifierDecision,
  type VerifierVerdict,
} from "@/lib/inventory/agents/verifier";
import { logAgentMessage } from "@celsius/agents/src/messages";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export function verifierEnabled(): boolean {
  return process.env.PROCUREMENT_VERIFIER_ENABLED === "true" && !!process.env.ANTHROPIC_API_KEY;
}

// Pre-send gate: when on, the agent judges a PLANNED auto-act before applying/sending and
// escalates instead of shipping a "fail". Separate flag so the gate can be rolled out
// independently of shadow-mode grading. Requires the verifier itself to be enabled.
export function verifierGateEnabled(): boolean {
  return process.env.PROCUREMENT_VERIFIER_GATE === "true" && verifierEnabled();
}

/**
 * Judge an in-flight decision BEFORE it's applied/sent (the pre-send gate), as opposed to
 * verifyMessage which grades an already-recorded message post-hoc. The caller uses the
 * verdict to hold + escalate on a fail. Best-effort: a judge error returns null (caller
 * proceeds as if ungated — fail-open, never blocks the supplier on an infra hiccup).
 */
export async function judgePlanned(
  input: VerifierInput,
  decision: VerifierDecision,
): Promise<VerifierVerdict | null> {
  if (!verifierEnabled()) return null;
  try {
    return await judge(input, decision);
  } catch (e) {
    console.warn("[verifier] pre-send judge failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function judge(input: VerifierInput, decision: VerifierDecision): Promise<VerifierVerdict | null> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    system: [
      // The judge's ruleset is identical every call — cache it.
      { type: "text", text: VERIFIER_SYSTEM, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: buildVerifierPrompt(input, decision) }],
  });
  const out = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return parseVerdict(out);
}

/** Verify one outbound agent-decision message. Returns the verdict (or null). */
export async function verifyMessage(messageId: string): Promise<VerifierVerdict | null> {
  if (!verifierEnabled()) return null;
  const msg = await prisma.whatsAppMessage.findUnique({
    where: { id: messageId },
    select: { id: true, raw: true },
  });
  if (!msg) return null;
  const raw = (msg.raw ?? {}) as Record<string, unknown>;
  if (!raw.agent) return null; // not an agent decision
  if (raw.verifier) return raw.verifier as unknown as VerifierVerdict; // already judged — idempotent

  const input = raw.verifierInput as VerifierInput | undefined;
  const decision = raw.verifierDecision as VerifierDecision | undefined;
  if (!input || !decision) return null; // pre-verifier message without a snapshot

  let verdict: VerifierVerdict | null = null;
  try {
    verdict = await judge(input, decision);
  } catch (e) {
    console.warn("[verifier] judge failed:", e instanceof Error ? e.message : e);
    return null;
  }
  if (!verdict) return null;

  await prisma.whatsAppMessage.update({
    where: { id: msg.id },
    data: {
      raw: {
        ...raw,
        verifier: { ...verdict, version: VERIFIER_VERSION, at: new Date().toISOString() },
      } as Prisma.InputJsonValue,
    },
  });

  // When the verifier isn't happy (concern/fail), it tells the supplier chat
  // agent what went wrong and what the right move is. This is the flagship
  // "verifier finds a problem and teaches the agent" case the owner wants to
  // see - recorded as a correction on the Conversations feed and pushed live.
  if (verdict.rating !== "pass") {
    await logAgentMessage({
      fromAgent: "procurement_verifier",
      toAgent: "procurement_supplier_chat",
      kind: "correction",
      summary: `Graded the reply to ${input.supplierName} as ${verdict.rating}: ${verdict.summary}${verdict.recommendedAction ? ` The right move: ${verdict.recommendedAction}.` : ""}`,
      detail: verdict.issues.length ? verdict.issues.join("; ") : undefined,
      refTable: "whatsapp_message",
      refId: msg.id,
    });
  }

  return verdict;
}

/** Verify the most recent agent decisions that don't yet have a verdict. */
export async function verifyRecentUnverified(
  limit = 10,
): Promise<{ enabled: boolean; verified: number; fail: number; concern: number; pass: number }> {
  if (!verifierEnabled()) return { enabled: false, verified: 0, fail: 0, concern: 0, pass: 0 };

  // Candidates: recent outbound messages, newest first. Over-fetch then filter
  // in JS for agent decisions that carry a snapshot but no verdict yet (robust
  // against fragile JSON-absence filters).
  const candidates = await prisma.whatsAppMessage.findMany({
    where: { direction: "outbound" },
    orderBy: { timestamp: "desc" },
    take: Math.max(60, limit * 8),
    select: { id: true, raw: true },
  });

  const todo = candidates
    .filter((m) => {
      const r = (m.raw ?? {}) as Record<string, unknown>;
      return !!r.verifierInput && !!r.verifierDecision && !r.verifier;
    })
    .slice(0, limit);

  let fail = 0,
    concern = 0,
    pass = 0,
    verified = 0;
  for (const m of todo) {
    const v = await verifyMessage(m.id);
    if (!v) continue;
    verified++;
    if (v.rating === "fail") fail++;
    else if (v.rating === "concern") concern++;
    else pass++;
  }
  return { enabled: true, verified, fail, concern, pass };
}
