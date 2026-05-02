// GET /api/finance/transactions/:id
// Returns a single transaction with its journal lines and source document.
// Used by the detail drawer on /finance/transactions.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getFinanceClient } from "@/lib/finance/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const client = getFinanceClient();

  const [{ data: txn, error: txnErr }, { data: lines, error: linesErr }] = await Promise.all([
    client.from("fin_transactions").select("*").eq("id", id).maybeSingle(),
    client
      .from("fin_journal_lines")
      .select("id, account_code, outlet_id, debit, credit, memo, line_order")
      .eq("transaction_id", id)
      .order("line_order"),
  ]);

  if (txnErr) return NextResponse.json({ error: txnErr.message }, { status: 500 });
  if (linesErr) return NextResponse.json({ error: linesErr.message }, { status: 500 });
  if (!txn) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let document: unknown = null;
  if (txn.source_doc_id) {
    const { data: doc } = await client
      .from("fin_documents")
      .select("id, source, source_ref, doc_type, raw_url, received_at")
      .eq("id", txn.source_doc_id)
      .maybeSingle();
    document = doc;
  }

  // Resolve account names for nicer display.
  const accountCodes = Array.from(new Set((lines ?? []).map((l) => l.account_code)));
  const accountMap = new Map<string, string>();
  if (accountCodes.length) {
    const { data: accounts } = await client
      .from("fin_accounts")
      .select("code, name")
      .in("code", accountCodes);
    for (const a of accounts ?? []) accountMap.set(a.code as string, a.name as string);
  }

  return NextResponse.json({
    transaction: txn,
    lines: (lines ?? []).map((l) => ({
      ...l,
      account_name: accountMap.get(l.account_code as string) ?? null,
    })),
    document,
  });
}
