import { sendMessage } from "@/lib/telegram";

// Pulse channel: the human-readable feed of agent communications, learnings,
// and logic changes. Reuses the existing Telegram bot (TELEGRAM_BOT_TOKEN);
// posts to CELSIUS_PULSE_CHAT_ID when set, otherwise falls back to the owner
// chat so the feed is never silently dark. Point CELSIUS_PULSE_CHAT_ID at the
// dedicated @celsiuspulsebot channel once the bot is added to it.

function pulseChatId(): number | null {
  const raw = process.env.CELSIUS_PULSE_CHAT_ID || process.env.TELEGRAM_OWNER_CHAT_ID;
  if (!raw) return null;
  const id = parseInt(raw, 10);
  return Number.isNaN(id) ? null : id;
}

// Fire-and-forget: never throws. A telemetry/notification failure must not
// break the agent action that produced the message.
export async function sendPulse(html: string): Promise<boolean> {
  const chatId = pulseChatId();
  if (chatId == null) {
    console.warn("[pulse] no CELSIUS_PULSE_CHAT_ID / TELEGRAM_OWNER_CHAT_ID configured; skipping");
    return false;
  }
  try {
    await sendMessage(chatId, html);
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
};

const KIND_EMOJI: Record<string, string> = {
  handoff: "🔁",
  learning: "🧠",
  logic_change: "⚙️",
  report: "📣",
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
