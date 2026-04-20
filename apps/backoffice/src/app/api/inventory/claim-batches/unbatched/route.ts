import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/inventory/claim-batches/unbatched?staff=<id>&outlet=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns all PAY_CLAIM invoices that are eligible to be batched:
//   - paymentType = PAY_CLAIM
//   - status in (PENDING, INITIATED, DRAFT)
//   - claimBatchId IS NULL
// Grouped by claimedById so the UI can render "one section per staff".
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const staff = searchParams.get("staff");
  const outlet = searchParams.get("outlet");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const where: Record<string, unknown> = {
    paymentType: "PAY_CLAIM",
    claimBatchId: null,
    status: { in: ["PENDING", "INITIATED", "DRAFT"] },
  };
  if (outlet) where.outletId = outlet;
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(from + "T00:00:00Z") } : {}),
      ...(to ? { lte: new Date(to + "T23:59:59Z") } : {}),
    };
  }
  if (staff) {
    where.OR = [
      { claimedById: staff },
      { order: { claimedById: staff } },
    ];
  }

  const invoices = await prisma.invoice.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      invoiceNumber: true,
      amount: true,
      status: true,
      createdAt: true,
      notes: true,
      claimedById: true,
      outlet: { select: { id: true, name: true, code: true } },
      order: {
        select: {
          id: true,
          orderNumber: true,
          notes: true,
          expenseCategory: true,
          claimedById: true,
          claimedBy: { select: { id: true, name: true, fullName: true, bankName: true, bankAccountName: true, bankAccountNumber: true } },
        },
      },
    },
  });

  // Resolve payee (direct claimedById OR order.claimedById) and group.
  const byPayee = new Map<string, { payee: { id: string; name: string | null; fullName: string | null; bankName: string | null; bankAccountName: string | null; bankAccountNumber: string | null } | null; total: number; invoices: typeof invoices }>();
  for (const inv of invoices) {
    const payeeId = inv.claimedById || inv.order?.claimedById;
    if (!payeeId) continue; // skip orphan (no claimant)
    const existing = byPayee.get(payeeId);
    const amountNum = Number(inv.amount);
    if (existing) {
      existing.total += amountNum;
      existing.invoices.push(inv);
    } else {
      byPayee.set(payeeId, {
        payee: inv.order?.claimedBy ?? null,
        total: amountNum,
        invoices: [inv],
      });
    }
  }

  const groups = Array.from(byPayee.entries()).map(([userId, g]) => ({
    userId,
    payee: g.payee,
    total: Math.round(g.total * 100) / 100,
    invoiceCount: g.invoices.length,
    invoices: g.invoices,
  }));
  // Sort: most invoices first
  groups.sort((a, b) => b.invoiceCount - a.invoiceCount);

  return NextResponse.json({ groups });
}
