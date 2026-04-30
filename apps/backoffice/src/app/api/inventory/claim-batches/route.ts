import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/inventory/claim-batches?status=OPEN|PAID|all
// Returns all batches ordered newest-first, with payee + counts + total.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || "all";

  const where: { status?: string } = {};
  if (status !== "all") where.status = status;

  const batches = await prisma.hrClaimBatch.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      invoices: {
        select: {
          id: true,
          invoiceNumber: true,
          amount: true,
          status: true,
          outlet: { select: { id: true, name: true, code: true } },
        },
      },
    },
  });

  // Enrich with payee user (bank + name)
  const userIds = Array.from(new Set(batches.map((b) => b.userId)));
  const users = userIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, fullName: true, bankName: true, bankAccountName: true, bankAccountNumber: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  const enriched = batches.map((b) => ({
    ...b,
    payee: userMap.get(b.userId) || null,
    invoiceCount: b.invoices.length,
    outletCodes: Array.from(new Set(b.invoices.map((i) => i.outlet?.code).filter(Boolean))),
  }));

  return NextResponse.json({ batches: enriched });
}

// POST /api/inventory/claim-batches
// Body: { invoiceIds: string[], notes?: string }
// All invoices must share the same claimedById, must be PENDING/INITIATED, and
// must not already be in another batch.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { invoiceIds, notes } = body as { invoiceIds: string[]; notes?: string };

  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
    return NextResponse.json({ error: "invoiceIds required" }, { status: 400 });
  }

  // Load candidate invoices with ownership info
  const invoices = await prisma.invoice.findMany({
    where: { id: { in: invoiceIds } },
    select: {
      id: true, invoiceNumber: true, amount: true, status: true,
      outletId: true,
      claimBatchId: true, claimedById: true,
      order: { select: { claimedById: true } },
    },
  });

  if (invoices.length !== invoiceIds.length) {
    return NextResponse.json({ error: "One or more invoices not found" }, { status: 404 });
  }

  // Validation
  const resolvePayee = (inv: typeof invoices[number]) => inv.claimedById || inv.order?.claimedById || null;
  const payeeIds = Array.from(new Set(invoices.map(resolvePayee).filter(Boolean))) as string[];
  if (payeeIds.length !== 1) {
    return NextResponse.json(
      { error: "All invoices must belong to the same staff payee (one batch = one transfer)" },
      { status: 400 },
    );
  }
  const payeeId = payeeIds[0];

  // All invoices must share one outlet — Finance reimburses outlet-by-outlet
  const outletIds = Array.from(new Set(invoices.map((i) => i.outletId).filter(Boolean)));
  if (outletIds.length !== 1) {
    return NextResponse.json(
      { error: "All invoices must belong to the same outlet" },
      { status: 400 },
    );
  }

  const already = invoices.filter((i) => i.claimBatchId);
  if (already.length > 0) {
    return NextResponse.json(
      { error: `${already.length} invoice(s) already belong to another batch` },
      { status: 409 },
    );
  }

  const bad = invoices.filter((i) => !["PENDING", "INITIATED", "DRAFT"].includes(i.status));
  if (bad.length > 0) {
    return NextResponse.json(
      { error: `${bad.length} invoice(s) are already paid or in a non-batchable status` },
      { status: 409 },
    );
  }

  const total = invoices.reduce((s, i) => s + Number(i.amount), 0);

  // Build a human-readable batch number. Format: BC-YYMMDD-NNN where NNN increments per day.
  const today = new Date();
  const prefix = `BC-${today.getUTCFullYear().toString().slice(2)}${String(today.getUTCMonth() + 1).padStart(2, "0")}${String(today.getUTCDate()).padStart(2, "0")}`;
  const countToday = await prisma.hrClaimBatch.count({
    where: { batchNumber: { startsWith: prefix } },
  });
  const batchNumber = `${prefix}-${String(countToday + 1).padStart(3, "0")}`;

  // Atomic create + link
  const batch = await prisma.$transaction(async (tx) => {
    const b = await tx.hrClaimBatch.create({
      data: {
        batchNumber,
        userId: payeeId,
        totalAmount: total,
        status: "OPEN",
        notes: notes || null,
      },
    });
    await tx.invoice.updateMany({
      where: { id: { in: invoiceIds } },
      data: { claimBatchId: b.id, status: "INITIATED" },
    });
    return b;
  });

  return NextResponse.json({ batch }, { status: 201 });
}
