// Telegram inbox chat gate.
//
// The webhook creates invoices (photo → handleInvoice) and marks invoices PAID
// + forwards receipts to suppliers (photo → handlePop). Only plain text used to
// be gated to the owner's chat; any Telegram user who found the bot could push
// documents through those paths. Every update — message or callback — now goes
// through this gate.
//
// Env:
//   TELEGRAM_OWNER_CHAT_ID      the owner's private chat (already used for text)
//   TELEGRAM_ALLOWED_CHAT_IDS   comma/space-separated extra chat ids (staff group,
//                               finance group, …). Group ids are negative numbers.
//
// Rollout: the finance team may be posting POPs from a group chat we can't
// identify from here, so the gate has two modes:
//   - TELEGRAM_ALLOWED_CHAT_IDS UNSET/blank  → "log-only": still process, but log
//     every unlisted chat at warn level so the real ids can be harvested from
//     production logs.
//   - TELEGRAM_ALLOWED_CHAT_IDS SET           → "enforce": refuse anything not in
//     the set ∪ owner id (reply 200 so Telegram stops retrying).
// Text commands keep their separate owner-only gate in the webhook.

export type TelegramAllowlistEnv = {
  TELEGRAM_ALLOWED_CHAT_IDS?: string;
  TELEGRAM_OWNER_CHAT_ID?: string;
};

export type TelegramGateMode = "enforce" | "log-only";

export type TelegramGate = {
  mode: TelegramGateMode;
  allowed: Set<string>;
};

const CHAT_ID = /^-?\d+$/;

export function parseAllowedChatIds(env: TelegramAllowlistEnv): Set<string> {
  const out = new Set<string>();
  const add = (raw: string | undefined) => {
    for (const part of (raw ?? "").split(/[,;\s]+/)) {
      const id = part.trim();
      if (CHAT_ID.test(id)) out.add(id);
    }
  };
  add(env.TELEGRAM_OWNER_CHAT_ID);
  add(env.TELEGRAM_ALLOWED_CHAT_IDS);
  return out;
}

/** Mode selection: enforce only once the operator has set the allowlist. */
export function resolveTelegramGate(env: TelegramAllowlistEnv): TelegramGate {
  const configured = typeof env.TELEGRAM_ALLOWED_CHAT_IDS === "string" && env.TELEGRAM_ALLOWED_CHAT_IDS.trim() !== "";
  return { mode: configured ? "enforce" : "log-only", allowed: parseAllowedChatIds(env) };
}

export function isChatAllowed(chatId: number | string | null | undefined, allowed: Set<string>): boolean {
  if (chatId == null) return false;
  return allowed.has(String(chatId));
}

export type TelegramGateDecision = {
  /** Whether the webhook should run the money-moving handler for this update. */
  process: boolean;
  /** True when the chat is not on the list (logged in both modes). */
  unlisted: boolean;
};

export function gateTelegramChat(chatId: number | string | null | undefined, gate: TelegramGate): TelegramGateDecision {
  const unlisted = !isChatAllowed(chatId, gate.allowed);
  return { process: !unlisted || gate.mode === "log-only", unlisted };
}
