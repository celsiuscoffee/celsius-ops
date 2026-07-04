// POST /api/finance/journal-entries
// Manual journal entry (the QuickBooks/Xero adjusting-entry screen).
// Body: { companyId, date (YYYY-MM-DD), memo, lines: [{ accountCode, debit, credit, outletId? }] }
//
// Owner/Admin only. Validates shape, balance and the period lock, then posts
// through the shared ledger engine with agent 'manual'. The acting user's name
// is stored in agent_version (fin_transactions has no created_by or metadata
// column; agent_version is the provenance field the list and detail views
// already surface, and fin_set_actor stamps "manual-{name}" into the audit log).

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getFinanceClient } from "@/lib/finance/supabase";
import { postJournal } from "@/lib/finance/ledger";
import { isPeriodClosed, periodOf } from "@/lib/finance/periods";
import type { JournalLineInput } from "@/lib/finance/types";

export const dynamic = "force-dynamic";

type LineBody = { accountCode?: string; debit?: number; credit?: number; outletId?: string | null };
type Body = { companyId?: string; date?: string; memo?: string; lines?: LineBody[] };

const round2 = (n: number) => Math.round(n * 100) / 100;
const cents = (n: number) => Math.round(n * 100);

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Body = {};
  try { body = (await req.json()) ?? {}; } catch { /* handled below */ }

  const companyId = body.companyId?.trim() ?? "";
  const date = body.date?.trim() ?? "";
  const memo = body.memo?.trim() ?? "";
  const lines = Array.isArray(body.lines) ? body.lines : [];

  if (!companyId) return NextResponse.json({ error: "companyId required" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  if (!memo) return NextResponse.json({ error: "memo required" }, { status: 400 });
  if (lines.length < 2) {
    return NextResponse.json({ error: "At least 2 lines required" }, { status: 400 });
  }

  // Per-line: exactly one of debit/credit, positive, rounded to cents.
  let totalDebit = 0;
  let totalCredit = 0;
  const cleanLines: JournalLineInput[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const accountCode = l.accountCode?.trim() ?? "";
    if (!accountCode) {
      return NextResponse.json({ error: `Line ${i + 1}: account required` }, { status: 400 });
    }
    const debit = round2(Number(l.debit ?? 0));
    const credit = round2(Number(l.credit ?? 0));
    if (Number.isNaN(debit) || Number.isNaN(credit) || debit < 0 || credit < 0) {
      return NextResponse.json({ error: `Line ${i + 1}: amounts must be positive numbers` }, { status: 400 });
    }
    if ((debit > 0) === (credit > 0)) {
      return NextResponse.json(
        { error: `Line ${i + 1}: enter exactly one of debit or credit` },
        { status: 400 }
      );
    }
    totalDebit += debit;
    totalCredit += credit;
    cleanLines.push({
      accountCode,
      debit,
      credit,
      outletId: l.outletId || null,
    });
  }
  if (cents(totalDebit) !== cents(totalCredit)) {
    return NextResponse.json(
      {
        error: `Out of balance: debit ${totalDebit.toFixed(2)} vs credit ${totalCredit.toFixed(2)}`,
      },
      { status: 400 }
    );
  }

  const client = getFinanceClient();

  // Company must exist and be active.
  const { data: company } = await client
    .from("fin_companies")
    .select("id")
    .eq("id", companyId)
    .eq("is_active", true)
    .maybeSingle();
  if (!company) {
    return NextResponse.json({ error: `Unknown or inactive company ${companyId}` }, { status: 400 });
  }

  // All accounts must exist and be active.
  const codes = Array.from(new Set(cleanLines.map((l) => l.accountCode)));
  const { data: accounts, error: acctErr } = await client
    .from("fin_accounts")
    .select("code, is_active")
    .in("code", codes);
  if (acctErr) return NextResponse.json({ error: acctErr.message }, { status: 500 });
  const found = new Map((accounts ?? []).map((a) => [a.code as string, !!a.is_active]));
  for (const code of codes) {
    if (!found.has(code)) {
      return NextResponse.json({ error: `Account ${code} does not exist` }, { status: 400 });
    }
    if (!found.get(code)) {
      return NextResponse.json({ error: `Account ${code} is inactive` }, { status: 400 });
    }
  }

  // Period lock. The DB trigger enforces this too; this check is for a clean 400.
  if (await isPeriodClosed(companyId, date)) {
    return NextResponse.json(
      { error: `Period ${periodOf(date)} is closed for this company. Reopen it before posting.` },
      { status: 400 }
    );
  }

  try {
    const result = await postJournal({
      companyId,
      txnDate: date,
      description: memo,
      txnType: "journal",
      agent: "manual",
      agentVersion: auth.user.name,
      confidence: 1.0,
      lines: cleanLines,
    });
    return NextResponse.json({
      id: result.transactionId,
      reference: result.transactionId,
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
