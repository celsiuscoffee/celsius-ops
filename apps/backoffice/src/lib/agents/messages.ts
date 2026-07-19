import { getAgentClient } from "./substrate";
import { sendPulse, formatPulseMessage } from "./pulse";

// The agent communications log. Use this whenever one agent hands work to
// another, learns something, or changes its own logic. Every call:
//   1. writes a human-readable row to agent_messages (the /agents Conversations
//      view + the daily digest read this), and
//   2. posts it to the pulse Telegram channel in real time (unless silent).
//
// Never throws - a notification failure must not break the business action.

export type AgentMessageKind = "handoff" | "learning" | "logic_change" | "report";

// Friendly display names so the feed reads in plain English instead of DB keys.
// Falls back to the de-underscored key for anything not listed.
const AGENT_LABELS: Record<string, string> = {
  reviews_auto_reply: "Reviews agent",
  reviews_negative_drafts: "Reviews agent",
  reviews_daily_snapshot: "Reviews rank tracker",
  ops_nudges: "Ops agent",
  ops_pulse: "Ops Pulse",
  celsius_overview: "Owner briefing agent",
  finance_ap_agent: "Finance AP agent",
  finance_ap_match_apply: "Finance AP matcher",
  finance_gl_post: "Finance ledger poster",
  finance_eod: "Finance EOD agent",
  procurement_supplier_chat: "Supplier chat agent",
  procurement_verifier: "Procurement verifier",
  procurement_pop_verifier: "Payment verifier",
  hr_schedule_generator: "Roster agent",
  sms_lifecycle_loops: "SMS loops",
  round_gap_loop: "Round-gap agent",
  owner: "Owner",
  human: "a human",
  "ops team": "the ops team",
  system: "System",
};

export function agentLabel(keyOrLabel: string): string {
  if (AGENT_LABELS[keyOrLabel]) return AGENT_LABELS[keyOrLabel];
  // Unknown registry key -> "some_key" becomes "Some key"
  const spaced = keyOrLabel.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export interface AgentMessageInput {
  fromAgent: string; // registry key or 'system'
  toAgent?: string; // registry key | 'owner' | 'human' | 'ops team' | undefined
  kind: AgentMessageKind;
  summary: string; // ONE plain-English sentence, written for a person
  detail?: string;
  refTable?: string;
  refId?: string;
  outletId?: string;
  meta?: Record<string, unknown>;
  // Default true. Set false to record the message without a real-time push
  // (it still appears on /agents and in the daily digest).
  notify?: boolean;
}

export async function logAgentMessage(input: AgentMessageInput): Promise<void> {
  const fromLabel = agentLabel(input.fromAgent);
  const toLabel = input.toAgent ? agentLabel(input.toAgent) : null;
  const notify = input.notify ?? true;

  let notifiedAt: string | null = null;
  if (notify) {
    const ok = await sendPulse(
      formatPulseMessage({
        from_agent: fromLabel,
        to_agent: toLabel,
        kind: input.kind,
        summary: input.summary,
        detail: input.detail ?? null,
      }),
    );
    if (ok) notifiedAt = new Date().toISOString();
  }

  try {
    await getAgentClient()
      .from("agent_messages")
      .insert({
        from_agent: input.fromAgent,
        to_agent: input.toAgent ?? null,
        kind: input.kind,
        summary: input.summary,
        detail: input.detail ?? null,
        ref_table: input.refTable ?? null,
        ref_id: input.refId ?? null,
        outlet_id: input.outletId ?? null,
        meta: input.meta ?? {},
        notified_at: notifiedAt,
      });
  } catch (err) {
    console.error(`[agent-messages] insert failed for ${input.fromAgent} -> ${input.toAgent}:`, err);
  }
}
