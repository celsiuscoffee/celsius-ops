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
import { proposeApMatches, writeApMatch, type ApMatch } from "../ap-match";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type ApVerdict = {
  bankLineId: string;
  invoiceId: string;
  verdict: "confirm" | "reject" | "uncertain";
  confidence: number; // 0..1
  reason: string;
};

const SYSTEM = `You verify whether a bank payment settles a specific vendor invoice for a coffee chain. The invoice may be for raw materials, packaging, distribution, services, rent, or equipment — any supplier or service vendor (note: vendor names often contain words like "Marketing" or "Distribution" but are goods suppliers, not advertising spend). Be strict: a matching amount alone is NOT enough — Malaysian bank lines for salaries, part-timer wages ("PT Week"), statutory payments (EPF/SOCSO), owner draws, and unrelated companies frequently collide on amount. Confirm ONLY if the bank line's payee/reference clearly corresponds to the invoice's vendor (e.g. invoice "Unique Paper" matches bank "UNIQUE PAPER SDN"). Reject if the bank line is plainly a different kind of payment (payroll/PT-week, statutory, an internal transfer, or a different company). Use "uncertain" when you genuinely cannot tell. Output ONLY JSON: {"verdict":"confirm|reject|uncertain","confidence":0.0,"reason":"one short line"}.`;

function buildPrompt(m: ApMatch): string {
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

Does this bank payment settle this invoice?`;
}

function parse(text: string, m: ApMatch): ApVerdict {
  const fallback: ApVerdict = { bankLineId: m.bankLineId, invoiceId: m.invoiceId, verdict: "uncertain", confidence: 0, reason: "unparseable verifier response" };
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < 0) return fallback;
  try {
    const o = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    const v = o.verdict === "confirm" || o.verdict === "reject" ? o.verdict : "uncertain";
    const c = Math.max(0, Math.min(1, Number(o.confidence) || 0));
    return { bankLineId: m.bankLineId, invoiceId: m.invoiceId, verdict: v, confidence: c, reason: String(o.reason ?? "").slice(0, 140) };
  } catch { return fallback; }
}

export async function verifyApMatch(m: ApMatch): Promise<ApVerdict> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { bankLineId: m.bankLineId, invoiceId: m.invoiceId, verdict: "uncertain", confidence: 0, reason: "ANTHROPIC_API_KEY not set" };
  }
  const res = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 200,
    system: SYSTEM,
    messages: [{ role: "user", content: buildPrompt(m) }],
  });
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  return parse(text, m);
}

// Verify a batch of REVIEW-tier matches concurrently (bounded). Returns the
// verdicts; the caller applies confirms (≥ minConfidence) and drops the rest.
export async function verifyApMatches(matches: ApMatch[], opts: { concurrency?: number } = {}): Promise<ApVerdict[]> {
  const conc = opts.concurrency ?? 6;
  const out: ApVerdict[] = [];
  for (let i = 0; i < matches.length; i += conc) {
    const batch = matches.slice(i, i + conc);
    out.push(...(await Promise.all(batch.map((m) => verifyApMatch(m).catch((): ApVerdict => ({ bankLineId: m.bankLineId, invoiceId: m.invoiceId, verdict: "uncertain", confidence: 0, reason: "verifier error" }))))));
  }
  return out;
}

export type ReviewApplyResult = {
  committed: boolean;
  reviewed: number;
  confirmedApplied: number;
  rejected: number;
  uncertain: number;
};

// The autonomous review-tier step: LLM-verify every REVIEW match, auto-apply the
// confident confirms, drop the rejects, leave only genuine uncertainties for a
// human. This is what shrinks the bookkeeper's queue toward nothing.
export async function applyVerifiedReview(opts: { commit?: boolean; sinceDays?: number; minConfidence?: number } = {}): Promise<ReviewApplyResult> {
  const commit = opts.commit ?? false;
  const minConfidence = opts.minConfidence ?? 0.9;
  const { review } = await proposeApMatches({ sinceDays: opts.sinceDays });
  const verdicts = await verifyApMatches(review);
  const byLine = new Map(verdicts.map((v) => [v.bankLineId, v]));
  let confirmedApplied = 0, rejected = 0, uncertain = 0;
  for (const m of review) {
    const v = byLine.get(m.bankLineId);
    if (v?.verdict === "reject") { rejected++; continue; }
    if (v?.verdict === "confirm" && v.confidence >= minConfidence) {
      if (commit) await writeApMatch(m);
      confirmedApplied++;
    } else {
      uncertain++;
    }
  }
  return { committed: commit, reviewed: review.length, confirmedApplied, rejected, uncertain };
}
