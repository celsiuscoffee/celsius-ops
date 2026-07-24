/**
 * Telegram Bot API helper for the Celsius Pulse advisor bot (@celsiuspulsebot).
 * Separate from lib/telegram.ts, which is bound to the inventory POP bot token.
 */

const API = () => `https://api.telegram.org/bot${process.env.TELEGRAM_PULSE_BOT_TOKEN}`;

export type PulseMessage = {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; first_name?: string; username?: string };
  text?: string;
  date: number;
};

export type PulseUpdate = {
  update_id: number;
  message?: PulseMessage;
  edited_message?: PulseMessage;
};

const TELEGRAM_MAX_CHARS = 4000;

export async function sendMessage(chatId: number, text: string): Promise<void> {
  // No parse_mode — answers are plain text so model output renders literally.
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > TELEGRAM_MAX_CHARS) {
    const slice = remaining.slice(0, TELEGRAM_MAX_CHARS);
    const cut = Math.max(slice.lastIndexOf("\n"), TELEGRAM_MAX_CHARS - 400);
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  chunks.push(remaining);

  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    await fetch(`${API()}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: chunk }),
    }).catch((err) => console.error("[pulse] sendMessage failed:", err));
  }
}

export async function sendChatAction(chatId: number, action = "typing"): Promise<void> {
  await fetch(`${API()}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action }),
  }).catch(() => {});
}
