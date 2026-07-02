// POST /api/finance/bank-lines/classify — manually classify a bank line.
// Body: { bankLineId, category }
//
// Sets classifiedBy='user' so rule re-runs and feed rebuilds never overwrite
// it (the sync's carry-over preserves user classifications). If the line was
// already posted to the GL under the old category, the WHOLE day-aggregate
// journal is un-stamped so the poster re-keys it — un-stamping only this line
// would leave the old journal over-stated.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CashCategory } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: { bankLineId?: string; category?: string } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const { bankLineId, category } = body;
  if (!bankLineId || !category) return NextResponse.json({ error: "bankLineId and category required" }, { status: 400 });
  if (!(category in CashCategory)) return NextResponse.json({ error: `Unknown category ${category}` }, { status: 400 });

  const line = await prisma.bankStatementLine.findUnique({
    where: { id: bankLineId },
    select: { id: true, category: true, glTransactionId: true, apInvoiceId: true },
  });
  if (!line) return NextResponse.json({ error: "Bank line not found" }, { status: 404 });
  if (line.apInvoiceId) return NextResponse.json({ error: "Line is AP-matched — unmatch it first" }, { status: 409 });

  await prisma.$transaction(async (tx) => {
    await tx.bankStatementLine.update({
      where: { id: bankLineId },
      data: { category: category as CashCategory, classifiedBy: "user", ruleName: "manual" },
    });
    if (line.glTransactionId) {
      await tx.bankStatementLine.updateMany({
        where: { glTransactionId: line.glTransactionId },
        data: { glTransactionId: null, glPostedAt: null },
      });
    }
  });
  return NextResponse.json({ ok: true, rekeyed: !!line.glTransactionId });
}
