// POST /api/finance/bank-lines/classify — manually classify bank lines.
// Body: { bankLineId, category } or bulk { bankLineIds: string[], category }
//
// Sets classifiedBy='user' so rule re-runs and feed rebuilds never overwrite
// it (the sync's carry-over preserves user classifications). If a line was
// already posted to the GL under the old category, the WHOLE day-aggregate
// journal is un-stamped so the poster re-keys it — un-stamping only that line
// would leave the old journal over-stated.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CashCategory } from "@prisma/client";
import { learnHintsFromLines } from "@/lib/finance/category-hints";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: { bankLineId?: string; bankLineIds?: string[]; category?: string } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const ids = body.bankLineIds ?? (body.bankLineId ? [body.bankLineId] : []);
  const { category } = body;
  if (!ids.length || !category) return NextResponse.json({ error: "bankLineId(s) and category required" }, { status: 400 });
  if (ids.length > 200) return NextResponse.json({ error: "Max 200 lines per bulk classify" }, { status: 400 });
  if (!(category in CashCategory)) return NextResponse.json({ error: `Unknown category ${category}` }, { status: 400 });

  const lines = await prisma.bankStatementLine.findMany({
    where: { id: { in: ids } },
    select: { id: true, glTransactionId: true, apInvoiceId: true, description: true, direction: true },
  });
  if (!lines.length) return NextResponse.json({ error: "Bank lines not found" }, { status: 404 });
  const matched = lines.filter((l) => l.apInvoiceId).length;
  const writable = lines.filter((l) => !l.apInvoiceId);
  const journalIds = [...new Set(writable.map((l) => l.glTransactionId).filter((x): x is string => !!x))];

  await prisma.$transaction(async (tx) => {
    await tx.bankStatementLine.updateMany({
      where: { id: { in: writable.map((l) => l.id) } },
      data: { category: category as CashCategory, classifiedBy: "user", ruleName: "manual" },
    });
    if (journalIds.length) {
      await tx.bankStatementLine.updateMany({
        where: { glTransactionId: { in: journalIds } },
        data: { glTransactionId: null, glPostedAt: null },
      });
    }
  });
  // Teach the categorizer: this correction becomes a counterparty hint the
  // classifier consults before its keyword rules, so the same payee never
  // needs correcting twice. Failure to learn must not fail the classify.
  let learned = 0;
  try {
    learned = await learnHintsFromLines(writable, category as CashCategory);
  } catch { /* hint learning is best-effort */ }

  return NextResponse.json({
    ok: true,
    classified: writable.length,
    rekeyedJournals: journalIds.length,
    skippedMatched: matched, // AP-matched lines are settlement records — unmatch first
    learnedHints: learned,
  });
}
