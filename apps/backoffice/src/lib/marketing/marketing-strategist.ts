// Marketing strategist - LLM judgment over the campaign outcome ledger.
//
// The SMS loops already decide WHO qualifies and send mechanically (margin-gated,
// cooldown-protected). What no rule does today is step back and ask: across all
// the rounds we've run, WHICH loops actually earn their keep, which should scale,
// which should die, and what should we test next? That's this agent.
//
// Deterministic layer: fixed, vetted SQL that POOLS outcomes across rounds. This
// matters - a single round is 20-50 sends with a 10% holdout (2-5 people), far too
// small to read; most individual verdicts come back 'invalid'. Pooling across 60
// days is what makes the signal legible.
//
// v1 is ADVISORY: it recommends to the owner on Telegram. It does not change a
// loop's config, budget, or send anything.

import Anthropic from "@anthropic-ai/sdk";
import { runReadOnlySql, safeJson } from "@/lib/agents/data-analyst";
import { getAgentModeOrDefault, logAgentAction, touchAgentRun } from "@celsius/agents/src/substrate";
import { sendPulse } from "@celsius/agents/src/pulse";
import { logAgentMessage } from "@celsius/agents/src/messages";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-4-6";

// Pooled loop performance over 60 days. Round-level verdicts are noise at these
// volumes; the pooled row is the unit of judgment.
const SQL_LOOP_PERFORMANCE = `
select
  source,
  regexp_replace(campaign_key, '-r[0-9]+$', '') as loop,
  count(*) as rounds,
  sum(sends) as sends,
  round(sum(cost_rm), 2) as cost_rm,
  round(avg(uplift_pct), 2) as avg_uplift_pct,
  count(*) filter (where verdict = 'win') as wins,
  count(*) filter (where verdict = 'loss') as losses,
  count(*) filter (where verdict = 'neutral') as neutral,
  count(*) filter (where verdict = 'invalid') as invalid_too_small
from campaign_outcomes
where started_at > now() - interval '60 days'
group by 1, 2
order by sends desc
limit 50`;

const SQL_REVENUE_CONTEXT = `
select
  round(sum(nett), 2) as revenue_30d_rm,
  count(*) as sales_30d,
  round(avg(nett), 2) as aov_rm
from unified_sales
where coalesce(is_refund, false) = false
  and biz_date > (now() at time zone 'Asia/Kuala_Lumpur')::date - 30
limit 1`;

const SQL_AUDIENCE = `
select
  count(*) as members_total,
  count(*) filter (where coalesce(sms_opt_out, false) = false) as members_reachable,
  count(*) filter (where created_at > now() - interval '30 days') as joined_30d
from members
limit 1`;

const SYSTEM = `You are the marketing strategist for Celsius Coffee, a Malaysian coffee chain. You are given POOLED performance for every SMS lifecycle loop over the last 60 days, plus revenue and audience context.

The owner's north star: grow ORDERS, REPEAT RATE and AOV. Discounts are a last resort - a loop that only works by giving margin away is not a win. SMS costs roughly RM0.10 per send, so a loop must earn well above its send cost to deserve more volume.

Read the numbers honestly:
- uplift_pct is the measured lift vs a holdout, in percentage points. Pooled across rounds it is meaningful; a single round (20-50 sends, 10% holdout = 2-5 people) is NOT - that is why many rounds come back 'invalid_too_small'.
- A loop with a high avg uplift but tiny total sends has not been proven, it has been under-sampled. The right call there is usually "run more volume to find out", not "scale it hard".
- A loop with a lot of spend and flat or negative pooled uplift is burning money regardless of how many individual rounds were called wins.

Your job is a decision, not a description. Reply in plain Telegram text - NO markdown tables, NO ** asterisks (they render as literal characters). Structure:
- One headline line: the single most important call this week.
- SCALE: loops earning their keep that deserve more volume, with why (one line each).
- KILL or FIX: loops burning spend with nothing to show, with why.
- PROVE: loops that look promising but are under-sampled - say what volume would settle it.
- One test worth running next (a specific segment/offer/timing idea grounded in the data).
Be decisive and specific. Quote the real numbers. Keep it under ~200 words.`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface MarketingInputs {
  loops: unknown[];
  revenue: unknown[];
  audience: unknown[];
}

export async function gatherMarketingInputs(): Promise<MarketingInputs> {
  const [loops, revenue, audience] = await Promise.all([
    runReadOnlySql(SQL_LOOP_PERFORMANCE),
    runReadOnlySql(SQL_REVENUE_CONTEXT),
    runReadOnlySql(SQL_AUDIENCE),
  ]);
  return { loops: loops.rows, revenue: revenue.rows, audience: audience.rows };
}

// Exported for testing without sending to Telegram.
export async function draftMarketingRecommendation(inputs: MarketingInputs): Promise<string> {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: SYSTEM,
    messages: [{
      role: "user",
      content: `Pooled loop performance, last 60 days (JSON): ${safeJson(inputs.loops).slice(0, 8000)}

Revenue context, last 30 days: ${safeJson(inputs.revenue)}
Audience: ${safeJson(inputs.audience)}

Give me this week's marketing call.`,
    }],
  });
  return res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
}

export async function runMarketingStrategist(): Promise<{ sent: boolean; skipped?: string }> {
  if ((await getAgentModeOrDefault("marketing_strategist", "armed")) === "off") return { sent: false, skipped: "agent off" };
  // Heartbeat before the quiet-exit paths below, so a week with no campaign
  // outcomes still reads as "ran, nothing to say" rather than "never ran".
  await touchAgentRun("marketing_strategist");
  if (!process.env.ANTHROPIC_API_KEY) return { sent: false, skipped: "no api key" };

  const inputs = await gatherMarketingInputs();
  if (!inputs.loops.length) return { sent: false, skipped: "no campaign outcomes in window" };

  let answer = "";
  try {
    answer = await draftMarketingRecommendation(inputs);
  } catch (e) {
    return { sent: false, skipped: e instanceof Error ? e.message : "llm failed" };
  }
  if (!answer) return { sent: false, skipped: "no recommendation" };

  const msgId = await sendPulse(`📣 <b>Marketing strategist</b>\n\n${escapeHtml(answer)}`);
  await logAgentMessage({ fromAgent: "marketing_strategist", toAgent: "owner", kind: "report", summary: answer.slice(0, 300), notify: false });
  await logAgentAction({
    agentKey: "marketing_strategist",
    kind: "weekly_recommendation",
    summary: `Reviewed ${inputs.loops.length} loop(s) over 60d`,
    autonomous: false,
    meta: { loopCount: inputs.loops.length },
  });
  return { sent: msgId !== null };
}
