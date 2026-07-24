// The intelligence agent - the owner's business brain on Telegram.
//
// Where data-analyst.ts answers ONE question with ONE query, this runs an
// agentic loop: the model reasons, queries the warehouse as many times as it
// needs (run_sql), remembers what it learns (remember/recall), and holds a real
// two-way conversation (per-chat history). It gets smarter over time - every
// correction or business fact it saves is applied to every future answer.
//
// Same read-only safety as the analyst: run_sql goes through validateReadOnly +
// runReadOnlySql (single SELECT, READ ONLY transaction, timeout, row cap). It
// cannot write to the business data; it can only write to its own memory tables.

import Anthropic from "@anthropic-ai/sdk";
import { getAgentClient, logAgentAction } from "@celsius/agents/src/substrate";
import { buildCatalog, runReadOnlySql, validateReadOnly, safeJson, DOMAIN_RULES } from "./data-analyst";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-4-6";
const MAX_STEPS = 6; // tool-use round trips before we force an answer
const HISTORY_TURNS = 10; // conversation turns loaded for context
const MEMORY_LIMIT = 60; // learned items injected into the system prompt

type Memory = { kind: string; content: string };

async function loadMemories(): Promise<Memory[]> {
  try {
    const { data } = await getAgentClient()
      .from("analyst_memory").select("kind, content")
      .eq("active", true).order("created_at", { ascending: false }).limit(MEMORY_LIMIT);
    return (data as Memory[] | null) ?? [];
  } catch (e) {
    console.error("[intelligence] loadMemories failed:", e);
    return [];
  }
}

async function saveMemory(kind: string, content: string, source: string): Promise<void> {
  try {
    await getAgentClient().from("analyst_memory").insert({ kind, content: content.slice(0, 1000), source });
  } catch (e) {
    console.error("[intelligence] saveMemory failed:", e);
  }
}

async function recallMemory(query: string): Promise<Memory[]> {
  try {
    const { data } = await getAgentClient()
      .from("analyst_memory").select("kind, content")
      .eq("active", true).ilike("content", `%${query.slice(0, 60)}%`).limit(15);
    return (data as Memory[] | null) ?? [];
  } catch {
    return [];
  }
}

async function loadHistory(chatId: string): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  try {
    const { data } = await getAgentClient()
      .from("analyst_conversations").select("role, content")
      .eq("chat_id", chatId).order("created_at", { ascending: false }).limit(HISTORY_TURNS);
    const rows = ((data as Array<{ role: string; content: string }> | null) ?? []).reverse();
    return rows.map((r) => ({ role: r.role === "assistant" ? "assistant" : "user", content: r.content }));
  } catch {
    return [];
  }
}

async function saveTurn(chatId: string, role: "user" | "assistant", content: string, askedBy?: string): Promise<void> {
  try {
    await getAgentClient().from("analyst_conversations")
      .insert({ chat_id: chatId, role, content: content.slice(0, 4000), asked_by: askedBy ?? null });
  } catch (e) {
    console.error("[intelligence] saveTurn failed:", e);
  }
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "run_sql",
    description: "Run ONE read-only PostgreSQL SELECT (or WITH...SELECT) against the live Celsius database and get the rows back as JSON. Read-only - a write is rejected. Call it as many times as you need to reason to the answer.",
    input_schema: { type: "object", properties: { sql: { type: "string", description: "A single SELECT / WITH query." } }, required: ["sql"] },
  },
  {
    name: "remember",
    description: "Save a durable fact, definition, preference, correction, or a proven query for future answers. Use whenever the owner teaches or corrects you, or you discover a stable business fact worth keeping.",
    input_schema: { type: "object", properties: { content: { type: "string" }, kind: { type: "string", enum: ["fact", "definition", "preference", "correction", "golden_query"] } }, required: ["content"] },
  },
  {
    name: "recall",
    description: "Search your saved memory for anything relevant to a keyword.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
];

function systemPrompt(catalog: string, memories: Memory[]): string {
  const mem = memories.length ? memories.map((m) => `- (${m.kind}) ${m.content}`).join("\n") : "(nothing learned yet)";
  return `You are the business intelligence for the owner of Celsius Coffee, a Malaysian coffee chain (outlets: Shah Alam, Putrajaya/Conezion, Tamarind/Cyberjaya; Nilai is consignment). You are their trusted analyst and advisor on Telegram: you answer questions using the LIVE database, reason across multiple queries when needed, hold a real back-and-forth, and get smarter over time by remembering what you learn.

How you work:
- Use run_sql to get real numbers - never guess or invent figures. Query as many times as you need; break a hard question into steps. All queries are read-only.
- Think like the owner's analyst: lead with the answer and the "so what", not a data dump. Money in RM, dates MYT. Be concise on Telegram (a few short lines; simple bullets for lists). Add a brief insight or sharp follow-up only when genuinely useful.
- You have conversation memory - use the prior turns to resolve follow-ups ("why?", "and last month?").
- LEARN: when the owner corrects you, teaches a definition, states a preference, or you find a stable reusable fact or a good query, call remember so you apply it forever. Remember corrections immediately.
- If a question is genuinely ambiguous, ask ONE sharp clarifying question rather than guess wildly.
- Never show raw SQL unless asked. Never fabricate numbers.

${DOMAIN_RULES}

What you've learned so far:
${mem}

Database schema (tables you can query):
${catalog}`;
}

export interface IntelligenceResult {
  answer: string;
  error?: string;
  steps: number;
  learned: number;
}

export async function runIntelligence(chatId: string, question: string, askedBy?: string): Promise<IntelligenceResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { answer: "", error: "ANTHROPIC_API_KEY not set", steps: 0, learned: 0 };

  const [catalog, memories, history] = await Promise.all([buildCatalog(), loadMemories(), loadHistory(chatId)]);
  const system = systemPrompt(catalog, memories);

  const messages: Anthropic.MessageParam[] = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user" as const, content: question },
  ];

  let learned = 0;
  let steps = 0;
  let finalText = "";

  for (let i = 0; i < MAX_STEPS; i++) {
    steps++;
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages,
    });
    const textOut = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();

    if (res.stop_reason !== "tool_use") {
      finalText = textOut;
      break;
    }

    messages.push({ role: "assistant", content: res.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      const input = block.input as Record<string, unknown>;
      let out = "";
      if (block.name === "run_sql") {
        const v = validateReadOnly(String(input.sql ?? ""));
        if (!v.ok) {
          out = `ERROR: ${v.reason}`;
        } else {
          try {
            const r = await runReadOnlySql(v.sql);
            out = `${r.rows.length} row(s)${r.truncated ? " (truncated)" : ""}: ${safeJson(r.rows).slice(0, 6000)}`;
          } catch (e) {
            out = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
          }
        }
      } else if (block.name === "remember") {
        await saveMemory(String(input.kind ?? "fact"), String(input.content ?? ""), askedBy ?? "owner");
        learned++;
        out = "saved";
      } else if (block.name === "recall") {
        const hits = await recallMemory(String(input.query ?? ""));
        out = hits.length ? hits.map((h) => `(${h.kind}) ${h.content}`).join("\n") : "nothing found";
      } else {
        out = "unknown tool";
      }
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: out });
    }
    messages.push({ role: "user", content: toolResults });
  }

  if (!finalText) finalText = "I ran out of steps on that one - try narrowing the question a little.";

  await saveTurn(chatId, "user", question, askedBy);
  await saveTurn(chatId, "assistant", finalText);
  await logAgentAction({
    agentKey: "data_analyst",
    kind: "intelligence_answer",
    summary: `Q: ${question.slice(0, 120)} (${steps} step(s), ${learned} learned)`,
    autonomous: false,
    meta: { chatId, askedBy, steps, learned },
  });

  return { answer: finalText, steps, learned };
}
