// POST /api/finance/bank-lines/unmatch — undo a wrong AP match.
//
// Reverses exactly what the match wrote: the line loses its invoice link (and
// re-keys its GL journal); the invoice's payment state is reverted ONLY when
// this match is what marked it paid (paidVia stamps 'bank-ap-match' /
// 'bank-ap-match-multi:<lineId>') — a link-only match against an invoice paid
// via POP/migration leaves that invoice untouched. The pair is recorded as
// rejected so the auto-matcher never re-applies it.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getFinanceClient } from "@/lib/finance/supabase";
import { logBankLineEvents } from "@/lib/finance/bank-line-events";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: { bankLineId?: string } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  if (!body.bankLineId) return NextResponse.json({ error: "bankLineId required" }, { status: 400 });

  const line = await prisma.bankStatementLine.findUnique({
    where: { id: body.bankLineId },
    select: { id: true, apInvoiceId: true, glTransactionId: true },
  });
  if (!line) return NextResponse.json({ error: "Bank line not found" }, { status: 404 });
  if (!line.apInvoiceId) return NextResponse.json({ error: "Line is not matched" }, { status: 409 });
  const invoiceId = line.apInvoiceId;

  // Every invoice this line's match paid: the direct link plus any bundle
  // members stamped with this line id by a multi-match.
  const paidByThisMatch = await prisma.invoice.findMany({
    where: {
      OR: [
        { id: invoiceId, paidVia: "bank-ap-match" },
        { paidVia: `bank-ap-match-multi:${line.id}` },
      ],
    },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.bankStatementLine.update({
      where: { id: line.id },
      data: { apInvoiceId: null, apMatchedAt: null, classifiedBy: "rule", ruleName: "unmatched" },
    });
    if (paidByThisMatch.length) {
      await tx.invoice.updateMany({
        where: { id: { in: paidByThisMatch.map((i) => i.id) } },
        data: { status: "PENDING", amountPaid: 0, paidAt: null, paidVia: null },
      });
    }
    // Re-key the whole day-aggregate journal the line posted under.
    if (line.glTransactionId) {
      await tx.bankStatementLine.updateMany({
        where: { glTransactionId: line.glTransactionId },
        data: { glTransactionId: null, glPostedAt: null },
      });
    }
  });

  // Human verdict is final — the matcher must not redo this pair.
  const client = getFinanceClient();
  await client.from("fin_ap_match_rejections").upsert(
    { bank_line_id: line.id, invoice_id: invoiceId, reason: "unmatched" },
    { onConflict: "bank_line_id,invoice_id" },
  );

  // Audit trail: who unlinked this line from which invoice. Best-effort.
  const inv = await prisma.invoice
    .findUnique({ where: { id: invoiceId }, select: { invoiceNumber: true } })
    .catch(() => null);
  await logBankLineEvents(
    [{
      lineId: line.id,
      event: "unmatch",
      oldValue: { invoiceId, invoiceNumber: inv?.invoiceNumber ?? null },
      newValue: null,
    }],
    auth.user.name,
  );

  return NextResponse.json({
    ok: true,
    invoicesReverted: paidByThisMatch.length, // 0 = link-only; invoice untouched
    rekeyedJournal: !!line.glTransactionId,
  });
}
