// Procurement advisor - the LLM judgment layer on top of the deterministic
// reorder engine. The engine (computeReorderSuggestions) already decides WHAT is
// below reorder point and HOW MUCH to order (MOQ / pack / shelf-life bounded).
// The advisor adds the judgment a rule can't: given cash and Celsius's over-buy
// problem (COGS ~55% of revenue vs a ~35% target), what to order NOW vs hold.
//
// v1 is ADVISORY only - it recommends to the owner on Telegram, it does not
// create or send POs. The numbers come from the engine; the model never invents
// quantities, only prioritises and explains them.

import Anthropic from "@anthropic-ai/sdk";
import { computeReorderSuggestions, type ReorderGroup } from "@/lib/inventory/reorder-suggestions";
import { getAgentModeOrDefault, logAgentAction } from "@celsius/agents/src/substrate";
import { sendPulse } from "@celsius/agents/src/pulse";
import { logAgentMessage } from "@celsius/agents/src/messages";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-4-6";

const SYSTEM = `You are the procurement advisor for Celsius Coffee, a Malaysian coffee chain. You are given the day's reorder candidates ALREADY computed from par levels, current on-hand, open purchase orders, and the cheapest active supplier. The order quantities are already MOQ / pack-size / shelf-life / headroom bounded - trust them, never recompute or invent numbers.

Your job is JUDGMENT, not arithmetic. Celsius has a cost discipline problem: it spends ~55% of revenue buying stock vs a ~35% target, partly from over-buying. Lean toward the MINIMUM that avoids a stockout, not topping every bin. Decide what to ORDER NOW versus what can HOLD, grouped by supplier and outlet, watching cash.

Reply in plain Telegram text - NO markdown tables, NO ** asterisks (they show as literal characters). Structure:
- One headline line: the total RM you recommend ordering NOW (may be less than the full candidate total if you'd hold some).
- Per supplier worth ordering now: supplier + outlet, the few key items (name x qty pkg), and its RM.
- A short "Hold / watch" line for anything discretionary you'd defer, and why.
- One risk to flag (a near-stockout, a perishable, an unusually large line).
Be decisive and concise. If it's all discretionary or trivial, say so and recommend holding.`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function compact(groups: ReorderGroup[]) {
  return groups.map((g) => ({
    supplier: g.supplierName,
    outlet: g.outletName,
    total_rm: g.total,
    items: g.items.map((i) => ({ name: i.name, order_qty: i.qty, pkg: i.packageLabel, on_hand: i.onHand, reorder_pt: i.reorderPoint, unit_price: i.unitPrice })),
  }));
}

// Runs the reasoning pass and returns the recommendation text (no side effects).
// Exported so it can be tested without sending to Telegram.
export async function draftProcurementRecommendation(groups: ReorderGroup[]): Promise<string> {
  const candidateTotal = Math.round(groups.reduce((s, g) => s + g.total, 0) * 100) / 100;
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: SYSTEM,
    messages: [{
      role: "user",
      content: `Reorder candidates (JSON): ${JSON.stringify(compact(groups)).slice(0, 12000)}\n\nCandidate total if everything were ordered: RM${candidateTotal.toFixed(2)} across ${groups.length} supplier group(s). Give me today's procurement recommendation.`,
    }],
  });
  return res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
}

export async function runProcurementAdvisor(): Promise<{ sent: boolean; skipped?: string }> {
  if ((await getAgentModeOrDefault("procurement_advisor", "armed")) === "off") return { sent: false, skipped: "agent off" };
  if (!process.env.ANTHROPIC_API_KEY) return { sent: false, skipped: "no api key" };

  const groups = await computeReorderSuggestions();
  if (!groups.length) return { sent: false, skipped: "nothing at reorder point" };

  let answer = "";
  try {
    answer = await draftProcurementRecommendation(groups);
  } catch (e) {
    return { sent: false, skipped: e instanceof Error ? e.message : "llm failed" };
  }
  if (!answer) return { sent: false, skipped: "no recommendation" };

  const candidateTotal = Math.round(groups.reduce((s, g) => s + g.total, 0) * 100) / 100;
  const msgId = await sendPulse(`🧾 <b>Procurement advisor</b>\n\n${escapeHtml(answer)}`);
  await logAgentMessage({ fromAgent: "procurement_advisor", toAgent: "owner", kind: "report", summary: answer.slice(0, 300), notify: false });
  await logAgentAction({
    agentKey: "procurement_advisor",
    kind: "reorder_recommendation",
    summary: `${groups.length} supplier group(s) at reorder point, candidate RM${candidateTotal.toFixed(2)}`,
    autonomous: false,
    meta: { candidateTotal, groupCount: groups.length },
  });
  return { sent: msgId !== null };
}
