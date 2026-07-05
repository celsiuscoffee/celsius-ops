// GET /api/finance/ap-match?sinceDays=90 — the reconciliation state for the
// finance-loop monitor: cash-OUT (AP matches + unmatched outflows) AND
// cash-IN (settlement summary + unmatched inflows). Read-only.

import { NextRequest, NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { proposeApMatches } from "@/lib/finance/ap-match";
import { cashInRecon } from "@/lib/finance/sales-recon";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try { await requireRole(req.headers, "ADMIN"); }
  catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Auth error" }, { status: 500 });
  }
  const sinceDaysRaw = Number(req.nextUrl.searchParams.get("sinceDays") ?? 90);
  const sinceDays = Number.isFinite(sinceDaysRaw) ? sinceDaysRaw : 90;
  try {
    const [result, cashIn, inflowLines] = await Promise.all([
      proposeApMatches({ sinceDays }),
      cashInRecon({ sinceDays }),
      // Unreconciled cash-IN: money that arrived with no recognised source —
      // the mirror of the outflow pile, categorised the same way.
      prisma.bankStatementLine.findMany({
        where: {
          direction: "CR",
          txnDate: { gte: new Date(Date.now() - sinceDays * 86400_000) },
          OR: [{ category: null }, { category: "OTHER_INFLOW" }],
        },
        select: { id: true, description: true, txnDate: true, amount: true, category: true, expenseMonth: true },
        orderBy: { amount: "desc" },
        take: 300,
      }),
    ]);
    const unmatchedInflows = inflowLines.map((l) => ({
      bankLineId: l.id,
      desc: (l.description ?? "").replace(/\s+/g, " ").slice(0, 60),
      date: l.txnDate.toISOString().slice(0, 10),
      amount: Math.round(Number(l.amount) * 100) / 100,
      category: l.category as string | null,
      expenseMonth: l.expenseMonth ? l.expenseMonth.toISOString().slice(0, 7) : null,
    }));
    const summary = {
      auto: result.auto.length,
      review: result.review.length,
      doublePayments: result.doublePayments.length,
      unmatchedInvoices: result.unmatchedInvoices.length,
      unmatchedOutflows: result.unmatchedOutflows.length,
      unmatchedOutflowValue: Math.round(result.unmatchedOutflows.reduce((s, o) => s + o.amount, 0)),
      unmatchedInflows: unmatchedInflows.length,
      unmatchedInflowValue: Math.round(unmatchedInflows.reduce((s, o) => s + o.amount, 0)),
    };
    return NextResponse.json({ summary, ...result, unmatchedInflows, cashIn });
  } catch (err) {
    console.error("[finance/ap-match]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "AP match failed" }, { status: 500 });
  }
}
