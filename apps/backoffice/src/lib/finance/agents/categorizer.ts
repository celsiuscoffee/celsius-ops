// Categorizer agent — Claude-backed account code suggestion. Used by AP
// (and later by AR for non-StoreHub income, and Matcher for unallocated bank
// txns).
//
// Prompt caching: the COA dump is the largest static input, ~3-4KB of text.
// We mark it cache_control: ephemeral so the second-onwards call within a
// 5-minute window pays only for the prompt-cache read.
//
// Model: claude-haiku-4-5 — fast and cheap; categorization is well within
// Haiku's strengths. Sonnet is overkill for "match this line to one of 60
// account codes given prior history".

import Anthropic from "@anthropic-ai/sdk";
import { getFinanceClient } from "../supabase";
import { prisma } from "@/lib/prisma";
import { resolveContra } from "../gl-posting-map";
import { randomUUID } from "crypto";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// v2: supplierHistory re-pointed from the dead fin_bills table to the live
// Invoice + ap-matched bank-line GL landing (2026-08 trap-table kill). The
// input distribution changed, so the version is bumped to keep eval cohorts
// comparable (finance-module skill rule).
export const CATEGORIZER_VERSION = "categorizer-v2";

export type CategorizationInput = {
  supplierName: string;
  supplierId?: string | null;
  lineItems: Array<{ description: string; quantity?: number; amount: number }>;
  total: number;
  outletHint?: { id: string; name: string } | null;
  contextNotes?: string;
  // Source artefact this categorization belongs to (e.g. the fin_documents
  // row). Written to fin_agent_decisions.related_type/related_id so inbox
  // corrections can be attributed to THIS decision instead of "the latest".
  related?: { type: "document"; id: string } | null;
};

export type CategorizationResult = {
  accountCode: string | null;
  confidence: number;
  reasoning: string;
  alternativeCodes: string[];   // top 3 alternatives the human can pick from in the inbox
  decisionId?: string | null;   // fin_agent_decisions row logged for this call
};

// Pulls the categorize-able accounts (expenses + cogs + selected current
// assets like inventory). Excludes equity, AR, system controls.
async function loadCoa(): Promise<Array<{ code: string; name: string; type: string }>> {
  const client = getFinanceClient();
  const { data } = await client
    .from("fin_accounts")
    .select("code, name, type")
    .in("type", ["expense", "cogs", "asset"])
    .eq("is_active", true)
    .order("code");
  return (data ?? []).map((a) => ({
    code: a.code as string,
    name: a.name as string,
    type: a.type as string,
  }));
}

// Pulls the last 5 known account landings for this supplier — strongest
// signal. Live sources (fin_bills is dead/tombstoned):
//   1. The supplier's ap-matched bank payments and the account their GL
//      journal actually landed in (category → contra via resolveContra —
//      the same mapping the poster used).
//   2. Fallback: this agent's own recent decisions for the supplier, using
//      the human-corrected code when present.
async function supplierHistory(
  supplierId: string | null | undefined
): Promise<Array<{ accountCode: string; total: number; date: string }>> {
  if (!supplierId) return [];

  const invoices = await prisma.invoice.findMany({
    where: { supplierId },
    orderBy: { issueDate: "desc" },
    take: 50,
    select: { id: true },
  });
  if (invoices.length > 0) {
    const matched = await prisma.bankStatementLine.findMany({
      where: {
        apInvoiceId: { in: invoices.map((i) => i.id) },
        glTransactionId: { not: null },
      },
      orderBy: { txnDate: "desc" },
      take: 5,
      select: { category: true, description: true, amount: true, txnDate: true },
    });
    const hist = matched
      .map((l) => {
        const contra = resolveContra(l.category ?? "", l.description ?? "");
        return {
          accountCode: contra.suspense ? "" : contra.code,
          total: Number(l.amount),
          date: l.txnDate.toISOString().slice(0, 10),
        };
      })
      .filter((h) => h.accountCode);
    if (hist.length > 0) return hist;
  }

  // Fallback: prior decisions (covers suppliers billed but not yet
  // bank-matched). Corrected codes are ground truth; prefer them.
  const client = getFinanceClient();
  const { data } = await client
    .from("fin_agent_decisions")
    .select("input, output, corrected_to, created_at")
    .eq("agent", "categorizer")
    .eq("input->>supplier_id", supplierId)
    .order("created_at", { ascending: false })
    .limit(5);
  return (data ?? [])
    .map((d) => {
      const corrected = d.corrected_to as { accountCode?: string } | null;
      const output = d.output as { account_code?: string } | null;
      const input = d.input as { total?: number } | null;
      return {
        accountCode: corrected?.accountCode ?? output?.account_code ?? "",
        total: Number(input?.total ?? 0),
        date: String(d.created_at).slice(0, 10),
      };
    })
    .filter((h) => h.accountCode);
}

function buildPrompt(
  input: CategorizationInput,
  history: Array<{ accountCode: string; total: number; date: string }>,
  coa: Array<{ code: string; name: string; type: string }>
): string {
  const lineSummary = input.lineItems
    .map((l) => `- ${l.description} ${l.quantity ? `× ${l.quantity}` : ""} = RM ${l.amount.toFixed(2)}`)
    .join("\n");

  const historyText =
    history.length > 0
      ? history.map((h) => `  - ${h.date}: ${h.accountCode} (RM ${h.total.toFixed(2)})`).join("\n")
      : "  (no prior bills from this supplier)";

  return `You are categorizing a supplier bill for Celsius Coffee, a Malaysian F&B chain.

Match this bill to ONE account code from the chart of accounts below. Use prior categorizations from this supplier as the strongest signal.

# Bill
- Supplier: ${input.supplierName}
- Total: RM ${input.total.toFixed(2)}
- Outlet hint: ${input.outletHint?.name ?? "(none)"}
- Line items:
${lineSummary}

# Prior categorizations from this supplier (last 5)
${historyText}

${input.contextNotes ? `# Notes\n${input.contextNotes}\n` : ""}

# Decision rules
- If 3+ prior bills from this supplier all hit the same code AND nothing in the line items contradicts it, confidence = 0.95.
- If the line items clearly indicate a category (e.g. "Coffee Beans" → 6001-01) AND no prior history conflicts, confidence = 0.85-0.92.
- If line items are ambiguous or supplier is new, confidence = 0.5-0.75 — set account_code=null and propose 3 alternatives.
- Beverage suppliers split by what they sell: 6001-01 Coffee Beans, 6001-02 Base & Powder, 6001-03 Syrups, 6001-04 Milks, 6001-05 Beverage Others.
- Food cost = 6000-01 (raw materials) or 6000-02 (trading goods).
- Disposables (cups, lids, straws, packaging) = 6002.
- Utilities split by service: 6505-01 Electricity, 6505-02 Water, 6505-03 Internet, 6505-04 Telephone.

# Output
Return JSON only, no prose:
{
  "account_code": "6001-04" | null,
  "confidence": 0.0-1.0,
  "reasoning": "1-2 sentences explaining the choice or the ambiguity",
  "alternative_codes": ["code1", "code2", "code3"]
}`;
}

const COA_PRELUDE = `You are a finance categorizer for Celsius Coffee. Always return JSON exactly matching the schema given in the user message. Never include surrounding prose.`;

function buildCoaText(coa: Array<{ code: string; name: string; type: string }>): string {
  // Group by type for readability — the model parses this fine.
  const groups: Record<string, Array<{ code: string; name: string }>> = {};
  for (const a of coa) {
    if (!groups[a.type]) groups[a.type] = [];
    groups[a.type].push(a);
  }
  return Object.entries(groups)
    .map(([t, items]) =>
      `## ${t}\n` + items.map((i) => `- ${i.code}: ${i.name}`).join("\n")
    )
    .join("\n\n");
}

export async function categorize(input: CategorizationInput): Promise<CategorizationResult> {
  const [coa, history] = await Promise.all([
    loadCoa(),
    supplierHistory(input.supplierId),
  ]);

  const coaText = buildCoaText(coa);
  const prompt = buildPrompt(input, history, coa);

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 600,
    system: [
      { type: "text", text: COA_PRELUDE },
      // The COA list is reused across every categorization in a session;
      // mark it for prompt caching to avoid re-charging input tokens.
      { type: "text", text: `# Chart of accounts\n${coaText}`, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      accountCode: null,
      confidence: 0,
      reasoning: "Categorizer returned no JSON",
      alternativeCodes: [],
    };
  }

  let parsed: {
    account_code: string | null;
    confidence: number;
    reasoning: string;
    alternative_codes?: string[];
  };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return {
      accountCode: null,
      confidence: 0,
      reasoning: "Categorizer returned invalid JSON",
      alternativeCodes: [],
    };
  }

  const result: CategorizationResult = {
    accountCode: parsed.account_code,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    reasoning: parsed.reasoning ?? "",
    alternativeCodes: Array.isArray(parsed.alternative_codes)
      ? parsed.alternative_codes.slice(0, 3)
      : [],
  };

  // Log every decision for audit + retraining
  const decisionId = await logDecision(input, result);

  return { ...result, decisionId };
}

async function logDecision(
  input: CategorizationInput,
  result: CategorizationResult
): Promise<string | null> {
  const client = getFinanceClient(CATEGORIZER_VERSION);
  const id = randomUUID();
  // supabase-js does not throw — a swallowed error here silently starves the
  // eval dataset (fin_agent_decisions is the retraining ground truth).
  const { error } = await client.from("fin_agent_decisions").insert({
    id,
    agent: "categorizer",
    agent_version: CATEGORIZER_VERSION,
    input: {
      supplier_name: input.supplierName,
      supplier_id: input.supplierId ?? null,
      total: input.total,
      line_items: input.lineItems,
      outlet_hint: input.outletHint ?? null,
    },
    output: {
      account_code: result.accountCode,
      reasoning: result.reasoning,
      alternatives: result.alternativeCodes,
    },
    confidence: result.confidence,
    related_type: input.related?.type ?? null,
    related_id: input.related?.id ?? null,
    applied: false,  // set true by markDecisionApplied when the proposal is used as-is
  });
  if (error) {
    console.error("[categorizer] fin_agent_decisions insert failed:", error.message);
    return null;
  }
  return id;
}

// Called when a decision's proposal is actually used unchanged — the AP
// agent's auto-post path or an inbox "approve". Corrections don't set
// applied; corrected=true covers them (see recordCorrection in inbox.ts).
export async function markDecisionApplied(decisionId: string): Promise<void> {
  const client = getFinanceClient(CATEGORIZER_VERSION);
  const { error } = await client
    .from("fin_agent_decisions")
    .update({ applied: true })
    .eq("id", decisionId);
  if (error) {
    console.error("[categorizer] markDecisionApplied failed:", error.message);
  }
}
