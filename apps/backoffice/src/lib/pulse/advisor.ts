/**
 * Celsius Pulse — "ask the business anything" agent.
 *
 * Answers plain-language questions by running read-only SQL against the
 * production database, then replies on Telegram. SQL executes through a
 * dedicated Prisma client connected as the `advisor_readonly` Postgres role
 * (SELECT-only grants + default read-only transactions + 10s statement
 * timeout), never the app's admin connection.
 */

import Anthropic from "@anthropic-ai/sdk";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendMessage, sendChatAction } from "./telegram";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = process.env.PULSE_MODEL || "claude-opus-4-8";
const MAX_TOOL_ITERATIONS = 15;
const MAX_RESULT_ROWS = 200;
const MAX_RESULT_CHARS = 12000;
const HISTORY_LIMIT = 16;

// ─── Read-only DB client ────────────────────────────────────

const globalForPulse = globalThis as unknown as { pulseAdvisorDb?: PrismaClient };

function advisorDb(): PrismaClient {
  if (!globalForPulse.pulseAdvisorDb) {
    globalForPulse.pulseAdvisorDb = new PrismaClient({
      datasources: { db: { url: process.env.PULSE_ADVISOR_DATABASE_URL } },
    });
  }
  return globalForPulse.pulseAdvisorDb;
}

// ─── System prompt ──────────────────────────────────────────

const SYSTEM_PROMPT = `You are Celsius Pulse, the private data advisor for Celsius Coffee — a specialty coffee chain in Malaysia. You chat with Ammar (the founder) on Telegram and answer questions about the business by querying the production Postgres database (read-only).

BUSINESS CONTEXT
- 4 outlets: Shah Alam, Conezion (Putrajaya), Tamarind (Cyberjaya), Nilai.
- Operating companies: Conezion → Celsius Coffee CONEZION SB; Tamarind → Celsius Coffee Tamarind SB; Shah Alam & Nilai → Celsius Coffee SB.
- Per-outlet targets: RM120k revenue/month at ~25% profit; COGS target 35% of sales; people cost 15%; AOV target RM40.
- "Rounds" = day-part segments (Breakfast, Brunch, Lunch, Midday, Evening, Dinner, Supper) with per-outlet daily targets (see "SalesTarget").
- Not SST-registered yet, so SST = 0 on POS receipts is correct.
- GrabFood sales are booked gross; Grab commission is a separate expense.

DATA MAP (Postgres / Supabase, schema public)
Naming: tables created via Prisma are PascalCase and MUST be double-quoted in SQL ("Order", "Invoice", "Outlet"); operational tables are snake_case.
- Native POS sales (live): pos_orders, pos_order_items, pos_order_payments, pos_shifts. Putrajaya (Conezion) cut over to native POS on 2026-06-08; Shah Alam and Tamarind cut over 2026-06-15.
- StoreHub archive (full sales history before cutover): storehub_sales, storehub_sale_items, storehub_products. Don't double-count: per outlet, use StoreHub before its cutover date and pos_orders after.
- Customer app orders (pickup / table QR): orders, order_items. Menu catalog: products, categories.
- Procurement & inventory (PascalCase): "Order" = supplier purchase orders (NOT customer sales), "OrderItem", "Invoice", "Receiving", "ReceivingItem", "StockBalance", "StockCount", "Supplier", "Product" (= ingredients/supplies), "ParLevel".
- Outlets & users: "Outlet" (incl. per-outlet POS cutover timestamp), "User".
- HR: hr_employee_profiles, hr_attendance_logs, hr_schedules, hr_schedule_shifts, hr_payroll_runs, hr_payroll_items, hr_leave_requests, hr_overtime_requests. Overtime hours always floor to whole numbers.
- Finance: "BankStatement", "BankStatementLine" (real bank lines; ledger classification still partly draft — caveat balance-sheet/cashflow answers), fin_* tables (accounts, transactions, journal_lines, periods, ...).
- Loyalty: members, member_brands, point_transactions, tiers, redemptions, voucher_templates, reward_missions. Tier qualification = real RM spend (net of SST), not points.
- Marketing/ads: ads_* (Google Ads), indeed_* (job ads), splash_posters, promotions.
- Ops/QA: "Checklist", "ChecklistItem", "AuditReport", qa_alerts.
- Ignore tables ending in _backup or stamped _20260606 (frozen snapshots).

SQL RULES
- Read-only role: only SELECT / WITH / EXPLAIN execute; one statement per call; 10s timeout.
- Timestamps are stored in UTC. Malaysia is UTC+8: for daily/round groupings convert with (col AT TIME ZONE 'Asia/Kuala_Lumpur').
- Introspect when unsure: query information_schema.columns / information_schema.tables instead of guessing column names.
- Always aggregate in SQL and LIMIT — result sets are truncated to ${MAX_RESULT_ROWS} rows. Never SELECT * from large tables (BankStatementLine ~51k rows, storehub_sale_items ~127k).

ANSWER STYLE (Telegram)
- Plain text only — no markdown (#, **, tables); messages render literally.
- Lead with the answer/number, then 1-3 short supporting lines. Format amounts like RM12,345.
- Briefly state the data source/period when relevant; add a one-line caveat if data may be incomplete (POS cutover, draft ledger).
- If a question is ambiguous, take the most sensible interpretation and say which one you took instead of asking back.
- You may run several queries before answering. Sanity-check surprising numbers with a second query.`;

const RUN_SQL_TOOL: Anthropic.Tool = {
  name: "run_sql",
  description:
    "Run one read-only SQL statement (SELECT / WITH / EXPLAIN) against the Celsius Coffee production Postgres database and get the rows back as JSON. Call this whenever answering requires actual data — including information_schema lookups to discover table/column names.",
  input_schema: {
    type: "object",
    properties: {
      sql: { type: "string", description: "A single read-only SQL statement. No semicolons." },
      purpose: { type: "string", description: "One line: what this query is for." },
    },
    required: ["sql"],
  },
};

// ─── SQL tool execution ─────────────────────────────────────

const READ_ONLY_PATTERN = /^\s*(select|with|explain|show)\b/i;

function jsonSafe(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER
      ? Number(value)
      : value.toString();
  }
  return value;
}

async function runSql(rawSql: string): Promise<{ ok: boolean; result: string }> {
  let sql = rawSql.trim();
  while (sql.endsWith(";")) sql = sql.slice(0, -1).trimEnd();

  if (sql.includes(";")) {
    return { ok: false, result: "Rejected: multiple statements are not allowed. Send one statement, no semicolons." };
  }
  if (!READ_ONLY_PATTERN.test(sql)) {
    return { ok: false, result: "Rejected: only SELECT / WITH / EXPLAIN statements are allowed." };
  }

  try {
    const rows = (await advisorDb().$queryRawUnsafe(sql)) as unknown[];
    if (!Array.isArray(rows)) {
      return { ok: true, result: JSON.stringify(rows, jsonSafe) };
    }
    const truncated = rows.length > MAX_RESULT_ROWS;
    let payload = JSON.stringify(truncated ? rows.slice(0, MAX_RESULT_ROWS) : rows, jsonSafe);
    if (payload.length > MAX_RESULT_CHARS) {
      payload = payload.slice(0, MAX_RESULT_CHARS) + `… [output cut at ${MAX_RESULT_CHARS} chars — aggregate more in SQL]`;
    }
    const meta = truncated ? ` (showing ${MAX_RESULT_ROWS} of ${rows.length} rows — aggregate in SQL instead)` : "";
    return { ok: true, result: `${rows.length} row(s)${meta}:\n${payload}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, result: `Query failed: ${message.slice(0, 600)}` };
  }
}

// ─── Conversation memory ────────────────────────────────────

type StoredMessage = { role: "user" | "assistant"; content: string };

async function loadHistory(chatId: number): Promise<StoredMessage[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<StoredMessage[]>(
      `select role, content from advisor_messages
       where chat_id = $1 and created_at > now() - interval '48 hours'
       order by created_at desc limit ${HISTORY_LIMIT}`,
      chatId,
    );
    const history = rows.reverse();
    while (history.length && history[0].role !== "user") history.shift();
    return history;
  } catch (err) {
    console.error("[pulse] loadHistory failed:", err);
    return [];
  }
}

async function saveMessage(chatId: number, role: "user" | "assistant", content: string): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `insert into advisor_messages (chat_id, role, content) values ($1, $2, $3)`,
      chatId,
      role,
      content,
    );
  } catch (err) {
    console.error("[pulse] saveMessage failed:", err);
  }
}

// ─── Agent loop ─────────────────────────────────────────────

async function runAgent(chatId: number, question: string, history: StoredMessage[]): Promise<string> {
  const todayKL = new Date().toLocaleDateString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content }) as Anthropic.MessageParam),
    { role: "user", content: question },
  ];

  let finalText = "";

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    await sendChatAction(chatId);

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: `${SYSTEM_PROMPT}\n\nToday is ${todayKL} (Asia/Kuala_Lumpur).`,
      tools: [RUN_SQL_TOOL],
      messages,
    });

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (toolUses.length === 0) {
      finalText = text;
      break;
    }

    messages.push({ role: "assistant", content: response.content });

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      const input = toolUse.input as { sql?: string };
      const { ok, result } = await runSql(input.sql ?? "");
      console.log(`[pulse] sql ${ok ? "ok" : "err"}: ${(input.sql ?? "").slice(0, 200)}`);
      results.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result,
        is_error: !ok,
      });
    }
    messages.push({ role: "user", content: results });
  }

  return finalText || "I ran out of query attempts before reaching an answer — try narrowing the question.";
}

// ─── Entry point (called from the webhook via after()) ──────

export async function handleQuestion(chatId: number, question: string): Promise<void> {
  const history = await loadHistory(chatId);
  await saveMessage(chatId, "user", question);

  try {
    const answer = await runAgent(chatId, question, history);
    await sendMessage(chatId, answer);
    await saveMessage(chatId, "assistant", answer);
  } catch (err) {
    console.error("[pulse] agent error:", err);
    const message = err instanceof Error ? err.message : "unknown error";
    await sendMessage(chatId, `⚠️ Couldn't answer that: ${message.slice(0, 300)}`);
  }
}

export const WELCOME_MESSAGE = `Celsius Pulse here ☕ — ask me anything about the business.

Examples:
• sales semalam ikut outlet?
• AOV Conezion this week vs target?
• top 10 products by revenue this month
• siapa belum clock out hari ini?
• how much did we pay suppliers in May?

I answer from the live database (read-only).`;
