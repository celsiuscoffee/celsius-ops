import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkModuleAccess } from "@/lib/check-module-access";

// Stamp Invoice.popSentAt = now() — called by the staff/native app right
// after the Send-POP WhatsApp deeplink opens, so the list can show a
// "POP sent" pill and the unsent-only filter works.
//
// Idempotent: re-tapping Send POP overwrites the timestamp. We don't
// keep a ledger of individual sends (see schema comment).
//
// No body required. Returns the new timestamp so the client can update
// local state without re-fetching.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await checkModuleAccess(req, "inventory:invoices");
  if (!guard.ok) return guard.response;
  const session = guard.session;

  const { id } = await params;

  // Outlet scope — non-managers can only stamp invoices for their own
  // outlet. Mirrors the read-side scope in the list route so a baris
  // can't stamp another outlet's invoice via a crafted request.
  const isManager = ["OWNER", "ADMIN", "MANAGER"].includes(session.role);
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: { id: true, order: { select: { outletId: true } } },
  });
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  if (
    !isManager &&
    invoice.order?.outletId &&
    invoice.order.outletId !== session.outletId
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updated = await prisma.invoice.update({
    where: { id },
    data: { popSentAt: new Date() },
    select: { popSentAt: true },
  });

  return NextResponse.json({
    popSentAt: updated.popSentAt?.toISOString() ?? null,
  });
}
