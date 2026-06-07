// GET /api/finance/bank-ledger?from=YYYY-MM-DD&to=YYYY-MM-DD
// The REAL cash ledger — individual classified bank-statement lines across all
// entities. Powers the /finance Ledger page. Date-windowed server-side (default
// last 6 months); everything else is filtered/sorted client-side.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  // Default window: last 3 months (keeps the payload sane; widen via from/to).
  const defFrom = new Date();
  defFrom.setMonth(defFrom.getMonth() - 3);
  const gte = from ? new Date(`${from}T00:00:00.000Z`) : defFrom;
  const lte = to ? new Date(`${to}T23:59:59.999Z`) : undefined;

  const rows = await prisma.bankStatementLine.findMany({
    where: { txnDate: lte ? { gte, lte } : { gte } },
    select: {
      id: true,
      txnDate: true,
      description: true,
      reference: true,
      amount: true,
      direction: true,
      category: true,
      isInterCo: true,
      classifiedBy: true,
      ruleName: true,
      outlet: { select: { name: true } },
      statement: { select: { accountName: true, statementDate: true } },
    },
    orderBy: [{ txnDate: "desc" }, { id: "desc" }],
    take: 20000,
  });

  return NextResponse.json({
    from: (from ? gte : defFrom).toISOString().slice(0, 10),
    to: to ?? null,
    lines: rows.map((l) => ({
      id: l.id,
      txnDate: l.txnDate.toISOString().slice(0, 10),
      description: l.description,
      reference: l.reference,
      amount: Number(l.amount),
      direction: l.direction, // CR (in) | DR (out)
      category: l.category,   // CashCategory | null
      isInterCo: l.isInterCo,
      classifiedBy: l.classifiedBy,
      ruleName: l.ruleName,
      outlet: l.outlet?.name ?? null,
      account: l.statement?.accountName ?? null,
    })),
  });
}
