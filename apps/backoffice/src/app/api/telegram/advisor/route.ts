import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { handleQuestion, WELCOME_MESSAGE } from "@/lib/pulse/advisor";
import { sendMessage, type PulseUpdate } from "@/lib/pulse/telegram";

export const maxDuration = 300;

function allowedChatIds(): Set<number> {
  return new Set(
    (process.env.TELEGRAM_PULSE_ALLOWED_CHAT_IDS ?? "")
      .split(",")
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isFinite(id) && id !== 0),
  );
}

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (secret !== process.env.TELEGRAM_PULSE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: PulseUpdate;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const message = update.message;
  const text = message?.text?.trim();
  if (!message || !text) return NextResponse.json({ ok: true });

  const chatId = message.chat.id;
  if (!allowedChatIds().has(chatId)) {
    // Silent drop — log the chat id so legitimate users can be allowlisted.
    console.warn(`[pulse] ignored message from non-allowlisted chat ${chatId}`);
    return NextResponse.json({ ok: true });
  }

  if (text === "/start" || text === "/help") {
    after(() => sendMessage(chatId, WELCOME_MESSAGE));
    return NextResponse.json({ ok: true });
  }

  after(() => handleQuestion(chatId, text));
  return NextResponse.json({ ok: true });
}
