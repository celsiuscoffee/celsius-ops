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
import { randomUUID } from "crypto";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const CATEGORIZER_VERSION = "categorizer-v1";

export type CategorizationInput = {
  supplierName: string;
  supplierId?: string | null;
  lineItems: Array<{ description: string; quantity?: number; amount: number }>;
  total: number;
  outletHint?: { id: string; name: string } | null;
  contextNotes?: string;
};

export type CategorizationResult = {
  accountCode: string | null;
  confidence: number;
  reasoning: string;
  alternativeCodes: string[];   // top 3 alternatives the human can pick from in the inbox
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

// Pulls the last 5 categorizations for this supplier — strongest signal.
async function supplierHistory(
  supplierId: string | null | undefined
): Promise<Array<{ accountCode: string; total: number; date: string }>> {
  if (!supplierId) return [];
  const client = getFinanceClient();
  const { data } = await client
    .from("fin_bills")
    .select("transaction_id, total, bill_date")
    .eq("supplier_id", supplierId)
    .not("transaction_id", "is", null)
    .order("bill_date", { ascending: false })
    .limit(5);
  if (!data || data.length === 0) return [];

  const txnIds = data.map((b) => b.transaction_id).filter(Boolean) as string[];
  const { data: lines } = await client
    .from("fin_journal_lines")
    .select("transaction_id, account_code, debit")
    .in("transaction_id", txnIds)
    .gt("debit", 0);

  // For each bill, the debit line that's NOT 3001 (AP) is the expense code.
  const txnToCode = new Map<string, string>();
  for (const l of lines ?? []) {
    if (l.account_code === "3001") continue;
    if (!txnToCode.has(l.transaction_id as string)) {
      txnToCode.set(l.transaction_id as string, l.account_code as string);
    }
  }

  return data
    .map((b) => ({
      accountCode: txnToCode.get(b.transaction_id as string) ?? "",
      total: Number(b.total),
      date: b.bill_date as string,
    }))
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
  await logDecision(input, result);

  return result;
}

async function logDecision(
  input: CategorizationInput,
  result: CategorizationResult
): Promise<void> {
  const client = getFinanceClient();
  await client.from("fin_agent_decisions").insert({
    id: randomUUID(),
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
    applied: false,  // set by AP agent / inbox resolver when actually used
  });
}
