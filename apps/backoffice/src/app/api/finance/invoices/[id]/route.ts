// GET /api/finance/invoices/[id]
//
// Invoice detail for the finance P&L drill. A PROC drill row is a procurement
// invoice; clicking it lazy-loads this endpoint to show the invoice header,
// its line items (from the linked purchase order) and the payment(s) that
// settled it. Read-only, Owner/Admin only.
//
// Payment resolution: an invoice is paid from the bank side via
// BankStatementLine.apInvoiceId = invoice.id (one or more DR lines, stamped
// apMatchedAt when matched). Some invoices were marked paid out of band (a POP
// upload or the pre-bank-feed migration) with paidAt/paidVia/paymentRef set but
// no bank line; we surface that honestly rather than pretending it is unpaid.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const round2 = (n: number) => Math.round(n * 100) / 100;
const dayOf = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: {
      id: true,
      invoiceNumber: true,
      issueDate: true,
      dueDate: true,
      amount: true,
      amountPaid: true,
      status: true,
      vendorName: true,
      notes: true,
      paidAt: true,
      paidVia: true,
      paymentRef: true,
      supplier: { select: { name: true } },
      outlet: { select: { name: true } },
      // Line items live on the linked purchase order (OrderItem). Stock-transfer
      // invoices and header-only imports have no order, so lines can be empty.
      order: {
        select: {
          orderNumber: true,
          deliveryCharge: true,
          items: {
            select: {
              id: true,
              quantity: true,
              unitPrice: true,
              totalPrice: true,
              product: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Bank payment side: DR bank lines matched to this invoice via apInvoiceId.
  const bankLines = await prisma.bankStatementLine.findMany({
    where: { apInvoiceId: id },
    select: {
      id: true,
      txnDate: true,
      description: true,
      reference: true,
      amount: true,
      apMatchedAt: true,
      statement: { select: { accountName: true } },
    },
    orderBy: { txnDate: "asc" },
  });

  const lines = (invoice.order?.items ?? []).map((it) => ({
    id: it.id,
    description: it.product?.name ?? "(unnamed product)",
    quantity: round2(Number(it.quantity)),
    unitPrice: round2(Number(it.unitPrice)),
    lineTotal: round2(Number(it.totalPrice)),
  }));

  const payments = bankLines.map((l) => ({
    id: l.id,
    txnDate: dayOf(l.txnDate),
    description: l.description || "(no description)",
    reference: l.reference,
    amount: round2(Number(l.amount)),
    account: l.statement?.accountName ?? null,
    matchedAt: dayOf(l.apMatchedAt),
  }));

  const amount = round2(Number(invoice.amount));
  const amountPaid = round2(Number(invoice.amountPaid ?? 0));

  return NextResponse.json({
    invoice: {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      issueDate: dayOf(invoice.issueDate),
      dueDate: dayOf(invoice.dueDate),
      amount,
      amountPaid,
      status: invoice.status,
      vendor: invoice.supplier?.name ?? invoice.vendorName ?? null,
      outlet: invoice.outlet?.name ?? null,
      orderNumber: invoice.order?.orderNumber ?? null,
      deliveryCharge: invoice.order ? round2(Number(invoice.order.deliveryCharge)) : 0,
      notes: invoice.notes ?? null,
      // Out-of-band paid state (POP / migration) when there is no bank line.
      paidAt: dayOf(invoice.paidAt),
      paidVia: invoice.paidVia ?? null,
      paymentRef: invoice.paymentRef ?? null,
    },
    lines,
    payments,
  });
}
