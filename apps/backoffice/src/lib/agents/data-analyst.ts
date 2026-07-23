// Data analyst agent — the "ask anything" brain behind the Telegram thread.
//
// Owner types a plain-English question in the pulse chat; this agent answers it
// against the LIVE business database. Two layers (owner chose "curated core +
// SQL fallback"):
//   1. Curated: a library of vetted golden Q->SQL examples injected as few-shot
//      context, so the common/critical questions produce known-correct SQL.
//   2. Fallback: for anything novel, the model authors a fresh SELECT from a
//      live-introspected schema catalog.
//
// Safety: every query runs through runReadOnlySql() — a single SELECT/WITH only,
// inside a READ ONLY transaction with a hard statement_timeout and row cap, so a
// mis-authored or injected query can never write. The requester is already
// gated to the owner by the pulse webhook (ownerAllowed).
//
// Models: SQL authoring on claude-sonnet-4-6 (needs to be good at SQL), the
// plain-English explanation on claude-haiku-4-5 (fast + cheap).

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { logAgentAction } from "@celsius/agents/src/substrate";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SQL_MODEL = "claude-sonnet-4-6";
const EXPLAIN_MODEL = "claude-haiku-4-5";
const MAX_ROWS = 200;
const TIMEOUT_MS = 8000;

// ── Schema catalog ───────────────────────────────────────────────────────────
// The business tables the analyst may read. Columns are fetched LIVE from
// information_schema (so they never go stale), but the table list is curated to
// keep the model focused and off archive/system noise.
const CATALOG_TABLES = [
  // Sales — CANONICAL all-channel views (use these for revenue)
  "unified_sales", "unified_sale_items",
  // Sales — per-channel source tables (operational detail only)
  "pos_orders", "pos_order_items", "pos_order_payments", "pos_shifts",
  "consignment_sales", "SalesTransaction",
  // Sales — history (pre-cutover archives)
  "storehub_sales", "hubbo_sales",
  // Dimensions
  "outlets", "Outlet", "fin_outlet_companies",
  // Products / inventory
  "products", "Product", "StockBalance", "StockCountItem", "ParLevel",
  "MenuIngredient", "ProductPackage", "SupplierProduct", "Receiving", "ReceivingItem",
  // Finance
  "fin_transactions", "fin_journal_lines", "fin_accounts", "Invoice", "BankStatementLine",
  // People / HR
  "User", "hr_employee_profiles", "hr_attendance_logs", "hr_schedule_shifts",
  "hr_payroll_items", "hr_overtime_requests", "hr_leave_requests",
  // Loyalty
  "members", "point_transactions", "issued_rewards", "redemptions",
  // Marketing
  "ads_metric_daily", "ads_conversion_daily", "sms_logs", "loop_rounds", "campaign_outcomes",
  // Reviews / ops
  "ReviewDailySnapshot", "OpsAlert", "Checklist", "ChecklistItem",
];

let catalogCache: { text: string; at: number } | null = null;
const CATALOG_TTL_MS = 60 * 60 * 1000;

export async function buildCatalog(): Promise<string> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.text;
  const rows = (await prisma.$queryRawUnsafe(
    `select table_name, column_name, data_type
     from information_schema.columns
     where table_schema = 'public' and table_name = any($1::text[])
     order by table_name, ordinal_position`,
    CATALOG_TABLES,
  )) as Array<{ table_name: string; column_name: string; data_type: string }>;
  const byTable = new Map<string, string[]>();
  for (const r of rows) {
    if (!byTable.has(r.table_name)) byTable.set(r.table_name, []);
    byTable.get(r.table_name)!.push(`${r.column_name} ${r.data_type}`);
  }
  const lines: string[] = [];
  for (const t of CATALOG_TABLES) {
    const cols = byTable.get(t);
    if (cols) lines.push(`"${t}"(${cols.join(", ")})`);
  }
  const text = lines.join("\n");
  catalogCache = { text, at: Date.now() };
  return text;
}

// ── Domain rules the model must know (things the column list alone won't tell) ─
const AUTHOR_SYSTEM = `You are the SQL author for Celsius Coffee (a Malaysian coffee chain). Write ONE read-only PostgreSQL SELECT that answers the owner's question against the given schema. Output ONLY JSON: {"sql": "<query>", "note": "<one line: any assumption you made, or why unanswerable>"}. Use "sql": null if the schema can't answer it.

Hard rules:
- A SINGLE SELECT (or WITH ... SELECT). No writes, no semicolons, no multiple statements. Always include a sensible LIMIT.
- Timestamps are stored in UTC. Malaysia is MYT (UTC+8). For any day/month bucketing or "today"/"this week"/"this month", convert: (col AT TIME ZONE 'Asia/Kuala_Lumpur')::date, and compare to (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date.

Revenue + sales rules (CRITICAL - get the source right):
- For ANY question about revenue, sales, "how much did we sell", AOV, sales by outlet / channel / day / product, or a sales projection: USE "unified_sales", the canonical ALL-CHANNEL view. It combines every channel: pos_native (dine-in POS + Grab), pickup (app/online), and consignment (Nilai / IOI). Using pos_orders alone UNDERCOUNTS revenue by ~25% (it misses pickup + consignment) - do not do it.
- "unified_sales" columns: nett and gross are NUMERIC RINGGIT (already RM, NOT cents - never divide by 100). biz_date is the MYT business date (a plain date; compare it directly to (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date, do NOT timezone-convert biz_date). outlet_name is denormalized (no join needed). source / channel identify the channel. status. Exclude refunds with COALESCE(is_refund, false) = false. Prefer nett for "revenue" unless asked for gross.
- Item / product level: "unified_sale_items" (product_name, variant, quantity, unit_price, line_total - all RM; biz_date; sale_id; outlet_id; source). For product-by-outlet, join unified_sale_items i to unified_sales s ON i.sale_id = s.sale_id and read s.outlet_name (and use s.biz_date / s.is_refund).
- pos_orders / pos_order_items are the POS-REGISTER tables and amounts are INTEGER CENTS (/100 for RM). Use them ONLY for register-specific detail the unified views don't carry: shifts, kitchen station/status, payment tender, cancellation mechanics, promo names. NEVER for total revenue.
- fin_transactions.amount and "Invoice".amount are NUMERIC RINGGIT (accounting ledger / AP, separate from sales). fin_transactions is the P&L/GL source (txn_date, outlet_id = "Outlet".id). "Invoice" = supplier/AP invoices (status PENDING/PAID, expenseCategory, vendorName). "BankStatementLine" = bank feed lines.
- Outlet dimensions (only when a fact table lacks outlet_name): "outlets" (POS side) and "Outlet" (ops/finance/inventory: "Invoice".outletId, "StockBalance".outletId, fin_transactions.outlet_id). Both have name.

Other domains:
- members = loyalty members (phone, name, birthday, preferred_outlet_id, created_at, sms_opt_out).
- "User" = the staff/user directory (id, name, fullName, username). Staff names come from here: join hr_attendance_logs.user_id, hr_* .user_id, and pos_orders.employee_id to "User".id and read "User".name.
- hr_attendance_logs = staff attendance: user_id is the staff id (join "User" for the name), outlet_id, scheduled_date (date), clock_in/clock_out (timestamptz), final_status, total_hours, overtime_hours.
- ReviewDailySnapshot = per-outlet Google review snapshots by snapshotDate (reviewCount, averageRating, reviews7d, reviews30d).

Prefer explicit column lists over SELECT *. If the question is ambiguous, make the most reasonable assumption and say so in "note".`;

const GOLDEN_BLOCK = `Golden examples (correct patterns to follow):

Q: How much did we sell today by outlet?
{"sql": "SELECT outlet_name AS outlet, COUNT(*) AS sales, ROUND(SUM(nett), 2) AS revenue_rm FROM unified_sales WHERE COALESCE(is_refund,false) = false AND biz_date = (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date GROUP BY outlet_name ORDER BY revenue_rm DESC LIMIT 50", "note": "All channels (pos_native + pickup + consignment), nett RM."}

Q: What were total sales this month across all outlets?
{"sql": "SELECT ROUND(SUM(nett), 2) AS revenue_rm, COUNT(*) AS sales, ROUND(AVG(nett), 2) AS aov_rm FROM unified_sales WHERE COALESCE(is_refund,false) = false AND date_trunc('month', biz_date) = date_trunc('month', (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date) LIMIT 1", "note": "All channels, current MYT month."}

Q: What's this month's projected revenue (end of month)?
{"sql": "WITH d AS (SELECT biz_date, SUM(nett) AS day_nett FROM unified_sales WHERE COALESCE(is_refund,false) = false AND biz_date >= date_trunc('month', (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date) AND biz_date < (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date GROUP BY biz_date) SELECT ROUND(SUM(day_nett), 2) AS mtd_complete_rm, COUNT(*) AS complete_days, ROUND(AVG(day_nett), 2) AS avg_day_rm, ROUND(AVG(day_nett) * EXTRACT(day FROM (date_trunc('month', (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date) + interval '1 month - 1 day'))::int, 2) AS projected_month_rm FROM d", "note": "All channels; projects the complete-day average across every day of the month. Excludes the partial current day."}

Q: Top 10 selling products this week by quantity?
{"sql": "SELECT i.product_name, SUM(i.quantity) AS qty, ROUND(SUM(i.line_total), 2) AS revenue_rm FROM unified_sale_items i JOIN unified_sales s ON s.sale_id = i.sale_id WHERE COALESCE(s.is_refund,false) = false AND i.biz_date >= (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - 6 GROUP BY i.product_name ORDER BY qty DESC LIMIT 10", "note": "All channels, last 7 MYT days, RM."}

Q: How much do we still owe suppliers?
{"sql": "SELECT COALESCE(vendorName, supplierId) AS supplier, COUNT(*) AS open_invoices, ROUND(SUM(amount - COALESCE(amountPaid,0)), 2) AS outstanding_rm FROM \\"Invoice\\" WHERE status <> 'PAID' GROUP BY COALESCE(vendorName, supplierId) ORDER BY outstanding_rm DESC LIMIT 50", "note": "Unpaid AP invoices, amounts in RM."}

Q: Who clocked in late today?
{"sql": "SELECT u.name AS staff, o.name AS outlet, a.clock_in, a.scheduled_start, a.final_status FROM hr_attendance_logs a LEFT JOIN \\"User\\" u ON u.id = a.user_id LEFT JOIN \\"Outlet\\" o ON o.id = a.outlet_id WHERE a.scheduled_date = (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date ORDER BY a.clock_in LIMIT 100", "note": "Staff names from User; filter final_status for lateness if a late flag exists."}`;

const EXPLAIN_SYSTEM = `You explain query results to the owner of Celsius Coffee in plain English on Telegram. Rules: lead with the headline number/answer, then only the detail that matters. Malaysian Ringgit (RM), MYT. Be concise (a few short lines, use simple bullets for lists). Round money to 2 dp with thousands separators. If the rows are empty, say plainly that there was nothing for that query. Never invent numbers not in the rows. Do not restate the SQL.`;

// ── Safe read-only execution ─────────────────────────────────────────────────
const DISALLOWED = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|vacuum|reindex|copy|merge|call|lock)\b/i;

export function validateReadOnly(raw: string): { ok: true; sql: string } | { ok: false; reason: string } {
  let sql = raw.trim().replace(/;+\s*$/, "");
  if (!sql) return { ok: false, reason: "empty query" };
  if (sql.includes(";")) return { ok: false, reason: "only a single statement is allowed" };
  const head = sql.replace(/^\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/, "").trimStart();
  if (!/^(select|with)\b/i.test(head)) return { ok: false, reason: "only SELECT / WITH queries are allowed" };
  if (DISALLOWED.test(sql)) return { ok: false, reason: "query contains a disallowed keyword" };
  if (!/\blimit\s+\d+/i.test(sql)) sql = `${sql}\nLIMIT ${MAX_ROWS}`;
  return { ok: true, sql };
}

export async function runReadOnlySql(sql: string): Promise<{ rows: unknown[]; truncated: boolean }> {
  const rows = (await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${TIMEOUT_MS}`);
      return (await tx.$queryRawUnsafe(sql)) as unknown[];
    },
    { timeout: TIMEOUT_MS + 5000, maxWait: 5000 },
  )) as unknown[];
  return { rows, truncated: rows.length >= MAX_ROWS };
}

function safeJson(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (typeof val === "bigint") return Number(val);
    if (val && typeof val === "object" && (val as { constructor?: { name?: string } }).constructor?.name === "Decimal") {
      return Number((val as { toString(): string }).toString());
    }
    return val;
  });
}

function extractJson(text: string): { sql: string | null; note?: string } | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as { sql: string | null; note?: string };
    return o;
  } catch {
    return null;
  }
}

// ── The orchestrator ─────────────────────────────────────────────────────────
export interface DataAnswer {
  answer: string;
  sql?: string;
  rowCount?: number;
  note?: string;
  error?: string;
}

export async function answerDataQuestion(question: string, opts?: { askedBy?: string }): Promise<DataAnswer> {
  if (!process.env.ANTHROPIC_API_KEY) return { answer: "", error: "ANTHROPIC_API_KEY not set" };
  const catalog = await buildCatalog();

  const authorOnce = async (repair?: { sql: string; error: string }) => {
    const userText = repair
      ? `${GOLDEN_BLOCK}\n\nQuestion: ${question}\n\nYour previous query failed:\n${repair.sql}\nError: ${repair.error}\nReturn corrected JSON {"sql": "...", "note": "..."}.`
      : `${GOLDEN_BLOCK}\n\nQuestion: ${question}\n\nReturn ONLY JSON {"sql": "...", "note": "..."}.`;
    const res = await anthropic.messages.create({
      model: SQL_MODEL,
      max_tokens: 1000,
      system: [
        { type: "text", text: AUTHOR_SYSTEM },
        { type: "text", text: `Schema:\n${catalog}`, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userText }],
    });
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    return extractJson(text);
  };

  let authored = await authorOnce();
  if (!authored) return { answer: "", error: "could not author a query" };
  if (!authored.sql) return { answer: authored.note || "I can't answer that from the available data.", note: authored.note };

  let currentSql: string = authored.sql;
  let valid = validateReadOnly(currentSql);
  let ran: { rows: unknown[]; truncated: boolean } | null = null;
  let lastErr = "";
  for (let attempt = 0; attempt < 2 && !ran; attempt++) {
    if (!valid.ok) {
      lastErr = valid.reason;
    } else {
      try {
        ran = await runReadOnlySql(valid.sql);
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    if (!ran) {
      const repaired = await authorOnce({ sql: currentSql, error: lastErr });
      if (!repaired?.sql) break;
      authored = repaired;
      currentSql = repaired.sql;
      valid = validateReadOnly(currentSql);
    }
  }

  const finalSql = valid.ok ? valid.sql : currentSql;
  if (!ran) {
    await logAgentAction({ agentKey: "data_analyst", kind: "query_failed", summary: `Q: ${question.slice(0, 140)} | ${lastErr.slice(0, 200)}`, autonomous: false });
    return { answer: "", sql: finalSql, error: lastErr || "query failed" };
  }

  const rowsJson = safeJson(ran.rows).slice(0, 8000);
  const explain = await anthropic.messages.create({
    model: EXPLAIN_MODEL,
    max_tokens: 700,
    system: [{ type: "text", text: EXPLAIN_SYSTEM }],
    messages: [{
      role: "user",
      content: `Question: ${question}\n\nRows (JSON${ran.truncated ? `, truncated at ${MAX_ROWS}` : ""}): ${rowsJson}\n\nAnswer the question.`,
    }],
  });
  const answer = explain.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();

  await logAgentAction({
    agentKey: "data_analyst",
    kind: "query_answered",
    summary: `Q: ${question.slice(0, 140)} -> ${ran.rows.length} row(s)`,
    autonomous: false,
    meta: { sql: finalSql, rowCount: ran.rows.length, askedBy: opts?.askedBy },
  });

  return { answer, sql: finalSql, rowCount: ran.rows.length, note: authored.note };
}
