// GET /api/finance/gl-source-lines?transactionId=...
//
// The bank statement lines a bank-agent GL journal was posted from, so a
// wrong booking can be fixed from the report that surfaced it. Each line
// carries its category (recategorise via /api/finance/bank-lines/classify,
// which re-keys the journal) and, when AP-matched, the matched invoice
// summary (unmatch via /api/finance/bank-lines/unmatch).

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getFinanceClient } from "@/lib/finance/supabase";
import { matchedInvoiceSummaries } from "@/lib/finance/reports/pnl-sourced-drill";

export const dynamic = "force-dynamic";

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const transactionId = new URL(req.url).searchParams.get("transactionId");
  if (!transactionId) return NextResponse.json({ error: "transactionId required" }, { status: 400 });

  const lines = await prisma.bankStatementLine.findMany({
    where: { glTransactionId: transactionId },
    select: {
      id: true, txnDate: true, description: true, amount: true, direction: true,
      reference: true, category: true, isInterCo: true, classifiedBy: true,
      ruleName: true, apInvoiceId: true,
    },
    orderBy: { txnDate: "asc" },
    take: 500,
  });
  const invById = await matchedInvoiceSummaries(lines.map((l) => l.apInvoiceId));

  // Attachment count per line (bank_line_attachment docs key source_ref to
  // the bank line id), one batched query so the UI can show an indicator.
  const attachCount = new Map<string, number>();
  if (lines.length > 0) {
    const fin = getFinanceClient();
    const { data: docs } = await fin
      .from("fin_documents")
      .select("source_ref")
      .eq("doc_type", "bank_line_attachment")
      .in("source_ref", lines.map((l) => l.id));
    for (const d of docs ?? []) {
      const ref = d.source_ref as string;
      attachCount.set(ref, (attachCount.get(ref) ?? 0) + 1);
    }
  }

  return NextResponse.json({
    transactionId,
    lines: lines.map((l) => ({
      id: l.id,
      txnDate: l.txnDate.toISOString().slice(0, 10),
      description: l.description ?? "(no description)",
      amount: round2(Number(l.amount)),
      direction: l.direction,
      reference: l.reference,
      category: l.category,
      isInterCo: l.isInterCo,
      classifiedBy: l.classifiedBy,
      ruleName: l.ruleName,
      apInvoiceId: l.apInvoiceId,
      matchedInvoice: l.apInvoiceId ? invById.get(l.apInvoiceId) ?? null : null,
      attachments: attachCount.get(l.id) ?? 0,
    })),
  });
}
