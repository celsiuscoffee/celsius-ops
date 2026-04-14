/**
 * Telegram Bot API helper.
 * No third-party library — just fetch() against the Bot API.
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ─── Types ──────────────────────────────────────────────────

export type TelegramPhotoSize = { file_id: string; file_unique_id: string; width: number; height: number; file_size?: number };
export type TelegramDocument = { file_id: string; file_unique_id: string; file_name?: string; mime_type?: string; file_size?: number };
export type TelegramMessage = {
  message_id: number;
  chat: { id: number; type: string; title?: string };
  from?: { id: number; first_name: string; last_name?: string };
  text?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  caption?: string;
  date: number;
};
export type TelegramUpdate = { update_id: number; message?: TelegramMessage };

// ─── API Methods ────────────────────────────────────────────

export async function sendMessage(chatId: number, text: string, replyToMessageId?: number) {
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_to_message_id: replyToMessageId,
      parse_mode: "HTML",
    }),
  });
}

export async function sendPhoto(chatId: number, photoUrl: string, caption?: string) {
  await fetch(`${API}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      photo: photoUrl,
      caption,
      parse_mode: "HTML",
    }),
  });
}

export async function getFileUrl(fileId: string): Promise<string> {
  const res = await fetch(`${API}/getFile?file_id=${fileId}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`getFile failed: ${data.description}`);
  return `https://api.telegram.org/file/bot${BOT_TOKEN}/${data.result.file_path}`;
}

export async function downloadFile(fileUrl: string): Promise<Buffer> {
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function setWebhook(url: string, secret: string) {
  const res = await fetch(`${API}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: secret,
      allowed_updates: ["message"],
    }),
  });
  return res.json();
}
