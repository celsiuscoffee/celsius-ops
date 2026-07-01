import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { markInvoicePaidWithPop } from "@/lib/inventory/mark-invoice-paid";

export const dynamic = "force-dynamic";

// POST /api/inventory/pending-pops/[id]/confirm   body: { invoiceId }
// A human confirms which candidate invoice an ambiguous POP settles → mark it paid + attach the
// POP + close the pending record. Mirrors the Telegram "tap to pick" resolution; the money-write
// is the shared, atomic markInvoicePaidWithPop.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const invoiceId = typeof body.invoiceId === "string" ? body.invoiceId : "";
  if (!invoiceId) return NextResponse.json({ error: "invoiceId is required" }, { status: 400 });

  const pop = await prisma.pendingPop.findUnique({ where: { id } });
  if (!pop) return NextResponse.json({ error: "POP not found" }, { status: 404 });
  if (pop.status !== "OPEN") {
    return NextResponse.json({ error: `This POP was already ${pop.status.toLowerCase()}.` }, { status: 409 });
  }
  if (!pop.candidateInvoiceIds.includes(invoiceId)) {
    return NextResponse.json({ error: "That invoice is not a candidate for this POP." }, { status: 400 });
  }

  const result = await markInvoicePaidWithPop(invoiceId, {
    photoUrl: pop.photoUrl,
    paymentRef: pop.referenceNumber,
    paidVia: "Maybank Transfer",
  });

  // Invoice genuinely missing → do NOT close the pending record; surface the error.
  if (!result.ok && !result.alreadyPaid) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  // Paid now OR already settled by another path → either way this POP no longer needs a human
  // pick, so close it (clears the badge on every candidate invoice).
  await prisma.pendingPop.update({
    where: { id },
    data: { status: "RESOLVED", resolvedInvoiceId: invoiceId, resolvedById: caller.id, resolvedAt: new Date() },
  });

  return NextResponse.json({ ok: true, invoiceId, alreadyPaid: result.alreadyPaid });
}

// DELETE /api/inventory/pending-pops/[id]/confirm  → "none of these" — dismiss without paying.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const pop = await prisma.pendingPop.findUnique({ where: { id }, select: { status: true } });
  if (!pop) return NextResponse.json({ error: "POP not found" }, { status: 404 });
  if (pop.status !== "OPEN") {
    return NextResponse.json({ error: `This POP was already ${pop.status.toLowerCase()}.` }, { status: 409 });
  }
  await prisma.pendingPop.update({
    where: { id },
    data: { status: "DISMISSED", resolvedById: caller.id, resolvedAt: new Date() },
  });
  return NextResponse.json({ ok: true, dismissed: true });
}
