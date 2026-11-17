// Inbox sources: each reads one existing approval queue (READ ONLY) and turns
// what waits into InboxItems. Each card links to the page where the decision is
// made today, so no approval logic is copied here.
//
// Access: a source runs only when the user may open its decide page (canAccess,
// the same rule as the sidebar), and managers only see their outlets / team
// (lib/hr/scope.ts). Sources are independent: one failing never hides the rest
// (app/api/inbox/route.ts reports it as unavailable).
//
// Deliberately NOT here yet (2026-11-12):
// - agent_prompts (agent questions answered on Telegram; no backoffice page);
// - fin_agent_decisions purchasing-manager findings (always applied=false, no
//   handled state, so every finding ever would show).

import type { InvoiceStatus } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { getFinanceClient } from "@/lib/finance/supabase";
import { activeFlags } from "@/lib/inventory/flag-detector";
import { canAccess, type UserProfile } from "@/lib/nav";
import type { InboxItem, InboxWhen } from "./types";

export type InboxContext = {
  user: UserProfile;            // role + flattened moduleAccess, for canAccess
  outletIds: string[] | null;   // null = all outlets (OWNER/ADMIN)
  teamIds: string[] | null;     // null = everyone; MANAGER = their reporting subtree
  outletName: (id: string | null | undefined) => string;
  userName: (id: string | null | undefined) => string;
  now: Date;
};

export type InboxSource = {
  key: string;
  label: string;        // shown when the source is unavailable ("leave requests")
  moduleKey: string;    // the decide page's grant
  load: (ctx: InboxContext) => Promise<InboxItem[]>;
};

const DAY = 86_400_000;
const num = (v: unknown) => (v == null ? 0 : Number(v));
const daysAgo = (d: Date | string, now: Date) => Math.floor((now.getTime() - new Date(d).getTime()) / DAY);
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const outletWhere = (ctx: InboxContext, field = "outletId") => (ctx.outletIds ? { [field]: { in: ctx.outletIds } } : {});
const dateWords = (iso: string) =>
  new Date(iso + (iso.length === 10 ? "T00:00:00+08:00" : "")).toLocaleDateString("en-GB", {
    timeZone: "Asia/Kuala_Lumpur", weekday: "short", day: "numeric", month: "short",
  });

// Older than `days` → the next band up.
const byAge = (at: Date | string, now: Date, nowDays: number, todayDays: number): InboxWhen =>
  daysAgo(at, now) >= nowDays ? "now" : daysAgo(at, now) >= todayDays ? "today" : "week";

export const INBOX_SOURCES: InboxSource[] = [
  // ── HR ──────────────────────────────────────────────────────────────
  {
    key: "leave", label: "leave requests", moduleKey: "hr:leave",
    async load(ctx) {
      let q = hrSupabaseAdmin
        .from("hr_leave_requests")
        .select("id, user_id, leave_type, start_date, end_date, total_days, reason, ai_reason, created_at")
        .in("status", ["pending", "ai_escalated"])
        .order("start_date", { ascending: true })
        .limit(50);
      if (ctx.teamIds) q = q.in("user_id", ctx.teamIds.length ? ctx.teamIds : ["-"]);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r) => {
        const startsIn = Math.ceil((new Date(r.start_date + "T00:00:00+08:00").getTime() - ctx.now.getTime()) / DAY);
        const when: InboxWhen = startsIn <= 1 ? "now" : startsIn <= 3 ? "today" : startsIn <= 7 ? "week" : "later";
        const type = String(r.leave_type ?? "leave").replace(/_/g, " ");
        return {
          id: `leave:${r.id}`, source: "leave", area: "HR", when,
          title: `${ctx.userName(r.user_id)}: ${type}, ${plural(num(r.total_days), "day")}`,
          from: `Leave request · starts ${dateWords(r.start_date)}`,
          why: [
            `${dateWords(r.start_date)}${r.end_date && r.end_date !== r.start_date ? ` to ${dateWords(r.end_date)}` : ""}`,
            ...(r.reason ? [`Reason: ${r.reason}`] : []),
            ...(r.ai_reason ? [`Flagged: ${r.ai_reason}`] : []),
          ],
          at: r.created_at, href: "/hr/leave", hrefLabel: "Open leave requests",
        } satisfies InboxItem;
      });
    },
  },
  {
    key: "overtime", label: "overtime requests", moduleKey: "hr:overtime",
    async load(ctx) {
      let q = hrSupabaseAdmin
        .from("hr_overtime_requests")
        .select("id, user_id, outlet_id, date, hours_requested, reason, created_at")
        .eq("status", "pending")
        .order("date", { ascending: true })
        .limit(50);
      if (ctx.teamIds) q = q.in("user_id", ctx.teamIds.length ? ctx.teamIds : ["-"]);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: `overtime:${r.id}`, source: "overtime", area: "HR",
        when: byAge(r.created_at, ctx.now, 3, 1),
        title: `${ctx.userName(r.user_id)}: overtime, ${num(r.hours_requested)} h`,
        from: `Overtime · ${ctx.outletName(r.outlet_id)} · ${dateWords(r.date)}`,
        why: r.reason ? [`Reason: ${r.reason}`] : undefined,
        at: r.created_at, href: "/hr/overtime", hrefLabel: "Open overtime",
      }) satisfies InboxItem);
    },
  },
  {
    // Clock-ins needing review are many small items: one card with the count.
    key: "attendance", label: "clock-ins to review", moduleKey: "hr:attendance",
    async load(ctx) {
      let q = hrSupabaseAdmin
        .from("hr_attendance_logs")
        .select("id, clock_in", { count: "exact" })
        .is("final_status", null)
        .neq("clock_in_method", "ot_approval")
        .gte("clock_in", new Date(ctx.now.getTime() - 30 * DAY).toISOString())
        .order("clock_in", { ascending: true })
        .limit(1);
      if (ctx.outletIds) q = q.in("outlet_id", ctx.outletIds.length ? ctx.outletIds : ["-"]);
      const { data, count, error } = await q;
      if (error) throw error;
      if (!count) return [];
      const oldest = data?.[0]?.clock_in as string | undefined;
      return [{
        id: "attendance:queue", source: "attendance", area: "HR",
        when: oldest && daysAgo(oldest, ctx.now) >= 5 ? "now" : "today",
        title: `${plural(count, "clock-in")} to review`,
        from: "Attendance · last 30 days",
        why: [oldest ? `Oldest from ${dateWords(oldest)}` : "", "Approving a day also approves its overtime."].filter(Boolean),
        at: oldest, href: "/hr/attendance", hrefLabel: "Review clock-ins",
      }];
    },
  },
  {
    key: "shift-swaps", label: "shift swaps", moduleKey: "hr:schedules",
    async load(ctx) {
      let q = hrSupabaseAdmin
        .from("hr_shift_swap_requests")
        .select("id, requester_id, target_id, created_at")
        .eq("status", "pending_approval")
        .order("created_at", { ascending: true })
        .limit(50);
      if (ctx.teamIds) q = q.in("requester_id", ctx.teamIds.length ? ctx.teamIds : ["-"]);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: `shift-swap:${r.id}`, source: "shift-swaps", area: "HR",
        when: byAge(r.created_at, ctx.now, 2, 0),
        title: `Shift swap: ${ctx.userName(r.requester_id)} with ${ctx.userName(r.target_id)}`,
        from: "Shift swaps · both agreed, needs your OK",
        at: r.created_at, href: "/hr/shift-swaps", hrefLabel: "Open shift swaps",
      }) satisfies InboxItem);
    },
  },
  {
    key: "pt-rates", label: "pay rate changes", moduleKey: "hr:employees",
    async load(ctx) {
      const { data, error } = await hrSupabaseAdmin
        .from("hr_salary_history")
        .select("id, user_id, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      const rows = ctx.teamIds ? (data ?? []).filter((r) => ctx.teamIds!.includes(r.user_id)) : data ?? [];
      return rows.map((r) => ({
        id: `pt-rate:${r.id}`, source: "pt-rates", area: "HR", when: "week",
        title: `Pay rate change for ${ctx.userName(r.user_id)}`,
        from: "PT rates · needs approval",
        at: r.created_at, href: "/hr/pt-rates", hrefLabel: "Open PT rates",
      }) satisfies InboxItem);
    },
  },

  // ── Procurement ────────────────────────────────────────────────────
  {
    key: "po-approval", label: "purchase orders", moduleKey: "inventory:orders",
    async load(ctx) {
      const rows = await prisma.order.findMany({
        where: { orderType: "PURCHASE_ORDER", status: "PENDING_APPROVAL", ...outletWhere(ctx) },
        select: { id: true, orderNumber: true, outletId: true, totalAmount: true, createdAt: true, deliveryDate: true, createdById: true, supplier: { select: { name: true } } },
        orderBy: { createdAt: "asc" }, take: 50,
      });
      return rows.map((o) => ({
        id: `po:${o.id}`, source: "po-approval", area: "Procurement",
        when: o.deliveryDate && daysAgo(o.deliveryDate, ctx.now) >= -1 ? "now" : byAge(o.createdAt, ctx.now, 2, 0),
        title: `Approve ${o.orderNumber} to ${o.supplier?.name ?? "supplier"}`,
        from: `Purchase order · ${ctx.outletName(o.outletId)} · by ${ctx.userName(o.createdById)}`,
        why: o.deliveryDate ? [`Wanted by ${dateWords(o.deliveryDate.toISOString())}`] : undefined,
        amountRM: num(o.totalAmount), at: o.createdAt.toISOString(),
        href: `/inventory/orders/${o.id}`, hrefLabel: "Open the order",
      }) satisfies InboxItem);
    },
  },
  {
    // Delivered but the supplier's real invoice hasn't been attached: GRNI
    // placeholders older than 5 days. One card with the count and total.
    key: "not-invoiced", label: "deliveries without an invoice", moduleKey: "inventory:invoices",
    async load(ctx) {
      const cutoff = new Date(ctx.now.getTime() - 5 * DAY);
      const where = {
        OR: [{ invoiceNumber: { startsWith: "GRNI-" } }, { invoiceNumber: { startsWith: "INV-" } }, { invoiceNumber: { startsWith: "TRF-" } }],
        dueDate: null, status: "PENDING" as const, orderId: { not: null }, paymentType: "SUPPLIER" as const,
        createdAt: { lt: cutoff }, amount: { gt: 0 }, ...outletWhere(ctx),
      };
      const agg = await prisma.invoice.aggregate({ where, _count: true, _sum: { amount: true }, _min: { createdAt: true } });
      if (!agg._count) return [];
      return [{
        id: "not-invoiced:queue", source: "not-invoiced", area: "Procurement", when: "week",
        title: `${plural(agg._count, "delivery", "deliveries")} still have no supplier invoice`,
        from: "Invoices · delivered more than 5 days ago",
        why: [agg._min.createdAt ? `Oldest from ${dateWords(agg._min.createdAt.toISOString())}` : "", "Attach the real invoice so the books and payments are right."].filter(Boolean),
        amountRM: num(agg._sum.amount), at: agg._min.createdAt?.toISOString(),
        href: "/inventory/invoices", hrefLabel: "Open invoices",
      }];
    },
  },
  {
    key: "invoice-problems", label: "invoice checks", moduleKey: "inventory:invoices",
    async load(ctx) {
      const today = new Date(ctx.now.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" }) + "T00:00:00+08:00");
      // Open supplier bills (GRNI placeholders have no dueDate, so they never count as overdue).
      const openStatuses: InvoiceStatus[] = ["INITIATED", "DEPOSIT_PAID", "PARTIALLY_PAID", "OVERDUE", "PENDING"];
      const open = { status: { in: openStatuses }, ...outletWhere(ctx) };
      const [overdue, flagged] = await Promise.all([
        prisma.invoice.findMany({
          where: { ...open, dueDate: { lt: today }, paymentType: "SUPPLIER" },
          select: { id: true, amount: true, amountPaid: true, dueDate: true },
          take: 500,
        }),
        prisma.invoice.findMany({
          where: { ...open, NOT: { flags: { equals: [] } } },
          select: { id: true, invoiceNumber: true, amount: true, flags: true, outletId: true, createdAt: true, vendorName: true, supplier: { select: { name: true } } },
          orderBy: { createdAt: "desc" }, take: 100,
        }),
      ]);
      const items: InboxItem[] = [];
      if (overdue.length) {
        const owed = overdue.reduce((s, i) => s + num(i.amount) - num(i.amountPaid), 0);
        const oldest = overdue.reduce((m, i) => (i.dueDate && (!m || i.dueDate < m) ? i.dueDate : m), null as Date | null);
        items.push({
          id: "invoice:overdue", source: "invoice-problems", area: "Procurement", when: "now",
          title: `${plural(overdue.length, "supplier invoice")} past due`,
          from: "Invoices · overdue",
          why: [oldest ? `Oldest was due ${dateWords(oldest.toISOString())}` : ""].filter(Boolean),
          amountRM: Math.round(owed * 100) / 100, at: oldest?.toISOString(),
          href: "/inventory/invoices", hrefLabel: "Open overdue invoices",
        });
      }
      for (const inv of flagged) {
        const flags = activeFlags(inv.flags);
        if (!flags.length) continue;
        items.push({
          id: `invoice-flag:${inv.id}`, source: "invoice-problems", area: "Procurement", when: "today",
          title: `${inv.invoiceNumber} from ${inv.supplier?.name ?? inv.vendorName ?? "supplier"} needs a check`,
          from: `Invoice check · ${ctx.outletName(inv.outletId)}`,
          why: flags.slice(0, 3).map((f) => f.message || f.code.replace(/_/g, " ").toLowerCase()),
          amountRM: num(inv.amount), at: inv.createdAt.toISOString(),
          href: "/inventory/reconciliation", hrefLabel: "Open invoice match",
        });
      }
      return items;
    },
  },
  {
    key: "claims", label: "payment requests", moduleKey: "inventory:pay-and-claim",
    async load(ctx) {
      const rows = await prisma.order.findMany({
        where: { orderType: { in: ["PAY_AND_CLAIM", "PAYMENT_REQUEST"] }, status: { in: ["DRAFT", "PENDING_APPROVAL"] }, ...outletWhere(ctx) },
        select: { id: true, orderNumber: true, outletId: true, totalAmount: true, createdAt: true, claimedById: true, createdById: true, expenseCategory: true, notes: true },
        orderBy: { createdAt: "asc" }, take: 50,
      });
      return rows.map((o) => ({
        id: `claim:${o.id}`, source: "claims", area: "Procurement",
        when: byAge(o.createdAt, ctx.now, 5, 2),
        title: `${o.orderNumber}: ${ctx.userName(o.claimedById ?? o.createdById)} asks to be paid`,
        from: `Payment request · ${ctx.outletName(o.outletId)}`,
        why: [String(o.expenseCategory).toLowerCase(), ...(o.notes ? [o.notes] : [])],
        amountRM: num(o.totalAmount), at: o.createdAt.toISOString(),
        href: "/inventory/pay-and-claim", hrefLabel: "Open payment requests",
      }) satisfies InboxItem);
    },
  },

  // ── Stock ──────────────────────────────────────────────────────────
  {
    key: "transfers", label: "stock transfers", moduleKey: "inventory:transfers",
    async load(ctx) {
      const scope = ctx.outletIds ? { OR: [{ fromOutletId: { in: ctx.outletIds } }, { toOutletId: { in: ctx.outletIds } }] } : {};
      const rows = await prisma.stockTransfer.findMany({
        where: {
          AND: [scope, {
            OR: [
              { status: "PENDING_APPROVAL" },
              { status: { in: ["PENDING", "APPROVED", "IN_TRANSIT"] }, createdAt: { lt: new Date(ctx.now.getTime() - DAY) } },
            ],
          }],
        },
        select: { id: true, status: true, fromOutletId: true, toOutletId: true, createdAt: true, transferredById: true },
        orderBy: { createdAt: "asc" }, take: 50,
      });
      return rows.map((t) => {
        const approve = t.status === "PENDING_APPROVAL";
        return {
          id: `transfer:${t.id}`, source: "transfers", area: "Stock",
          when: approve ? "today" : byAge(t.createdAt, ctx.now, 3, 1),
          title: approve
            ? `Approve a transfer from ${ctx.outletName(t.fromOutletId)} to ${ctx.outletName(t.toOutletId)}`
            : `${ctx.outletName(t.toOutletId)} hasn't received a transfer from ${ctx.outletName(t.fromOutletId)}`,
          from: `Transfer · sent by ${ctx.userName(t.transferredById)} · ${dateWords(t.createdAt.toISOString())}`,
          why: approve ? undefined : ["Stock moves to the receiving outlet only once it is marked received."],
          at: t.createdAt.toISOString(), href: "/inventory/transfers", hrefLabel: "Open transfers",
        } satisfies InboxItem;
      });
    },
  },

  // ── Customers ──────────────────────────────────────────────────────
  {
    key: "review-replies", label: "review replies", moduleKey: "reviews:list",
    async load(ctx) {
      const rows = await prisma.reviewReplyDraft.findMany({
        where: { status: "pending", ...outletWhere(ctx) },
        select: { id: true, outletId: true, reviewerName: true, rating: true, comment: true, createdAt: true },
        orderBy: { createdAt: "asc" }, take: 50,
      });
      return rows.map((r) => ({
        id: `review:${r.id}`, source: "review-replies", area: "Customers",
        when: r.rating <= 2 ? "now" : "today",
        title: `${r.rating}-star Google review from ${r.reviewerName ?? "a customer"}: reply drafted`,
        from: `Reviews · ${ctx.outletName(r.outletId)}`,
        why: [r.comment ? `“${r.comment.slice(0, 160)}${r.comment.length > 160 ? "…" : ""}”` : "No comment left", "The reply is posted only when you send it."],
        at: r.createdAt.toISOString(), href: "/reviews/feedback", hrefLabel: "Open the reply",
      }) satisfies InboxItem);
    },
  },
  {
    key: "qr-feedback", label: "customer feedback", moduleKey: "reviews:list",
    async load(ctx) {
      const rows = await prisma.internalFeedback.findMany({
        where: { status: "open", rating: { lte: 3 }, ...outletWhere(ctx) },
        select: { id: true, outletId: true, name: true, rating: true, feedback: true, createdAt: true },
        orderBy: { createdAt: "asc" }, take: 50,
      });
      return rows.map((f) => ({
        id: `feedback:${f.id}`, source: "qr-feedback", area: "Customers",
        when: f.rating <= 2 ? "now" : "today",
        title: `${f.rating}-star feedback from ${f.name ?? "a customer"}`,
        from: `Feedback · ${ctx.outletName(f.outletId)}`,
        why: f.feedback ? [`“${f.feedback.slice(0, 160)}${f.feedback.length > 160 ? "…" : ""}”`] : undefined,
        at: f.createdAt.toISOString(), href: "/reviews/feedback", hrefLabel: "Make it right",
      }) satisfies InboxItem);
    },
  },

  // ── Finance (OWNER/ADMIN: finance:* in canAccess) ──────────────────
  {
    key: "finance-exceptions", label: "finance exceptions", moduleKey: "finance:transactions",
    async load() {
      const { data, error } = await getFinanceClient()
        .from("fin_exceptions")
        .select("id, type, agent, reason, priority, created_at")
        .eq("status", "open")
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      const when: Record<string, InboxWhen> = { urgent: "now", high: "today", normal: "week", low: "later" };
      return (data ?? []).map((e) => ({
        id: `fin-exception:${e.id}`, source: "finance-exceptions", area: "Finance",
        when: when[e.priority as string] ?? "week",
        title: String(e.reason ?? e.type ?? "Finance exception").slice(0, 140),
        from: `Finance · ${String(e.agent ?? "check").replace(/[_-]/g, " ")}`,
        at: e.created_at, href: "/finance", hrefLabel: "Open finance",
      }) satisfies InboxItem);
    },
  },
];

// Sources this user may see (same rule as the sidebar).
export function sourcesFor(user: UserProfile): InboxSource[] {
  return INBOX_SOURCES.filter((s) => canAccess(user, s.moduleKey));
}
