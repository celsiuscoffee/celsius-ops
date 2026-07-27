// Pulse channel: the human-readable feed of agent communications, learnings,
// and logic changes. Two ways to route it, checked in order:
//   1. A DEDICATED pulse bot: set CELSIUS_PULSE_BOT_TOKEN (@celsiuspulsebot's
//      token) + CELSIUS_PULSE_CHAT_ID (the chat/channel that bot posts to).
//      Keeps the agent feed on its own bot, separate from owner briefings.
//   2. FALLBACK: the existing bot (TELEGRAM_BOT_TOKEN) posting to
//      CELSIUS_PULSE_CHAT_ID, or the owner chat (TELEGRAM_OWNER_CHAT_ID) if
//      that isn't set - so the feed is never silently dark.
// Tokens live in env only; never hard-code them (this repo is public).

export function pulseChatId(): string | null {
  return process.env.CELSIUS_PULSE_CHAT_ID || process.env.TELEGRAM_OWNER_CHAT_ID || null;
}

// Two-way replies (buttons, webhook) require the dedicated pulse bot - the
// shared bot already owns a webhook, and only one webhook per bot is allowed.
export function pulseTwoWayEnabled(): boolean {
  return !!process.env.CELSIUS_PULSE_BOT_TOKEN;
}

export type PulseButton = { label: string; value: string };

// A tap on a pulse button sends this back to the webhook as callback_data.
export function callbackData(promptId: string, value: string): string {
  return `pa:${promptId}:${value}`;
}

// Send via the dedicated pulse bot's own token (Telegram Bot API, HTML mode).
// Returns the posted message id (used to match owner replies back to it).
async function sendViaPulseBot(token: string, chatId: string, html: string, buttons?: PulseButton[][], promptId?: string): Promise<number | null> {
  const body: Record<string, unknown> = { chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true };
  if (buttons && promptId) {
    body.reply_markup = {
      inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.label, callback_data: callbackData(promptId, b.value) }))),
    };
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`telegram ${res.status}: ${await res.text().catch(() => "")}`);
  const json = (await res.json().catch(() => null)) as { result?: { message_id?: number } } | null;
  return json?.result?.message_id ?? null;
}

// Fire-and-forget: never throws. Returns the Telegram message id on success
// (truthy), or null on failure/skip - a notification failure must not break the
// agent action that produced the message.
// Send to a SPECIFIC chat (the owner DM or an approved group). Used for group
// replies where the target is the originating chat, not the default pulse chat.
export async function sendPulseTo(
  chatId: string | number,
  html: string,
  opts?: { buttons?: PulseButton[][]; promptId?: string },
): Promise<number | null> {
  const target = String(chatId);
  const pulseToken = process.env.CELSIUS_PULSE_BOT_TOKEN;
  try {
    if (pulseToken) {
      return await sendViaPulseBot(pulseToken, target, html, opts?.buttons, opts?.promptId);
    }
    // Fallback path uses the existing shared bot (TELEGRAM_BOT_TOKEN).
    // Buttons aren't supported on the fallback (no dedicated webhook to answer).
    const sharedToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!sharedToken) throw new Error("no TELEGRAM_BOT_TOKEN for the fallback bot");
    const res = await fetch(`https://api.telegram.org/bot${sharedToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: target, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!res.ok) throw new Error(`telegram ${res.status}: ${await res.text().catch(() => "")}`);
    return 0; // sent, but message id not tracked on the fallback bot
  } catch (err) {
    console.error("[pulse] send failed:", err);
    return null;
  }
}

export async function sendPulse(html: string, opts?: { buttons?: PulseButton[][]; promptId?: string }): Promise<number | null> {
  const chatId = pulseChatId();
  if (chatId == null) {
    console.warn("[pulse] no CELSIUS_PULSE_CHAT_ID / TELEGRAM_OWNER_CHAT_ID configured; skipping");
    return null;
  }
  return sendPulseTo(chatId, html, opts);
}

// The owner's Telegram user id, used to authorize group enable/disable. For a
// private chat the chat id equals the user id, so pulseChatId is the right
// default; CELSIUS_PULSE_OWNER_USER_ID overrides if they ever differ.
export function pulseOwnerUserId(): string | null {
  return process.env.CELSIUS_PULSE_OWNER_USER_ID || pulseChatId();
}

// ── Pulse-bot control-plane calls (dedicated bot token) ──────────────────────
const pulseApi = (method: string) => `https://api.telegram.org/bot${process.env.CELSIUS_PULSE_BOT_TOKEN}/${method}`;

// Stop the button's loading spinner after a tap.
export async function answerPulseCallback(callbackQueryId: string, text?: string): Promise<void> {
  if (!process.env.CELSIUS_PULSE_BOT_TOKEN) return;
  await fetch(pulseApi("answerCallbackQuery"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text: text?.slice(0, 200) }),
  }).catch((e) => console.error("[pulse] answerCallback failed:", e));
}

// Rewrite a prompt message after it's answered (removes the buttons).
export async function editPulseMessage(chatId: string | number, messageId: number, html: string): Promise<void> {
  if (!process.env.CELSIUS_PULSE_BOT_TOKEN) return;
  await fetch(pulseApi("editMessageText"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
  }).catch((e) => console.error("[pulse] editMessage failed:", e));
}

// Register the pulse bot's webhook so owner replies/taps reach us in real time.
export async function setPulseWebhook(url: string, secretToken: string): Promise<unknown> {
  const res = await fetch(pulseApi("setWebhook"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, secret_token: secretToken, allowed_updates: ["message", "callback_query"] }),
  });
  return res.json();
}

// Read the pulse bot's current webhook registration straight from Telegram.
// Used both to skip a redundant setWebhook and to surface last_error_message /
// pending_update_count for diagnosis. Returns null if the bot isn't configured.
export async function getPulseWebhookInfo(): Promise<
  { url?: string; last_error_message?: string; pending_update_count?: number } | null
> {
  if (!process.env.CELSIUS_PULSE_BOT_TOKEN) return null;
  try {
    const res = await fetch(pulseApi("getWebhookInfo"));
    const json = (await res.json()) as {
      result?: { url?: string; last_error_message?: string; pending_update_count?: number };
    };
    return json?.result ?? null;
  } catch (e) {
    console.error("[pulse] getWebhookInfo failed:", e);
    return null;
  }
}

// Idempotent self-registration. Crons run server-side with the bot token in
// env, so the fleet registers its OWN webhook instead of depending on a human
// clicking the /agents Connect button. Targets the stable production domain by
// default (CELSIUS_PULSE_WEBHOOK_URL overrides) so it never lands on a
// protected *.vercel.app URL. Guarded to hit Telegram at most once per warm
// instance, and skips when the webhook already points at the right URL. Never
// throws - a registration hiccup must not break the cron that called it.
let webhookEnsured = false;
export async function ensurePulseWebhook(): Promise<{ ok: boolean; action: string; url?: string; detail?: string }> {
  if (webhookEnsured) return { ok: true, action: "cached" };
  const token = process.env.CELSIUS_PULSE_BOT_TOKEN;
  if (!token) return { ok: false, action: "skipped", detail: "CELSIUS_PULSE_BOT_TOKEN not set" };
  const secret = process.env.CELSIUS_PULSE_WEBHOOK_SECRET;
  if (!secret) return { ok: false, action: "skipped", detail: "CELSIUS_PULSE_WEBHOOK_SECRET not set" };
  const url =
    process.env.CELSIUS_PULSE_WEBHOOK_URL || "https://backoffice.celsiuscoffee.com/api/agents/pulse-webhook";
  try {
    const info = await getPulseWebhookInfo();
    if (info?.url === url) {
      webhookEnsured = true;
      return {
        ok: true,
        action: "already_set",
        url,
        detail: info.last_error_message ? `last_error: ${info.last_error_message}` : undefined,
      };
    }
    const res = (await setPulseWebhook(url, secret)) as { ok?: boolean; description?: string };
    if (res?.ok) {
      webhookEnsured = true;
      console.log(`[pulse] webhook self-registered -> ${url}`);
      return { ok: true, action: "registered", url };
    }
    return { ok: false, action: "failed", url, detail: res?.description ?? "setWebhook returned not-ok" };
  } catch (e) {
    return { ok: false, action: "error", url, detail: e instanceof Error ? e.message : String(e) };
  }
}

export const KIND_LABEL: Record<string, string> = {
  handoff: "handed off to",
  learning: "learned",
  logic_change: "changed logic",
  report: "reported to",
  correction: "corrected",
  note: "note to",
};

const KIND_EMOJI: Record<string, string> = {
  handoff: "🔁",
  learning: "🧠",
  logic_change: "⚙️",
  report: "📣",
  correction: "🛠",
  note: "💬",
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
