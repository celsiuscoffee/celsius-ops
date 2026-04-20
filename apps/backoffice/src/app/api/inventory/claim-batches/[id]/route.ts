import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/inventory/claim-batches/[id]
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const batch = await prisma.hrClaimBatch.findUnique({
    where: { id },
    include: {
      invoices: {
        select: {
          id: true, invoiceNumber: true, amount: true, status: true, notes: true,
          outlet: { select: { id: true, name: true, code: true } },
          order: { select: { id: true, orderNumber: true, expenseCategory: true, notes: true } },
        },
      },
    },
  });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

  const payee = await prisma.user.findUnique({
    where: { id: batch.userId },
    select: { id: true, name: true, fullName: true, bankName: true, bankAccountName: true, bankAccountNumber: true },
  });

  return NextResponse.json({ batch: { ...batch, payee } });
}

// PATCH /api/inventory/claim-batches/[id]
// Body: { action: "pay" | "cancel", paymentRef?, paidVia? }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const { action, paymentRef, paidVia } = body as {
    action: "pay" | "cancel";
    paymentRef?: string;
    paidVia?: string;
  };

  const batch = await prisma.hrClaimBatch.findUnique({ where: { id } });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

  if (action === "pay") {
    if (batch.status !== "OPEN") {
      return NextResponse.json({ error: `Batch is already ${batch.status}` }, { status: 409 });
    }
    if (!paymentRef) {
      return NextResponse.json({ error: "paymentRef required" }, { status: 400 });
    }
    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.hrClaimBatch.update({
        where: { id },
        data: {
          status: "PAID",
          paymentRef,
          paidAt: now,
          paidById: session.id,
          paidVia: paidVia || "bank_transfer",
        },
      });
      await tx.invoice.updateMany({
        where: { claimBatchId: id },
        data: { status: "PAID", paidAt: now, paidVia: paidVia || "bank_transfer", paymentRef },
      });
      return b;
    });
    return NextResponse.json({ batch: updated });
  }

  if (action === "cancel") {
    if (batch.status === "PAID") {
      return NextResponse.json({ error: "Cannot cancel a paid batch" }, { status: 409 });
    }
    // Unlink invoices first (back to PENDING), then mark batch CANCELLED
    await prisma.$transaction(async (tx) => {
      await tx.invoice.updateMany({
        where: { claimBatchId: id },
        data: { claimBatchId: null, status: "PENDING" },
      });
      await tx.hrClaimBatch.update({
        where: { id },
        data: { status: "CANCELLED" },
      });
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
