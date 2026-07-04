// POST /api/finance/journal-entries/reverse
// Body: { transactionId, date? }
//
// Owner/Admin only. Posts a mirror journal (debits and credits swapped) via
// the shared reverseTransaction mechanics in lib/finance/ledger.ts: the
// counter-journal is dated today (or the given date), the original flips to
// status 'reversed' and is linked via reversed_by_id. Refuses when the target
// is already reversed, is not posted, or the reversal date falls in a closed
// period.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getFinanceClient } from "@/lib/finance/supabase";
import { reverseTransaction } from "@/lib/finance/ledger";
import { isPeriodClosed, periodOf } from "@/lib/finance/periods";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { transactionId?: string; date?: string } = {};
  try { body = (await req.json()) ?? {}; } catch { /* handled below */ }

  const transactionId = body.transactionId?.trim() ?? "";
  if (!transactionId) {
    return NextResponse.json({ error: "transactionId required" }, { status: 400 });
  }
  const date = body.date?.trim() || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const client = getFinanceClient();
  const { data: original, error } = await client
    .from("fin_transactions")
    .select("id, company_id, status")
    .eq("id", transactionId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!original) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  if (original.status === "reversed") {
    return NextResponse.json({ error: "Transaction is already reversed" }, { status: 400 });
  }
  if (original.status !== "posted") {
    return NextResponse.json(
      { error: `Only posted journals can be reversed (status is ${original.status})` },
      { status: 400 }
    );
  }

  if (await isPeriodClosed(original.company_id as string, date)) {
    return NextResponse.json(
      { error: `Period ${periodOf(date)} is closed for this company. Pick an open reversal date.` },
      { status: 400 }
    );
  }

  try {
    const result = await reverseTransaction(transactionId, {
      reason: `manual reversal by ${auth.user.name}`,
      agent: "manual",
      agentVersion: auth.user.name,
      date,
    });
    return NextResponse.json({
      id: result.transactionId,
      reference: result.transactionId,
      reversedId: transactionId,
      amount: result.amount,
      status: result.status,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
