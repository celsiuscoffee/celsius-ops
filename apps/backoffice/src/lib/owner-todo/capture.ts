// Owner to-do capture agent (docs/design/owner-todo-kanban.md).
//
// The owner's Mac ships batches of his own WhatsApp messages (read from the
// WhatsApp Desktop SQLite store by scripts/owner-todo-scanner.mjs). For each
// chat window this asks the model for two things and nothing else:
//   - open asks addressed to the owner (someone wants something from him)
//   - open promises the owner made (he said he would do something)
// Each finding becomes an OpsReminder card. Dedup is structural: the card's
// (source, sourceRef) is the originating message, unique in the DB, so a
// rescan of the same window can never propose the same ask twice, and a card
// the owner rejected stays rejected.
//
// Mode (agent_registry.owner_todo_capture):
//   off    -> ingest accepts and discards (nothing is read by the model)
//   shadow -> proposals land in Triage; owner accepts/rejects (measures precision)
//   armed  -> confident proposals land in To Do directly, the rest in Triage

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { getAgentMode, logAgentAction, touchAgentRun } from "@celsius/agents/src/substrate";

export const CAPTURE_AGENT_KEY = "owner_todo_capture";
const MODEL = "claude-sonnet-4-6";
// Below this the proposal stays in Triage even when armed.
const ARMED_CONFIDENCE = 0.8;
// Guard rails on what one ingest call may cost.
const MAX_CHATS_PER_CALL = 40;
const MAX_MESSAGES_PER_CHAT = 120;
const CONCURRENCY = 4;

export type CaptureSource = "whatsapp" | "telegram" | "email" | "notes" | "sheet";

export interface IncomingMessage {
  id: string; // stable per-source id (WhatsApp: the message Z_PK)
  ts: string; // ISO
  fromMe: boolean;
  sender: string; // display name or a stable member id; "me" when fromMe
  text: string;
  replyTo?: string | null; // text of the message this replies to, if any
  isNew: boolean; // true = not seen by a previous scan (context rows are false)
}

export interface IncomingChat {
  chatId: string; // WhatsApp jid
  chatName: string;
  isGroup: boolean;
  messages: IncomingMessage[]; // chronological, a 24h window + the new rows
}

export interface CaptureInput {
  source: CaptureSource;
  ownerUserId: string;
  ownerName: string;
  chats: IncomingChat[];
}

export interface CaptureResult {
  mode: "off" | "shadow" | "armed";
  chatsScanned: number;
  proposed: number;
  duplicates: number;
  skipped: number;
  errors: number;
}

interface Extracted {
  message_id: string;
  kind: "ask" | "promise";
  title: string;
  who: string;
  confidence: number;
  due?: string | null; // ISO date or null
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function createWithRetry(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await anthropic.messages.create(params);
    } catch (e) {
      lastErr = e;
      const status = (e as { status?: number }).status;
      const retryable = status === 429 || status === 529 || (typeof status === "number" && status >= 500);
      if (!retryable) throw e;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function systemPrompt(ownerName: string, todayIso: string): string {
  return `You extract to-do items for ${ownerName}, the owner of Celsius Coffee (a Malaysian coffee chain) and a few other ventures, from his own chat messages. Messages are in English, Malay, or a mix. Today is ${todayIso} (Malaysia).

Return ONLY a JSON array. Each element:
{"message_id": "<id of the message the item comes from>", "kind": "ask" | "promise", "title": "<one line, imperative, in the language of the message, max 90 chars>", "who": "<the person or group involved>", "confidence": <0..1>, "due": "<YYYY-MM-DD or null>"}

Include ONLY:
- "ask": someone asks ${ownerName} for something that is still open at the end of the window (a decision, a payment, a document, a reply, an approval, attendance at something).
- "promise": ${ownerName} himself says he will do something ("will do", "nanti saya", "ok let me check", "I'll send", "on it") and the window does not show him doing it.

Exclude: anything already answered or done later in the same window; small talk; news, forwards, broadcasts, jokes, ads; questions answered by someone else; asks aimed at other people in a group unless ${ownerName} is named or replied to; recurring group chatter with no action for him; anything older than the NEW messages unless it is still visibly waiting on him.

The message_id must be the id of the message containing the ask or promise. Only consider messages marked NEW as candidates; the older messages are context. If nothing qualifies, return [].`;
}

function renderWindow(chat: IncomingChat, ownerName: string): string {
  const rows = chat.messages.slice(-MAX_MESSAGES_PER_CHAT).map((m) => {
    const who = m.fromMe ? `${ownerName} (me)` : m.sender;
    const reply = m.replyTo ? ` [replying to: "${m.replyTo.slice(0, 80)}"]` : "";
    const flag = m.isNew ? "NEW " : "    ";
    return `${flag}#${m.id} ${m.ts.slice(0, 16).replace("T", " ")} ${who}:${reply} ${m.text.replace(/\s+/g, " ").slice(0, 600)}`;
  });
  return `Chat: ${chat.chatName}${chat.isGroup ? " (group)" : " (1:1)"}\n${rows.join("\n")}`;
}

function parseExtracted(text: string): Extracted[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const arr = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x === "object" && typeof x.message_id === "string" && typeof x.title === "string")
      .map((x) => ({
        message_id: String(x.message_id).replace(/^#/, ""),
        kind: x.kind === "promise" ? "promise" : "ask",
        title: String(x.title).trim().slice(0, 140),
        who: typeof x.who === "string" ? x.who.slice(0, 80) : "",
        confidence: Math.max(0, Math.min(1, Number(x.confidence) || 0)),
        due: typeof x.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.due) ? x.due : null,
      }));
  } catch {
    return [];
  }
}

async function extractFromChat(
  chat: IncomingChat,
  ownerName: string,
  todayIso: string,
): Promise<{ items: Extracted[]; usage: Anthropic.Message["usage"] | null }> {
  const res = await createWithRetry({
    model: MODEL,
    max_tokens: 1200,
    system: systemPrompt(ownerName, todayIso),
    messages: [{ role: "user", content: renderWindow(chat, ownerName) }],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return { items: parseExtracted(text), usage: res.usage };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function captureFromMessages(input: CaptureInput): Promise<CaptureResult> {
  const mode = await getAgentMode(CAPTURE_AGENT_KEY);
  await touchAgentRun(CAPTURE_AGENT_KEY);
  const result: CaptureResult = { mode, chatsScanned: 0, proposed: 0, duplicates: 0, skipped: 0, errors: 0 };
  if (mode === "off") return result;

  // Only chats with at least one NEW text message are worth a model call.
  const chats = input.chats
    .filter((c) => c.messages.some((m) => m.isNew && m.text.trim()))
    .slice(0, MAX_CHATS_PER_CALL);
  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });

  await mapLimit(chats, CONCURRENCY, async (chat) => {
    let items: Extracted[] = [];
    let usage: Anthropic.Message["usage"] | null = null;
    try {
      ({ items, usage } = await extractFromChat(chat, input.ownerName, todayIso));
      result.chatsScanned++;
    } catch (e) {
      result.errors++;
      console.error(`[owner-todo] extract failed for ${chat.chatName}:`, e);
      return;
    }

    // One ledger row per chat scanned (cost + what it found), then one per card.
    await logAgentAction({
      agentKey: CAPTURE_AGENT_KEY,
      kind: items.length ? "todo_scanned" : "todo_skipped",
      summary: `${chat.chatName}: ${items.length} candidate${items.length === 1 ? "" : "s"} from ${chat.messages.filter((m) => m.isNew).length} new messages`,
      model: MODEL,
      usage,
      meta: { source: input.source, chatId: chat.chatId, candidates: items.length },
    });

    for (const item of items) {
      const msg = chat.messages.find((m) => m.id === item.message_id);
      if (!msg || !msg.isNew) {
        result.skipped++;
        continue;
      }
      const sourceRef = `${chat.chatId}#${msg.id}`;
      const stage = mode === "armed" && item.confidence >= ARMED_CONFIDENCE ? "todo" : "triage";
      const title = item.kind === "promise" ? item.title : item.who ? `${item.title} (${item.who})` : item.title;
      try {
        const created = await prisma.opsReminder.create({
          data: {
            title: title.slice(0, 200),
            notes: item.kind === "promise" ? "You said you would." : "Someone is waiting on you.",
            createdByUserId: input.ownerUserId,
            assigneeUserId: null,
            dueAt: item.due ? new Date(`${item.due}T12:00:00+08:00`) : null,
            source: input.source,
            sourceRef,
            sourceChat: chat.chatName,
            sourceExcerpt: msg.text.slice(0, 1000),
            stage,
            proposedByAgent: true,
            confidence: item.confidence,
          },
          select: { id: true },
        });
        result.proposed++;
        await logAgentAction({
          agentKey: CAPTURE_AGENT_KEY,
          kind: "todo_proposed",
          summary: `${stage === "todo" ? "To Do" : "Triage"}: ${title}`,
          refTable: "OpsReminder",
          refId: created.id,
          confidence: item.confidence,
          meta: { source: input.source, chatId: chat.chatId, messageId: msg.id, kind: item.kind, stage },
        });
      } catch (e) {
        // Unique (source, sourceRef) -> this message was already proposed.
        const code = (e as { code?: string }).code;
        if (code === "P2002") {
          result.duplicates++;
        } else {
          result.errors++;
          console.error("[owner-todo] card insert failed:", e);
        }
      }
    }
  });

  return result;
}
