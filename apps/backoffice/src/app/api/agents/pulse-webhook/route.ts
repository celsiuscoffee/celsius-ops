import { NextRequest, NextResponse } from "next/server";
import { getAgentClient } from "@celsius/agents/src/substrate";
import { logAgentMessage } from "@celsius/agents/src/messages";
import { answerPulseCallback, pulseChatId, sendPulse } from "@celsius/agents/src/pulse";
import { resolvePrompt, findPromptByMessageId } from "@celsius/agents/src/ask-owner";
import { writeApMatch, type ApMatch } from "@/lib/finance/ap-match";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Owner-approved actions. When a prompt carries a payload.action, the owner's
// answer authorizes a real mutation. Kept in the app (not the shared package)
// because the actions are app/domain-specific. resolvePrompt is atomic, so this
// runs at most once per prompt even on a double-tap.
async function dispatchPromptAction(payload: Record<string, unknown> | null, value: string): Promise<void> {
  if (!payload || typeof payload !== "object") return;
  const action = payload.action;

  if (action === "clear_ap_match") {
    const approveValue = typeof payload.approveValue === "string" ? payload.approveValue : "approve";
    const match = payload.match as ApMatch | undefined;
    if (value !== approveValue) {
      await logAgentMessage({
        fromAgent: "owner",
        toAgent: "finance_ap_agent",
        kind: "note",
        summary: "Declined the pay-and-claim clear — left in the finance inbox for manual review.",
        notify: false,
      });
      return;
    }
    if (!match) return;
    try {
      await writeApMatch(match); // idempotent: no-op if already settled
      await sendPulse(`✅ Cleared the ${escapeHtml(String(match.payee))} invoice (RM${Number(match.amount).toFixed(2)}) — settled as a staff pay-and-claim.`);
      await logAgentMessage({
        fromAgent: "owner",
        toAgent: "finance_ap_agent",
        kind: "note",
        summary: `Approved and cleared the ${match.payee} pay-and-claim (RM${Number(match.amount).toFixed(2)}).`,
        refTable: "fin_bank_lines",
        refId: String(match.bankLineId),
        notify: false,
      });
    } catch (e) {
      console.error("[pulse-webhook] clear_ap_match failed:", e);
      await sendPulse("⚠️ Couldn't clear that invoice automatically — please settle it in the finance inbox.");
    }
  }
}

// Inbound webhook for the dedicated pulse bot (@celsiuspulsebot). Lets the owner
// talk back to the agents in real time:
//   - tap an Approve/Reject (or custom) button on a question -> resolves it
//   - reply to a question -> supplies the free-text answer
//   - reply to a feed message -> attaches a note to that exact agent/topic
//   - send any message -> recorded as a general note to the agents
//
// SECURITY: two gates. (1) Telegram's secret_token must match
// CELSIUS_PULSE_WEBHOOK_SECRET (set when the webhook is registered). (2) The
// update must come from the configured pulse chat (owner allowlist) - a stranger
// who finds the bot cannot drive the agents. Always returns 200 so Telegram
// doesn't retry a rejected update.

type TgUser = { id: number; first_name?: string; username?: string };
type TgChat = { id: number };
type TgMessage = { message_id: number; from?: TgUser; chat: TgChat; text?: string; reply_to_message?: { message_id: number } };
type TgCallback = { id: string; from: TgUser; message?: TgMessage; data?: string };
type TgUpdate = { message?: TgMessage; callback_query?: TgCallback };

function ok() {
  return NextResponse.json({ ok: true });
}

function ownerAllowed(chatId: number | undefined): boolean {
  const configured = pulseChatId();
  if (!configured || chatId == null) return false;
  return String(chatId) === String(configured);
}

function actor(u?: TgUser): string {
  if (!u) return "owner";
  return u.username ? `@${u.username}` : `${u.first_name ?? "owner"} (${u.id})`;
}

export async function POST(req: NextRequest) {
  // Gate 1: shared secret set at registration time.
  const secret = process.env.CELSIUS_PULSE_WEBHOOK_SECRET;
  const provided = req.headers.get("x-telegram-bot-api-secret-token");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return ok();
  }

  try {
    // ── Button tap ───────────────────────────────────────────────────────
    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message?.chat.id;
      if (!ownerAllowed(chatId)) {
        await answerPulseCallback(cb.id, "Not authorized.");
        return ok();
      }
      // callback_data is "pa:<promptId>:<value>"
      const parts = (cb.data ?? "").split(":");
      if (parts[0] === "pa" && parts[1]) {
        const promptId = parts[1];
        const value = parts.slice(2).join(":") || "ack";
        const resolved = await resolvePrompt({ promptId, answer: value, answeredBy: actor(cb.from) });
        await answerPulseCallback(cb.id, `Recorded: ${value}`);
        if (resolved) {
          await logAgentMessage({
            fromAgent: "owner",
            toAgent: resolved.agent_key,
            kind: "note",
            summary: `Answered "${resolved.prompt.slice(0, 120)}" with: ${value}`,
            notify: false,
          });
          // Execute whatever the answer authorized (e.g. clear the AP match).
          await dispatchPromptAction(resolved.payload, value);
        }
      } else {
        await answerPulseCallback(cb.id);
      }
      return ok();
    }

    // ── Message / reply ──────────────────────────────────────────────────
    if (update.message) {
      const msg = update.message;
      if (!ownerAllowed(msg.chat.id)) return ok();
      const text = (msg.text ?? "").trim();
      if (!text) return ok();

      const client = getAgentClient();
      const replyToId = msg.reply_to_message?.message_id;

      // (a) Reply to an open question -> that's the answer.
      if (replyToId) {
        const prompt = await findPromptByMessageId(replyToId);
        if (prompt) {
          const resolved = await resolvePrompt({ promptId: prompt.id, answer: text, answeredBy: actor(msg.from) });
          if (resolved) {
            await logAgentMessage({
              fromAgent: "owner",
              toAgent: resolved.agent_key,
              kind: "note",
              summary: `Answered "${resolved.prompt.slice(0, 100)}": ${text.slice(0, 200)}`,
              notify: false,
            });
          }
          await sendPulse("👍 Got it, recorded your answer.");
          return ok();
        }

        // (b) Reply to a feed message -> attach a note to that exact agent/topic.
        const { data: fed } = await client
          .from("agent_messages")
          .select("from_agent, summary")
          .eq("notified_message_id", replyToId)
          .maybeSingle();
        if (fed) {
          await logAgentMessage({
            fromAgent: "owner",
            toAgent: fed.from_agent as string,
            kind: "note",
            summary: text.slice(0, 400),
            detail: `In reply to: ${(fed.summary as string).slice(0, 160)}`,
            notify: false,
          });
          await sendPulse(`📝 Noted for the ${escapeHtml(String(fed.from_agent).replace(/_/g, " "))}.`);
          return ok();
        }
      }

      // (c) Free-standing message -> a general note to the agents.
      await logAgentMessage({
        fromAgent: "owner",
        kind: "note",
        summary: text.slice(0, 400),
        notify: false,
      });
      await sendPulse("📝 Noted. The agents' next runs will have this on the feed.");
      return ok();
    }
  } catch (err) {
    console.error("[pulse-webhook] handler error:", err);
  }
  return ok();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
