import { sendMessage } from "@/lib/telegram";

// Pulse channel: the human-readable feed of agent communications, learnings,
// and logic changes. Two ways to route it, checked in order:
//   1. A DEDICATED pulse bot: set CELSIUS_PULSE_BOT_TOKEN (@celsiuspulsebot's
//      token) + CELSIUS_PULSE_CHAT_ID (the chat/channel that bot posts to).
//      Keeps the agent feed on its own bot, separate from owner briefings.
//   2. FALLBACK: the existing bot (TELEGRAM_BOT_TOKEN) posting to
//      CELSIUS_PULSE_CHAT_ID, or the owner chat (TELEGRAM_OWNER_CHAT_ID) if
//      that isn't set - so the feed is never silently dark.
// Tokens live in env only; never hard-code them (this repo is public).

function pulseChatId(): string | null {
  return process.env.CELSIUS_PULSE_CHAT_ID || process.env.TELEGRAM_OWNER_CHAT_ID || null;
}

// Send via the dedicated pulse bot's own token (Telegram Bot API, HTML mode).
async function sendViaPulseBot(token: string, chatId: string, html: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`telegram ${res.status}: ${await res.text().catch(() => "")}`);
}

// Fire-and-forget: never throws. A telemetry/notification failure must not
// break the agent action that produced the message.
export async function sendPulse(html: string): Promise<boolean> {
  const chatId = pulseChatId();
  if (chatId == null) {
    console.warn("[pulse] no CELSIUS_PULSE_CHAT_ID / TELEGRAM_OWNER_CHAT_ID configured; skipping");
    return false;
  }
  const pulseToken = process.env.CELSIUS_PULSE_BOT_TOKEN;
  try {
    if (pulseToken) {
      await sendViaPulseBot(pulseToken, chatId, html);
    } else {
      // Fallback path uses the existing bot; sendMessage takes a numeric chat id.
      const numeric = parseInt(chatId, 10);
      if (Number.isNaN(numeric)) throw new Error("CELSIUS_PULSE_CHAT_ID must be numeric for the fallback bot");
      await sendMessage(numeric, html);
    }
    return true;
  } catch (err) {
    console.error("[pulse] send failed:", err);
    return false;
  }
}

export const KIND_LABEL: Record<string, string> = {
  handoff: "handed off to",
  learning: "learned",
  logic_change: "changed logic",
  report: "reported to",
  correction: "corrected",
};

const KIND_EMOJI: Record<string, string> = {
  handoff: "🔁",
  learning: "🧠",
  logic_change: "⚙️",
  report: "📣",
  correction: "🛠",
};

// Renders one agent message as a readable Telegram line. Names both sides so a
// person can follow who is talking to whom without any jargon.
export function formatPulseMessage(m: {
  from_agent: string;
  to_agent: string | null;
  kind: string;
  summary: string;
  detail?: string | null;
}): string {
  const emoji = KIND_EMOJI[m.kind] ?? "•";
  const to = m.to_agent ? ` <b>${escapeHtml(m.to_agent)}</b>` : "";
  const arrow = m.kind === "learning" || m.kind === "logic_change" ? "" : ` →${to}`;
  const head = `${emoji} <b>${escapeHtml(m.from_agent)}</b>${arrow}`;
  const body = escapeHtml(m.summary);
  const detail = m.detail ? `\n<i>${escapeHtml(m.detail)}</i>` : "";
  return `${head}\n${body}${detail}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
