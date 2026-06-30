// GET /api/finance/ap-match?sinceDays=90 — the cash-out reconciliation state
// for the finance-loop monitor. Read-only (proposes matches; nothing written).

import { NextRequest, NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth";
import { proposeApMatches } from "@/lib/finance/ap-match";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try { await requireRole(req.headers, "ADMIN"); }
  catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Auth error" }, { status: 500 });
  }
  const sinceDays = Number(req.nextUrl.searchParams.get("sinceDays") ?? 90);
  try {
    const result = await proposeApMatches({ sinceDays: Number.isFinite(sinceDays) ? sinceDays : 90 });
    const summary = {
      auto: result.auto.length,
      review: result.review.length,
      doublePayments: result.doublePayments.length,
      unmatchedInvoices: result.unmatchedInvoices.length,
      unmatchedOutflows: result.unmatchedOutflows.length,
      unmatchedOutflowValue: Math.round(result.unmatchedOutflows.reduce((s, o) => s + o.amount, 0)),
    };
    return NextResponse.json({ summary, ...result });
  } catch (err) {
    console.error("[finance/ap-match]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "AP match failed" }, { status: 500 });
  }
}
