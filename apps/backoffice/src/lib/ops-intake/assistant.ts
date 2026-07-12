// Internal Q&A assistant (Approach B of the internal-assistant plan).
//
// Answers owner/manager questions over WhatsApp from a FIXED set of read-only
// tools — "berapa sales hari ni?", "checklist Putrajaya siap tak?", "PO mana
// belum sampai?" — or routes the message to the bug-report path when it's a
// problem report, not a question (the model calls file_bug_report and the
// intake handler files it exactly as before).
//
// Guardrails, in code not prompt:
//   - Tools are hand-written Prisma/SQL reads. NO free-form SQL, NO writes.
//   - Role scoping: MANAGER gets ops tools only, hard-filtered to their own
//     outlet(s) server-side (the model can't ask for another outlet's data —
//     the filter is applied to the query, not requested from the model).
//     Finance tools (unpaid invoices, WhatsApp spend) exist only for
//     OWNER/ADMIN — they are not in a manager's tool list at all.
//   - Bounded loop (4 tool rounds), bounded output, 15s-ish worst case — the
//     webhook still returns fast because intake awaits are already best-effort.
//   - Any failure → caller falls back to filing a report. Never throws.
//
// Model: claude-sonnet-4-6 (repo precedent — supplier-chat-agent).
// Enabled when ANTHROPIC_API_KEY is set; kill switch INTERNAL_ASSISTANT=off.

import Anthropic from "@anthropic-ai/sdk";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DATA_MAP } from "./data-map";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export function assistantEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY && (process.env.INTERNAL_ASSISTANT || "").toLowerCase() !== "off";
}

export interface AssistantReporter {
  id: string;
  name: string;
  role: string; // OWNER | ADMIN | MANAGER
  outletId: string | null;
  outletIds: string[];
}

export type AssistantOutcome =
  | { kind: "reply"; text: string }
  | { kind: "report" } // model says it's a problem report → file it
  | { kind: "none" }; // failed / empty → caller falls back to filing

const MYT_OFFSET_MS = 8 * 3_600_000;
function mytDayStart(): Date {
  const ymd = new Date(Date.now() + MYT_OFFSET_MS).toISOString().slice(0, 10);
  return new Date(`${ymd}T00:00:00+08:00`);
}
function mytYmd(): string {
  return new Date(Date.now() + MYT_OFFSET_MS).toISOString().slice(0, 10);
}
const rm = (n: number) => `RM${n.toFixed(2)}`;

// ── Outlet scoping ────────────────────────────────────────────────────────────
// The manager's allowed outlets are resolved ONCE and applied inside every query.
async function scopeOutlets(reporter: AssistantReporter): Promise<{ ids: string[] | null; label: string }> {
  if (reporter.role === "OWNER" || reporter.role === "ADMIN") return { ids: null, label: "all outlets" };
  const ids = [...new Set([reporter.outletId, ...reporter.outletIds].filter((x): x is string => !!x))];
  if (ids.length === 0) return { ids: ["__none__"], label: "no outlet on file" };
  const outlets = await prisma.outlet.findMany({ where: { id: { in: ids } }, select: { name: true } });
  return { ids, label: outlets.map((o) => o.name).join(", ") || "your outlet" };
}

// ── Tools (each returns a compact JSON-able object) ───────────────────────────

// Sales come from the unified_sales VIEW (own-POS live + StoreHub history +
// consignment) — NOT the stale SalesTransaction sync. Revenue convention:
// nett, excluding refunds and paymentCancelled.
const salesOutletFilter = (outletIds: string[] | null) =>
  outletIds ? Prisma.sql`AND outlet_id IN (${Prisma.join(outletIds)})` : Prisma.empty;
const SALES_VALID = Prisma.sql`NOT is_refund AND (status IS NULL OR status <> 'paymentCancelled')`;

async function todaySales(outletIds: string[] | null) {
  const rows = await prisma.$queryRaw<Array<{ outlet: string; nett: number; txns: bigint }>>`
    SELECT outlet_name AS outlet, COALESCE(sum(nett), 0)::float AS nett, count(*) AS txns
    FROM unified_sales
    WHERE biz_date = (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date
      AND ${SALES_VALID} ${salesOutletFilter(outletIds)}
    GROUP BY 1 ORDER BY 2 DESC
  `;
  const total = rows.reduce((s, r) => s + r.nett, 0);
  return {
    date: mytYmd(),
    perOutlet: rows.map((r) => ({ outlet: r.outlet, nett: rm(r.nett), transactions: Number(r.txns) })),
    total: rm(total),
    note: "nett (after discount/SST), refunds & cancelled excluded",
  };
}

async function checklistStatus(outletIds: string[] | null) {
  const dateOnly = new Date(`${mytYmd()}T00:00:00Z`);
  const rows = await prisma.checklist.findMany({
    where: { date: dateOnly, ...(outletIds ? { outletId: { in: outletIds } } : {}) },
    select: {
      status: true,
      timeSlot: true,
      outlet: { select: { name: true } },
      sop: { select: { title: true } },
      assignedTo: { select: { name: true } },
    },
  });
  const pending = rows.filter((r) => r.status !== "COMPLETED");
  return {
    date: mytYmd(),
    total: rows.length,
    completed: rows.length - pending.length,
    pending: pending.slice(0, 20).map((r) => ({
      task: r.sop?.title ?? "Checklist",
      outlet: r.outlet?.name ?? "?",
      owner: r.assignedTo?.name ?? "UNASSIGNED",
      slot: r.timeSlot,
    })),
    pendingOverflow: Math.max(0, pending.length - 20),
  };
}

async function clockInStatus(outletIds: string[] | null) {
  const ymd = mytYmd();
  const rows = await prisma.$queryRaw<
    Array<{ outlet_name: string; user_name: string; start_time: string | null; clocked_in: boolean }>
  >`
    SELECT o.name AS outlet_name, u.name AS user_name, s.start_time::text AS start_time,
           EXISTS (
             SELECT 1 FROM hr_attendance_logs al
             WHERE al.user_id = s.user_id AND al.clock_in >= ${new Date(`${ymd}T00:00:00+08:00`)}
           ) AS clocked_in
    FROM hr_schedule_shifts s
    JOIN hr_schedules sch ON sch.id = s.schedule_id AND sch.published_at IS NOT NULL
    JOIN "User" u ON u.id = s.user_id AND u.status = 'ACTIVE'
    JOIN "Outlet" o ON o.id = sch.outlet_id
    WHERE s.shift_date = ${ymd}::date
    ORDER BY o.name, s.start_time
  `;
  const scoped = outletIds
    ? rows // scoping below by outlet id needs ids; refetch names
    : rows;
  // Outlet scoping by name is unreliable — apply by id via a second lookup when scoped.
  let filtered = scoped;
  if (outletIds) {
    const allowed = await prisma.outlet.findMany({ where: { id: { in: outletIds } }, select: { name: true } });
    const names = new Set(allowed.map((o) => o.name));
    filtered = rows.filter((r) => names.has(r.outlet_name));
  }
  const missing = filtered.filter((r) => !r.clocked_in);
  return {
    date: ymd,
    rostered: filtered.length,
    clockedIn: filtered.length - missing.length,
    notClockedIn: missing.slice(0, 25).map((r) => ({ name: r.user_name, outlet: r.outlet_name, shift: r.start_time })),
  };
}

async function openPurchaseOrders(outletIds: string[] | null) {
  const rows = await prisma.order.findMany({
    where: {
      orderType: "PURCHASE_ORDER",
      status: { in: ["PENDING_APPROVAL", "APPROVED", "SENT", "CONFIRMED", "AWAITING_DELIVERY", "PARTIALLY_RECEIVED"] },
      ...(outletIds ? { outletId: { in: outletIds } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      orderNumber: true,
      status: true,
      totalAmount: true,
      deliveryDate: true,
      supplier: { select: { name: true } },
      outlet: { select: { name: true } },
    },
  });
  return {
    open: rows.map((r) => ({
      po: r.orderNumber,
      supplier: r.supplier?.name ?? "?",
      outlet: r.outlet?.name ?? "?",
      status: r.status,
      amount: rm(Number(r.totalAmount ?? 0)),
      delivery: r.deliveryDate ? r.deliveryDate.toISOString().slice(0, 10) : null,
    })),
  };
}

async function stockAlerts(outletIds: string[] | null) {
  const [pars, stocks] = await Promise.all([
    prisma.parLevel.findMany({
      where: outletIds ? { outletId: { in: outletIds } } : {},
      select: { productId: true, outletId: true, reorderPoint: true },
    }),
    prisma.stockBalance.findMany({
      where: outletIds ? { outletId: { in: outletIds } } : {},
      select: { productId: true, outletId: true, quantity: true },
    }),
  ]);
  const stockMap = new Map(stocks.map((s) => [`${s.outletId}:${s.productId}`, Number(s.quantity)]));
  const low = pars
    .map((p) => ({ ...p, qty: stockMap.get(`${p.outletId}:${p.productId}`) ?? 0 }))
    .filter((p) => p.qty <= Number(p.reorderPoint));
  const [products, outlets] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: [...new Set(low.map((l) => l.productId))].slice(0, 50) } },
      select: { id: true, name: true, baseUom: true },
    }),
    prisma.outlet.findMany({
      where: { id: { in: [...new Set(low.map((l) => l.outletId))] } },
      select: { id: true, name: true },
    }),
  ]);
  const pName = new Map(products.map((p) => [p.id, p]));
  const oName = new Map(outlets.map((o) => [o.id, o.name]));
  return {
    lowStock: low.slice(0, 15).map((l) => ({
      product: pName.get(l.productId)?.name ?? "?",
      outlet: oName.get(l.outletId) ?? "?",
      qty: l.qty,
      uom: pName.get(l.productId)?.baseUom ?? "",
      reorderPoint: Number(l.reorderPoint),
    })),
    totalLow: low.length,
  };
}

async function openSystemReports() {
  const rows = await prisma.systemReport.findMany({
    where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: { id: true, reporterName: true, body: true, status: true, createdAt: true, mediaUrls: true },
  });
  return {
    reports: rows.map((r) => ({
      ref: r.id.slice(0, 8),
      by: r.reporterName,
      status: r.status,
      ageHours: Math.round((Date.now() - +r.createdAt) / 3_600_000),
      summary: (r.body || "(screenshot)").slice(0, 120),
      attachments: r.mediaUrls.length,
    })),
  };
}

async function salesHistory(outletIds: string[] | null, days: number, by: "day" | "outlet" | "product") {
  const d = Math.max(1, Math.min(93, Math.round(days || 7)));
  if (by === "product") {
    const rows = await prisma.$queryRaw<Array<{ product: string; revenue: number; qty: number }>>`
      SELECT product_name AS product, COALESCE(sum(line_total), 0)::float AS revenue,
             COALESCE(sum(quantity), 0)::float AS qty
      FROM unified_sale_items
      WHERE biz_date >= current_date - ${d} ${salesOutletFilter(outletIds)}
      GROUP BY 1 ORDER BY 2 DESC LIMIT 15
    `;
    return { days: d, topProducts: rows.map((r) => ({ product: r.product, revenue: rm(r.revenue), qty: r.qty })) };
  }
  if (by === "outlet") {
    const rows = await prisma.$queryRaw<Array<{ outlet: string; nett: number; txns: bigint }>>`
      SELECT outlet_name AS outlet, COALESCE(sum(nett), 0)::float AS nett, count(*) AS txns
      FROM unified_sales
      WHERE biz_date >= current_date - ${d} AND ${SALES_VALID} ${salesOutletFilter(outletIds)}
      GROUP BY 1 ORDER BY 2 DESC
    `;
    return { days: d, perOutlet: rows.map((r) => ({ outlet: r.outlet, nett: rm(r.nett), transactions: Number(r.txns) })) };
  }
  const rows = await prisma.$queryRaw<Array<{ day: string; nett: number; txns: bigint }>>`
    SELECT biz_date::text AS day, COALESCE(sum(nett), 0)::float AS nett, count(*) AS txns
    FROM unified_sales
    WHERE biz_date >= current_date - ${d} AND ${SALES_VALID} ${salesOutletFilter(outletIds)}
    GROUP BY 1 ORDER BY 1 DESC
  `;
  return { days: d, perDay: rows.map((r) => ({ day: r.day, nett: rm(r.nett), transactions: Number(r.txns) })) };
}

async function wastageSummary(outletIds: string[] | null, days: number) {
  const d = Math.max(1, Math.min(31, Math.round(days || 7)));
  const rows = await prisma.stockAdjustment.findMany({
    where: {
      createdAt: { gte: new Date(Date.now() - d * 86_400_000) },
      adjustmentType: { in: ["WASTAGE", "BREAKAGE", "EXPIRED", "SPILLAGE"] },
      ...(outletIds ? { outletId: { in: outletIds } } : {}),
    },
    select: {
      adjustmentType: true,
      quantity: true,
      costAmount: true,
      product: { select: { name: true, baseUom: true } },
      outlet: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const totalCost = rows.reduce((s, r) => s + Number(r.costAmount ?? 0), 0);
  const byProduct = new Map<string, { qty: number; cost: number; uom: string }>();
  for (const r of rows) {
    const key = r.product.name;
    const e = byProduct.get(key) ?? { qty: 0, cost: 0, uom: r.product.baseUom ?? "" };
    e.qty += Number(r.quantity);
    e.cost += Number(r.costAmount ?? 0);
    byProduct.set(key, e);
  }
  const top = [...byProduct.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 15)
    .map(([product, v]) => ({ product, qty: v.qty, uom: v.uom, cost: rm(v.cost) }));
  return { days: d, events: rows.length, estCost: rm(totalCost), topProducts: top };
}

// ── Owner-only "real intelligence": guarded schema exploration + SELECT-only SQL ──
// The model can explore the ACTUAL database when the canned tools don't cover a
// question. Every guard is enforced in code:
//   - public schema only; credential-ish columns denied by keyword
//   - single statement, comments stripped, write/DDL keywords rejected
//   - the query is wrapped as SELECT * FROM ( <sql> ) q LIMIT 200 — anything
//     that isn't a SELECT fails to parse inside FROM, and rows are capped
//   - 8s statement timeout inside a transaction; output capped at ~12k chars
const SQL_DENY =
  /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|vacuum|execute|call|do|listen|notify|reset|begin|commit|rollback|lock|reindex|cluster|comment|prepare|deallocate|pg_sleep|pg_read|pg_write|pg_terminate_backend|pg_cancel_backend|dblink|lo_import|lo_export)\b/i;
const SQL_SENSITIVE = /passwordhash|"pin"|\botp\b|secret|apikey|api_key|refresh_token|access_token/i;

function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

async function queryDatabase(rawSql: string) {
  const sql = stripSqlComments(String(rawSql ?? "")).trim().replace(/;+\s*$/, "");
  if (!sql) return { error: "empty query" };
  if (sql.includes(";")) return { error: "one statement only" };
  if (!/^\s*(select|with)\b/i.test(sql)) return { error: "SELECT/WITH queries only" };
  if (SQL_DENY.test(sql)) return { error: "write/DDL keywords are not allowed" };
  if (SQL_SENSITIVE.test(sql)) return { error: "credential columns are off-limits" };
  if (/\b(auth|storage|pg_catalog|information_schema)\s*\./i.test(sql))
    return { error: "public schema only" };

  const wrapped = `SELECT * FROM ( ${sql} ) q LIMIT 200`;
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = 8000");
    return tx.$queryRawUnsafe<unknown[]>(wrapped);
  });
  // BigInt-safe serialize; cap the payload so a fat result can't blow the prompt.
  const json = JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? Number(v) : v));
  if (json.length > 12_000) {
    return {
      rowCount: Array.isArray(rows) ? rows.length : 0,
      truncated: true,
      note: "result truncated at 12k chars — narrow the query (fewer columns, tighter WHERE, aggregate)",
      rowsJson: json.slice(0, 12_000),
    };
  }
  return { rowCount: Array.isArray(rows) ? rows.length : 0, rows };
}

async function listTables() {
  const rows = await prisma.$queryRaw<Array<{ table_name: string; approx_rows: number }>>`
    SELECT c.relname AS table_name, GREATEST(c.reltuples, 0)::float AS approx_rows
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  `;
  return { tables: rows.map((r) => ({ name: r.table_name, approxRows: Math.round(r.approx_rows) })) };
}

async function describeTable(table: string) {
  const rows = await prisma.$queryRaw<Array<{ column_name: string; data_type: string; is_nullable: string }>>`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${String(table ?? "")}
    ORDER BY ordinal_position
  `;
  if (rows.length === 0) return { error: `no public table named ${table}` };
  const cols = rows.filter((c) => !SQL_SENSITIVE.test(c.column_name));
  return { table, columns: cols.map((c) => ({ name: c.column_name, type: c.data_type, nullable: c.is_nullable === "YES" })) };
}

// OWNER/ADMIN only — the canonical cash-for-salary projection, encoded once so
// the answer is deterministic instead of re-derived by exploration each time.
// Sources per the data map: BankStatement.closingBalance (NOT the empty
// fin_bank_transactions), fin_payroll_actuals, Invoice, BankStatementLine flows.
async function cashPosition() {
  const [accounts, payroll, flows, unpaidAgg] = await Promise.all([
    prisma.$queryRaw<Array<{ account: string; as_of: string; closing: number }>>`
      SELECT DISTINCT ON ("accountName") "accountName" AS account,
             "statementDate"::date::text AS as_of, "closingBalance"::float AS closing
      FROM "BankStatement" ORDER BY "accountName", "statementDate" DESC
    `,
    prisma.$queryRaw<Array<{ period: string; salary: number; stat: number; heads: number }>>`
      SELECT period::text, sum(salary)::float AS salary, sum(employer_stat)::float AS stat, sum(headcount)::int AS heads
      FROM fin_payroll_actuals GROUP BY 1 ORDER BY 1 DESC LIMIT 1
    `,
    prisma.$queryRaw<Array<{ direction: string; total: number }>>`
      SELECT direction, sum(amount)::float AS total FROM "BankStatementLine"
      WHERE "txnDate" >= now() - interval '28 days' AND "isInterCo" = false
      GROUP BY 1
    `,
    prisma.invoice.aggregate({
      _sum: { amount: true },
      _count: { _all: true },
      where: { status: { in: ["PENDING", "INITIATED", "OVERDUE", "PARTIALLY_PAID", "DEPOSIT_PAID"] } },
    }),
  ]);

  const totalCash = accounts.reduce((s, a) => s + a.closing, 0);
  const oldestAsOf = accounts.reduce((min, a) => (a.as_of < min ? a.as_of : min), accounts[0]?.as_of ?? "");
  const staleDays = oldestAsOf ? Math.floor((Date.now() - +new Date(`${oldestAsOf}T00:00:00+08:00`)) / 86_400_000) : null;
  const inflow28 = flows.find((f) => f.direction === "CR")?.total ?? 0;
  const outflow28 = flows.find((f) => f.direction === "DR")?.total ?? 0;
  const pay = payroll[0];

  return {
    accounts: accounts.map((a) => ({ account: a.account, asOf: a.as_of, closing: rm(a.closing) })),
    totalCash: rm(totalCash),
    coverageCaveat: "Only accounts with uploaded statements — confirm this is every company account before treating as total cash.",
    staleWarning: staleDays != null && staleDays > 7 ? `Oldest account statement is ${staleDays} days old — position may be outdated.` : undefined,
    monthlyPayroll: pay
      ? { period: pay.period, salary: rm(pay.salary), employerStatutory: rm(pay.stat), total: rm(pay.salary + pay.stat), headcount: pay.heads }
      : null,
    unpaidSupplierInvoices: {
      count: unpaidAgg._count._all,
      total: rm(Number(unpaidAgg._sum.amount ?? 0)),
      note: "PARTIALLY_PAID invoices count at full amount (remaining balance not tracked).",
    },
    flows28d: {
      inflows: rm(inflow28),
      outflows: rm(outflow28),
      net: rm(inflow28 - outflow28),
      dailyAvgInflow: rm(inflow28 / 28),
      dailyAvgOutflow: rm(outflow28 / 28),
      note: "Excludes inter-company transfers.",
    },
  };
}

// OWNER/ADMIN only
async function unpaidInvoices() {
  const rows = await prisma.invoice.findMany({
    where: { status: { in: ["PENDING", "INITIATED", "OVERDUE", "PARTIALLY_PAID", "DEPOSIT_PAID"] } },
    orderBy: { dueDate: "asc" },
    take: 25,
    select: {
      amount: true,
      status: true,
      dueDate: true,
      invoiceNumber: true,
      supplier: { select: { name: true } },
    },
  });
  const total = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  return {
    unpaid: rows.map((r) => ({
      supplier: r.supplier?.name ?? "?",
      invoice: r.invoiceNumber,
      amount: rm(Number(r.amount ?? 0)),
      status: r.status,
      due: r.dueDate ? r.dueDate.toISOString().slice(0, 10) : null,
    })),
    count: rows.length,
    total: rm(total),
  };
}

// OWNER/ADMIN only — estimate: Malaysia utility template ≈ RM0.07; in-window
// free-form and document sends are free.
async function whatsappCost(days: number) {
  const d = Math.max(1, Math.min(30, Math.round(days || 7)));
  const rows = await prisma.$queryRaw<Array<{ day: string; templates: bigint }>>`
    SELECT ((timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')::date)::text AS day,
           count(*) FILTER (WHERE type = 'template') AS templates
    FROM "WhatsAppMessage"
    WHERE direction = 'outbound' AND timestamp >= now() - (${d} || ' days')::interval
    GROUP BY 1 ORDER BY 1 DESC
  `;
  const perDay = rows.map((r) => ({ day: r.day, templates: Number(r.templates), estCost: rm(Number(r.templates) * 0.07) }));
  const total = perDay.reduce((s, r) => s + r.templates, 0);
  return { perDay, totalTemplates: total, estTotal: rm(total * 0.07), note: "RM0.07/template estimate; free-form replies are free" };
}

// ── Tool registry ─────────────────────────────────────────────────────────────

type ToolSpec = { def: Anthropic.Tool; ownerOnly?: boolean; run: (args: Record<string, unknown>, outletIds: string[] | null) => Promise<unknown> };

const TOOLS: ToolSpec[] = [
  {
    def: {
      name: "today_sales",
      description: "Today's sales (gross RM + transaction count) per outlet.",
      input_schema: { type: "object" as const, properties: {} },
    },
    run: (_a, scope) => todaySales(scope),
  },
  {
    def: {
      name: "checklist_status",
      description: "Today's checklists: completed vs pending, with task, owner and outlet for each pending item.",
      input_schema: { type: "object" as const, properties: {} },
    },
    run: (_a, scope) => checklistStatus(scope),
  },
  {
    def: {
      name: "clock_in_status",
      description: "Today's roster vs actual clock-ins: who is rostered and who has not clocked in.",
      input_schema: { type: "object" as const, properties: {} },
    },
    run: (_a, scope) => clockInStatus(scope),
  },
  {
    def: {
      name: "open_purchase_orders",
      description: "Purchase orders currently in flight (sent/confirmed/awaiting delivery), with supplier, amount and expected delivery.",
      input_schema: { type: "object" as const, properties: {} },
    },
    run: (_a, scope) => openPurchaseOrders(scope),
  },
  {
    def: {
      name: "stock_alerts",
      description: "Items at or below their reorder point (low stock), per outlet.",
      input_schema: { type: "object" as const, properties: {} },
    },
    run: (_a, scope) => stockAlerts(scope),
  },
  {
    def: {
      name: "open_system_reports",
      description: "Open bug/problem reports in the system-report queue (what has been reported and not yet fixed).",
      input_schema: { type: "object" as const, properties: {} },
    },
    run: () => openSystemReports(),
  },
  {
    def: {
      name: "sales_history",
      description:
        "Sales over the last N days — per-day totals (by='day'), per-outlet totals (by='outlet'), or top products by revenue (by='product').",
      input_schema: {
        type: "object" as const,
        properties: {
          days: { type: "number", description: "Days back (default 7, max 93)" },
          by: { type: "string", enum: ["day", "outlet", "product"], description: "Group by day (default), outlet, or product" },
        },
      },
    },
    run: (a, scope) =>
      salesHistory(scope, Number(a.days ?? 7), a.by === "product" ? "product" : a.by === "outlet" ? "outlet" : "day"),
  },
  {
    def: {
      name: "wastage_summary",
      description: "Wastage/breakage/expiry over the last N days: event count, estimated cost, top products.",
      input_schema: {
        type: "object" as const,
        properties: { days: { type: "number", description: "Days back (default 7, max 31)" } },
      },
    },
    run: (a, scope) => wastageSummary(scope, Number(a.days ?? 7)),
  },
  {
    def: {
      name: "cash_position",
      description:
        "The canonical cash picture: latest bank balance per company account (with as-of dates), last month's payroll (salary + employer statutory), unpaid supplier invoices, and 28-day cash in/out run rates. Use for 'do we have enough cash for X' questions.",
      input_schema: { type: "object" as const, properties: {} },
    },
    ownerOnly: true,
    run: () => cashPosition(),
  },
  {
    def: {
      name: "list_tables",
      description: "List all tables in the business database with approximate row counts. Use before writing SQL.",
      input_schema: { type: "object" as const, properties: {} },
    },
    ownerOnly: true,
    run: () => listTables(),
  },
  {
    def: {
      name: "describe_table",
      description: "Column names and types for one table. Use before querying it.",
      input_schema: {
        type: "object" as const,
        properties: { table: { type: "string", description: "Exact table name from list_tables" } },
        required: ["table"],
      },
    },
    ownerOnly: true,
    run: (a) => describeTable(String(a.table ?? "")),
  },
  {
    def: {
      name: "query_database",
      description:
        "Run a read-only SQL SELECT against the business database when no other tool covers the question. Single statement, public schema, auto-capped at 200 rows. Table names are PascalCase and must be double-quoted (e.g. \"SalesTransaction\"). Timestamps are UTC — business day is MYT (UTC+8), so convert with AT TIME ZONE 'Asia/Kuala_Lumpur'. Always aggregate rather than pulling raw rows when possible.",
      input_schema: {
        type: "object" as const,
        properties: { sql: { type: "string", description: "The SELECT (or WITH…SELECT) statement" } },
        required: ["sql"],
      },
    },
    ownerOnly: true,
    run: (a) => queryDatabase(String(a.sql ?? "")),
  },
  {
    def: {
      name: "unpaid_invoices",
      description: "Supplier invoices not yet fully paid, with amounts and due dates. Finance data.",
      input_schema: { type: "object" as const, properties: {} },
    },
    ownerOnly: true,
    run: () => unpaidInvoices(),
  },
  {
    def: {
      name: "whatsapp_cost",
      description: "Estimated WhatsApp messaging spend per day (billable template count × RM0.07).",
      input_schema: {
        type: "object" as const,
        properties: { days: { type: "number", description: "How many days back (default 7, max 30)" } },
      },
    },
    ownerOnly: true,
    run: (a) => whatsappCost(Number(a.days ?? 7)),
  },
  {
    def: {
      name: "file_bug_report",
      description:
        "Call this when the message is a PROBLEM REPORT about the system/app/hardware (something broken, not working, wrong data) rather than a question. Filing is handled outside — just call it.",
      input_schema: { type: "object" as const, properties: {} },
    },
    run: async () => ({ filed: true }),
  },
];

// ── The loop ──────────────────────────────────────────────────────────────────

const SYSTEM = `You are the internal operations assistant for Celsius Coffee (Malaysian specialty coffee chain, outlets: Putrajaya, Shah Alam, Tamarind/IOI, Nilai). You chat with the OWNER and OUTLET MANAGERS over WhatsApp.

Rules:
- Answer questions using the tools. Prefer the purpose-built tools; when none covers the question AND you have the database tools (owner/admin), explore: list_tables → describe_table → query_database. Never invent numbers — if you truly can't get it, say so plainly.
- If the message reports a system problem/bug (something broken or behaving wrongly), call file_bug_report instead of answering.
- Reply in the sender's language (Malay, English, or their mix). Keep it SHORT and chat-friendly: a few lines, *bold* for key numbers, no markdown headers, no tables. Lead with the answer, then 1-2 lines of context. Mention it when a number is an estimate.
- Data is scoped server-side: managers only ever see their own outlet's data. Never mention other outlets' numbers to a manager.
- Be direct and useful, like a sharp ops colleague. No corporate filler.`;

// Managers get the canned tools (4 rounds is plenty); owner/admin may need
// list → describe → query → refine across several angles, so they get real
// exploration room.
const MAX_ROUNDS = 4;
const MAX_ROUNDS_OWNER = 10;

export async function runInternalAssistant(params: {
  reporter: AssistantReporter;
  text: string;
  history: Array<{ direction: string; body: string | null }>;
}): Promise<AssistantOutcome> {
  try {
    const scope = await scopeOutlets(params.reporter);
    const tools = TOOLS.filter((t) => !t.ownerOnly || params.reporter.role !== "MANAGER");
    const toolByName = new Map(tools.map((t) => [t.def.name, t]));

    const historyLines = params.history
      .filter((h) => (h.body ?? "").trim())
      .slice(-10)
      .map((h) => `${h.direction === "inbound" ? params.reporter.name : "Assistant"}: ${(h.body ?? "").slice(0, 300)}`)
      .join("\n");

    const intro = `Sender: ${params.reporter.name} (${params.reporter.role}, scope: ${scope.label}). Today (MYT): ${mytYmd()}.${historyLines ? `\n\nRecent conversation:\n${historyLines}` : ""}\n\nNew message:\n${params.text}`;

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: intro }];
    const maxRounds = params.reporter.role === "MANAGER" ? MAX_ROUNDS : MAX_ROUNDS_OWNER;

    for (let round = 0; round < maxRounds; round++) {
      const res = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        // The data map is identical every call — cache it with the role prompt.
        system: [
          { type: "text", text: SYSTEM },
          { type: "text", text: DATA_MAP, cache_control: { type: "ephemeral" } },
        ],
        tools: tools.map((t) => t.def),
        messages,
      });

      const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (process.env.ASSISTANT_DEBUG) {
        console.log(
          `[assistant:debug] round=${round} stop=${res.stop_reason} tools=${toolUses.map((t) => `${t.name}(${JSON.stringify(t.input).slice(0, 120)})`).join(" | ") || "none"}`,
        );
      }
      if (toolUses.some((t) => t.name === "file_bug_report")) return { kind: "report" };

      if (res.stop_reason !== "tool_use" || toolUses.length === 0) {
        const text = res.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim();
        return text ? { kind: "reply", text } : { kind: "none" };
      }

      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const spec = toolByName.get(tu.name);
        let payload: unknown;
        try {
          payload = spec ? await spec.run((tu.input ?? {}) as Record<string, unknown>, scope.ids) : { error: "unknown tool" };
        } catch (err) {
          payload = { error: err instanceof Error ? err.message : "tool failed" };
        }
        // BigInt-safe: Postgres count()/sum() over raw SQL surfaces as BigInt,
        // which plain JSON.stringify rejects — serialize defensively for EVERY
        // tool so one unmapped column can't kill the whole answer.
        let content: string;
        try {
          content = JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? Number(v) : v));
        } catch (err) {
          content = JSON.stringify({ error: `unserializable tool result: ${err instanceof Error ? err.message : "?"}` });
        }
        if (process.env.ASSISTANT_DEBUG) {
          console.log(`[assistant:debug]   ${tu.name} → ${content.slice(0, 200)}`);
        }
        results.push({ type: "tool_result", tool_use_id: tu.id, content });
      }
      messages.push({ role: "user", content: results });
    }
    console.warn(`[ops-intake:assistant] ran out of rounds (${maxRounds}) without a final answer`);
    return { kind: "none" };
  } catch (err) {
    console.error("[ops-intake:assistant] failed:", err instanceof Error ? err.message : err);
    return { kind: "none" };
  }
}
