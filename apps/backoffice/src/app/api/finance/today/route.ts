// GET /api/finance/today — the money decisions for Money › Today, READ ONLY:
//   - supplier bills due this week (late ones included), the same "payable"
//     shape the Invoices page uses (no GRNI placeholders, INITIATED left out:
//     that payment is already on its way);
//   - payment requests and staff claims waiting, from the Inbox's own source;
//   - payroll runs worked out and waiting to be confirmed (monthly + weekly).
// Bank lines the matcher was not sure of come from the Bank inbox's own read
// (GET /api/finance/ap-match), not from here.
//
// Nothing here pays, approves or posts (CLAUDE.md hard rule 6): the page links
// each row to the page where it is decided today.

import { NextResponse } from "next/server";
import type { InvoiceStatus } from "@celsius/db";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { mytTodayStr } from "@/lib/inventory/myt-today";
import { INBOX_SOURCES, type InboxContext } from "@/lib/inbox/sources";
import { addDays, amountDue, payrollPeriodKey, sortBills, type BillRow, type MoneyToday, type PayrollRow } from "@/lib/finance/money-today";

export const dynamic = "force-dynamic";

// Owed and not yet on its way. INITIATED (payment started, waiting for the
// proof of payment) and DRAFT are not decisions for today.
const TO_PAY: InvoiceStatus[] = ["PENDING", "OVERDUE", "DEPOSIT_PAID", "PARTIALLY_PAID"];

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  // Money is OWNER/ADMIN only (finance:* in canAccess), like every finance read.
  if (!["OWNER", "ADMIN"].includes(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const today = mytTodayStr();
  const weekEnd = addDays(today, 6);

  const [outlets, users] = await Promise.all([
    prisma.outlet.findMany({ select: { id: true, name: true } }),
    prisma.user.findMany({ select: { id: true, name: true, fullName: true } }),
  ]);
  const outletById = new Map(outlets.map((o) => [o.id, o.name]));
  const userById = new Map(users.map((u) => [u.id, (u.name || u.fullName || "").trim()]));
  const outletName = (id: string | null | undefined) => (id && outletById.get(id)) || "an outlet";

  const loadBills = async (): Promise<BillRow[]> => {
    const rows = await prisma.invoice.findMany({
      where: {
        status: { in: TO_PAY },
        // dueDate is stored as UTC midnight of the Malaysia calendar date
        dueDate: { not: null, lt: new Date(`${addDays(weekEnd, 1)}T00:00:00.000Z`) },
        amount: { gt: 0 },
      },
      select: {
        id: true, invoiceNumber: true, outletId: true, dueDate: true, amount: true, amountPaid: true, status: true,
        vendorName: true, supplier: { select: { name: true } },
      },
      orderBy: { dueDate: "asc" },
      take: 200,
    });
    return sortBills(
      rows
        .map((r) => ({
          id: r.id,
          supplier: r.supplier?.name ?? r.vendorName ?? "Supplier",
          invoiceNumber: r.invoiceNumber,
          outlet: outletName(r.outletId),
          dueDate: r.dueDate!.toISOString().slice(0, 10),
          amountDue: amountDue(Number(r.amount), r.amountPaid == null ? 0 : Number(r.amountPaid)),
          status: r.status,
        }))
        .filter((b) => b.amountDue > 0),
    );
  };

  // The Inbox's "claims" source, as the owner sees it (all outlets).
  const loadClaims = async () => {
    const source = INBOX_SOURCES.find((s) => s.key === "claims");
    if (!source) return [];
    const ctx: InboxContext = {
      user: { id: session.id, name: session.name, role: session.role, outletId: session.outletId, moduleAccess: [] },
      outletIds: null, teamIds: null, now: new Date(),
      outletName,
      userName: (id) => (id && userById.get(id)) || "someone",
    };
    return source.load(ctx);
  };

  const loadPayroll = async (): Promise<PayrollRow[]> => {
    // ai_computed = worked out, waiting to be confirmed (the payroll pages'
    // own "waiting to confirm" rule).
    const { data, error } = await hrSupabaseAdmin
      .from("hr_payroll_runs")
      .select("*")
      .in("cycle_type", ["monthly", "weekly"])
      .eq("status", "ai_computed")
      .limit(20);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: String(r.id),
      cycle: r.cycle_type === "weekly" ? "weekly" : "monthly",
      periodYear: r.period_year ?? null,
      periodMonth: r.period_month ?? null,
      periodStart: r.period_start ?? null,
      periodEnd: r.period_end ?? null,
      net: Number(r.total_net ?? 0),
      gross: Number(r.total_gross ?? 0),
      computedAt: r.updated_at ?? r.created_at ?? null,
    }) satisfies PayrollRow)
      .sort((a, b) => payrollPeriodKey(a).localeCompare(payrollPeriodKey(b)));
  };

  const [bills, claims, payroll] = await Promise.allSettled([loadBills(), loadClaims(), loadPayroll()]);
  const unavailable: string[] = [];
  const pick = <T,>(r: PromiseSettledResult<T[]>, label: string): T[] => {
    if (r.status === "fulfilled") return r.value;
    unavailable.push(label);
    console.error(`[finance/today] ${label} failed`, r.reason);
    return [];
  };

  const body: MoneyToday = {
    today, weekEnd,
    bills: pick(bills, "bills"),
    claims: pick(claims, "payment requests"),
    payroll: pick(payroll, "payroll"),
    unavailable,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
