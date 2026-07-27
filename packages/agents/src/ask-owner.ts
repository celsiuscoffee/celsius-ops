import { getAgentClient } from "./substrate";
import { sendPulse, editPulseMessage, pulseChatId, pulseTwoWayEnabled, type PulseButton } from "./pulse";
import { agentLabel } from "./messages";

// Agent -> owner questions. An agent that needs a decision or more info calls
// askOwner(): it posts a message to the pulse bot with inline buttons (or an
// open question), stores the open prompt in agent_prompts, and returns the
// prompt id. The owner's tap/reply arrives at the pulse webhook, which records
// the answer. The agent later reads it with getAnswer() to proceed.
//
// Requires the dedicated pulse bot (two-way needs its own webhook). Never
// throws - a notification failure must not break the agent's own work.

export type AskKind = "confirm" | "question";

export interface AskOwnerInput {
  agentKey: string;
  kind?: AskKind; // confirm (buttons) | question (free-text reply); default confirm
  prompt: string; // the plain-English question
  options?: PulseButton[]; // buttons for a confirm; defaults to Approve / Reject
  refTable?: string;
  refId?: string;
  outletId?: string;
  expiresInHours?: number;
  // Opaque data the webhook needs to ACT on the answer (e.g. an action name +
  // the record to mutate). The agents package never interprets it; the app's
  // webhook dispatches on it. Keep it small and JSON-serializable.
  payload?: Record<string, unknown>;
}

const DEFAULT_CONFIRM: PulseButton[] = [
  { label: "✅ Approve", value: "approve" },
  { label: "🛑 Reject", value: "reject" },
];

// Returns the prompt id, or null if two-way isn't configured / the send failed.
export async function askOwner(input: AskOwnerInput): Promise<string | null> {
  if (!pulseTwoWayEnabled() || pulseChatId() == null) {
    console.warn("[ask-owner] pulse two-way not configured; skipping ask");
    return null;
  }
  const kind: AskKind = input.kind ?? "confirm";
  const buttons = kind === "confirm" ? (input.options?.length ? input.options : DEFAULT_CONFIRM) : [];
  const client = getAgentClient();

  // Insert the pending prompt first so the button callback_data can carry its id.
  const { data, error } = await client
    .from("agent_prompts")
    .insert({
      agent_key: input.agentKey,
      kind,
      prompt: input.prompt,
      options: buttons,
      ref_table: input.refTable ?? null,
      ref_id: input.refId ?? null,
      outlet_id: input.outletId ?? null,
      payload: input.payload ?? null,
      status: "pending",
      expires_at: input.expiresInHours
        ? new Date(Date.now() + input.expiresInHours * 3600_000).toISOString()
        : null,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[ask-owner] prompt insert failed:", error);
    return null;
  }
  const promptId = data.id as string;

  const html =
    `❓ <b>${escapeHtml(agentLabel(input.agentKey))} needs you</b>\n${escapeHtml(input.prompt)}` +
    (kind === "question" ? `\n<i>Reply to this message to answer.</i>` : "");

  const messageId = await sendPulse(html, kind === "confirm" ? { buttons: [buttons], promptId } : undefined);
  if (messageId && messageId > 0) {
    await client.from("agent_prompts").update({ telegram_message_id: messageId }).eq("id", promptId);
  }
  return promptId;
}

// The agent reads its answer here. Returns null while still pending.
export async function getAnswer(promptId: string): Promise<{ status: string; answer: string | null } | null> {
  const { data, error } = await getAgentClient()
    .from("agent_prompts")
    .select("status, answer")
    .eq("id", promptId)
    .maybeSingle();
  if (error || !data) return null;
  return { status: data.status as string, answer: (data.answer as string | null) ?? null };
}

// Called by the webhook when the owner taps a button or replies. Records the
// answer, marks the prompt answered, and rewrites the Telegram message to show
// the decision (removing the buttons). Returns the resolved prompt row.
export async function resolvePrompt(args: {
  promptId: string;
  answer: string;
  answeredBy: string;
}): Promise<{ agent_key: string; prompt: string; telegram_message_id: number | null; payload: Record<string, unknown> | null } | null> {
  const client = getAgentClient();
  // Atomically claim the prompt: only the FIRST resolve of a pending prompt
  // succeeds. This is the guard that stops a double-tap from acting twice on a
  // money action (e.g. clearing an invoice) - the update returns 0 rows the
  // second time and we bail.
  const { data: claimed } = await client
    .from("agent_prompts")
    .update({ status: "answered", answer: args.answer, answered_by: args.answeredBy, answered_at: new Date().toISOString() })
    .eq("id", args.promptId)
    .eq("status", "pending")
    .select("agent_key, prompt, telegram_message_id, payload")
    .maybeSingle();
  if (!claimed) return null; // unknown prompt, or already answered

  const msgId = claimed.telegram_message_id as number | null;
  if (msgId) {
    const chatId = pulseChatId();
    if (chatId) {
      await editPulseMessage(
        chatId,
        msgId,
        `✅ <b>${escapeHtml(agentLabel(claimed.agent_key as string))}</b>\n${escapeHtml(claimed.prompt as string)}\n\n<b>You answered:</b> ${escapeHtml(args.answer)}`,
      );
    }
  }
  return {
    agent_key: claimed.agent_key as string,
    prompt: claimed.prompt as string,
    telegram_message_id: msgId,
    payload: (claimed.payload as Record<string, unknown> | null) ?? null,
  };
}

// Is there already a pending (unanswered) prompt for this agent + record?
// Callers that re-run on a schedule use this to avoid re-asking the owner the
// same question every run until they act on it.
export async function pendingPromptExists(agentKey: string, refId: string): Promise<boolean> {
  const { data } = await getAgentClient()
    .from("agent_prompts")
    .select("id")
    .eq("agent_key", agentKey)
    .eq("ref_id", refId)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  return !!data;
}

// Match an owner reply (reply_to_message id) back to its open prompt.
export async function findPromptByMessageId(messageId: number): Promise<{ id: string } | null> {
  const { data } = await getAgentClient()
    .from("agent_prompts")
    .select("id")
    .eq("telegram_message_id", messageId)
    .eq("status", "pending")
    .maybeSingle();
  return data ? { id: data.id as string } : null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
