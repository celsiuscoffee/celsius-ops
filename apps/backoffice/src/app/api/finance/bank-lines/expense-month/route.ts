// POST /api/finance/bank-lines/expense-month: set or clear the per-line
// expense-month override for accrual P&L recognition.
// Body: { bankLineId, expenseMonth } or bulk { bankLineIds: string[], expenseMonth }
// where expenseMonth is 'YYYY-MM' or null (null clears the override, the line
// falls back to matched invoice month > category shift map > cash month).
//
// The override only moves WHICH MONTH the sourced P&L recognises the expense
// in. The GL journal, Cash Flow statement and bank recon stay cash-dated, so
// no journal re-key is needed (classify re-keys because the category changes
// the ACCOUNT; the expense month changes neither account nor posting date).
// The feed-sync rebuild carries expenseMonth across, so overrides survive the
// 6-hourly rebuild (see bukku-feed-sync.ts).

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logBankLineEvents } from "@/lib/finance/bank-line-events";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 7) : null);

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: { bankLineId?: string; bankLineIds?: string[]; expenseMonth?: string | null } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const ids = body.bankLineIds ?? (body.bankLineId ? [body.bankLineId] : []);
  const expenseMonth = body.expenseMonth ?? null;
  if (!ids.length) return NextResponse.json({ error: "bankLineId(s) required" }, { status: 400 });
  if (ids.length > 200) return NextResponse.json({ error: "Max 200 lines per bulk update" }, { status: 400 });
  if (expenseMonth !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(expenseMonth)) {
    return NextResponse.json({ error: "expenseMonth must be 'YYYY-MM' or null" }, { status: 400 });
  }
  const value = expenseMonth ? new Date(`${expenseMonth}-01T00:00:00.000Z`) : null;

  const lines = await prisma.bankStatementLine.findMany({
    where: { id: { in: ids } },
    select: { id: true, expenseMonth: true },
  });
  if (!lines.length) return NextResponse.json({ error: "Bank lines not found" }, { status: 404 });
  const changed = lines.filter((l) => ymd(l.expenseMonth) !== expenseMonth);

  if (changed.length) {
    await prisma.bankStatementLine.updateMany({
      where: { id: { in: changed.map((l) => l.id) } },
      data: { expenseMonth: value },
    });
    // Audit trail: one event per line with old and new month. Best-effort,
    // the helper never throws.
    await logBankLineEvents(
      changed.map((l) => ({
        lineId: l.id,
        event: "expense_month" as const,
        oldValue: { expenseMonth: ymd(l.expenseMonth) },
        newValue: { expenseMonth },
      })),
      auth.user.name,
    );
  }

  return NextResponse.json({ ok: true, updated: changed.length, expenseMonth });
}
