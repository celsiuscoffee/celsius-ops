// Ops intelligence - LLM judgment over the ops signal stream.
//
// The ops-nudge family already DETECTS breaches (no clock-in, checklist overdue,
// POS not open, stock count due) and pings the right person. What no rule does is
// look across a week and ask: which outlet is actually slipping, is the same
// breach repeating, and are these alerts even being actioned? That's this agent -
// it coaches, where the nudges only remind.
//
// Deterministic layer: fixed, vetted SQL rollups (alerts by outlet/signal + how
// many were ever actioned, checklist completion, attendance, sales vs trailing).
// v1 is ADVISORY: it reports to the owner on Telegram. It changes nothing.

import Anthropic from "@anthropic-ai/sdk";
import { runReadOnlySql, safeJson } from "@/lib/agents/data-analyst";
import { getAgentModeOrDefault, logAgentAction, touchAgentRun } from "@celsius/agents/src/substrate";
import { sendPulse } from "@celsius/agents/src/pulse";
import { logAgentMessage } from "@celsius/agents/src/messages";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-4-6";

// Alert volume by outlet + signal, AND whether anything was ever actioned. The
// actioned/acked columns are the point: a wall of alerts nobody closes is alert
// fatigue, not an ops problem.
const SQL_ALERTS = `
select
  coalesce(o.name, '(unassigned)') as outlet,
  a.signal,
  a.severity,
  count(*) as alerts,
  count(*) filter (where a.status <> 'OPEN') as actioned,
  count(*) filter (where a."ackedAt" is not null) as acked,
  count(*) filter (where a."resolvedAt" is not null) as resolved
from "OpsAlert" a
left join "Outlet" o on o.id = a."outletId"
where a."createdAt" > now() - interval '7 days'
group by 1, 2, 3
order by alerts desc
limit 40`;

const SQL_CHECKLISTS = `
select
  coalesce(o.name, '(unassigned)') as outlet,
  count(*) as checklists,
  count(*) filter (where c.status = 'COMPLETED') as completed,
  round(100.0 * count(*) filter (where c.status = 'COMPLETED') / nullif(count(*), 0), 1) as completion_pct
from "Checklist" c
left join "Outlet" o on o.id = c."outletId"
where c.date > (now() at time zone 'Asia/Kuala_Lumpur')::date - 7
group by 1
order by completion_pct asc
limit 20`;

const SQL_ATTENDANCE = `
select
  coalesce(o.name, '(unknown)') as outlet,
  count(*) as shifts,
  count(*) filter (where a.clock_in is null) as no_clock_in,
  round(sum(coalesce(a.overtime_hours, 0)), 1) as ot_hours
from hr_attendance_logs a
left join "Outlet" o on o.id = a.outlet_id
where a.scheduled_date > (now() at time zone 'Asia/Kuala_Lumpur')::date - 7
group by 1
order by no_clock_in desc
limit 20`;

// Last 7 days vs the prior 21, per outlet - the trading context behind the ops
// noise (a slipping outlet usually shows up here too).
const SQL_SALES_TREND = `
with d as (
  select outlet_name, biz_date, sum(nett) as day_nett
  from unified_sales
  where coalesce(is_refund, false) = false
    and biz_date > (now() at time zone 'Asia/Kuala_Lumpur')::date - 28
    and biz_date < (now() at time zone 'Asia/Kuala_Lumpur')::date
  group by 1, 2
)
select
  outlet_name as outlet,
  round(avg(day_nett) filter (where biz_date > (now() at time zone 'Asia/Kuala_Lumpur')::date - 7), 2) as last7_avg_rm,
  round(avg(day_nett) filter (where biz_date <= (now() at time zone 'Asia/Kuala_Lumpur')::date - 7), 2) as prior21_avg_rm
from d
group by 1
order by 1
limit 20`;

const SYSTEM = `You are the ops intelligence for the owner of Celsius Coffee, a Malaysian coffee chain (outlets: Shah Alam, Putrajaya/Conezion, Tamarind/Cyberjaya; Nilai is consignment). You are given a week of ops signals: alert volume per outlet and whether those alerts were ever actioned, checklist completion, attendance/clock-in gaps, overtime, and each outlet's last-7-day sales vs the prior three weeks.

The automated nudges already remind people. Your job is what they cannot do: judge which outlet is genuinely slipping, spot a repeating pattern, and say what the owner or a manager should actually DO. Coach, don't recite.

Read it critically:
- If alerts are high but almost NONE are acked or resolved, that is alert fatigue: the loop is not being closed, and more nudges will not fix it. Say so plainly - it is a more important finding than any single breach.
- Tie ops slippage to trade where the data supports it (an outlet with poor checklist completion AND falling sales is a different story from one with just noisy alerts).
- Distinguish a real problem from normal variance. Do not manufacture urgency.

Reply in plain Telegram text - NO markdown tables, NO ** asterisks (they render as literal characters). Structure:
- One headline line: the single thing most worth the owner's attention this week.
- 2-4 bullets: per-outlet or per-pattern findings, each with the number that proves it and the action to take.
- One line: what is fine / no action needed, so the owner knows what to ignore.
Be specific and brief - under ~200 words. If the week is genuinely clean, say that instead of inventing issues.`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface OpsInputs {
  alerts: unknown[];
  checklists: unknown[];
  attendance: unknown[];
  salesTrend: unknown[];
}

export async function gatherOpsInputs(): Promise<OpsInputs> {
  const [alerts, checklists, attendance, salesTrend] = await Promise.all([
    runReadOnlySql(SQL_ALERTS),
    runReadOnlySql(SQL_CHECKLISTS),
    runReadOnlySql(SQL_ATTENDANCE),
    runReadOnlySql(SQL_SALES_TREND),
  ]);
  return { alerts: alerts.rows, checklists: checklists.rows, attendance: attendance.rows, salesTrend: salesTrend.rows };
}

// Exported for testing without sending to Telegram.
export async function draftOpsBriefing(inputs: OpsInputs): Promise<string> {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: SYSTEM,
    messages: [{
      role: "user",
      content: `Ops alerts, last 7 days (JSON): ${safeJson(inputs.alerts).slice(0, 6000)}

Checklist completion, last 7 days: ${safeJson(inputs.checklists).slice(0, 2000)}
Attendance, last 7 days: ${safeJson(inputs.attendance).slice(0, 2000)}
Sales, last 7 days vs prior 21 (per outlet, RM/day): ${safeJson(inputs.salesTrend).slice(0, 2000)}

Give me this week's ops read.`,
    }],
  });
  return res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
}

export async function runOpsIntelligence(): Promise<{ sent: boolean; skipped?: string }> {
  if ((await getAgentModeOrDefault("ops_intelligence", "armed")) === "off") return { sent: false, skipped: "agent off" };
  // Heartbeat before the quiet-exit paths below — a clean week with no alerts
  // is the agent working, not the agent stopped.
  await touchAgentRun("ops_intelligence");
  if (!process.env.ANTHROPIC_API_KEY) return { sent: false, skipped: "no api key" };

  const inputs = await gatherOpsInputs();
  if (!inputs.alerts.length && !inputs.checklists.length) return { sent: false, skipped: "no ops signal" };

  let answer = "";
  try {
    answer = await draftOpsBriefing(inputs);
  } catch (e) {
    return { sent: false, skipped: e instanceof Error ? e.message : "llm failed" };
  }
  if (!answer) return { sent: false, skipped: "no briefing" };

  const msgId = await sendPulse(`🛠 <b>Ops intelligence</b>\n\n${escapeHtml(answer)}`);
  await logAgentMessage({ fromAgent: "ops_intelligence", toAgent: "owner", kind: "report", summary: answer.slice(0, 300), notify: false });
  await logAgentAction({
    agentKey: "ops_intelligence",
    kind: "weekly_ops_read",
    summary: `Reviewed ${inputs.alerts.length} alert group(s), ${inputs.checklists.length} outlet checklist row(s)`,
    autonomous: false,
    meta: { alertGroups: inputs.alerts.length },
  });
  return { sent: msgId !== null };
}
