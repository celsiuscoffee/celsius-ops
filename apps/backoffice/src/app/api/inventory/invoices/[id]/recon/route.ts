import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

// GET /api/inventory/invoices/[id]/recon
// Returns the data the Attach Supplier Invoice dialog uses to reconcile
// PO-ordered total vs received-at-PO-prices vs the supplier's billed
// amount. Per-line breakdown so procurement can see which items
// contributed to a variance — without forcing line-by-line entry.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(_req);
  if (auth.error) return auth.error;
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: {
      id: true,
      orderId: true,
      amount: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          items: {
            select: {
              id: true,
              productId: true,
              quantity: true,
              unitPrice: true,
              product: { select: { name: true, baseUom: true } },
              productPackage: { select: { packageLabel: true, conversionFactor: true } },
            },
          },
        },
      },
    },
  });
  if (!invoice) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!invoice.order) {
    // Ad-hoc / staff-claim / payment-request invoices have no PO to
    // reconcile against — return empty so the UI can hide the panel.
    return NextResponse.json({ hasOrder: false, lines: [], poTotal: 0, receivedTotal: 0, billedTotal: Number(invoice.amount) });
  }

  // Sum receivedQty per (productId, productPackageId) across every receiving
  // for this order. Multiple receivings happen on partial deliveries.
  const receivings = await prisma.receiving.findMany({
    where: { orderId: invoice.order.id },
    select: {
      items: {
        select: { productId: true, productPackageId: true, receivedQty: true },
      },
    },
  });
  const receivedByLine = new Map<string, number>();
  for (const r of receivings) {
    for (const it of r.items) {
      const key = `${it.productId}::${it.productPackageId ?? ""}`;
      receivedByLine.set(key, (receivedByLine.get(key) ?? 0) + Number(it.receivedQty));
    }
  }

  let poTotal = 0;
  let receivedTotal = 0;
  const lines = invoice.order.items.map((oi) => {
    const ordered = Number(oi.quantity);
    const unitPrice = Number(oi.unitPrice);
    const received = receivedByLine.get(`${oi.productId}::${(oi as { productPackageId?: string | null }).productPackageId ?? ""}`) ?? ordered;
    const orderedTotal = ordered * unitPrice;
    const receivedLineTotal = received * unitPrice;
    poTotal += orderedTotal;
    receivedTotal += receivedLineTotal;
    return {
      productId: oi.productId,
      product: oi.product?.name ?? "—",
      uom: oi.productPackage?.packageLabel ?? oi.product?.baseUom ?? "",
      ordered,
      received,
      unitPrice,
      orderedTotal: Math.round(orderedTotal * 100) / 100,
      receivedLineTotal: Math.round(receivedLineTotal * 100) / 100,
      qtyVariance: Math.round((received - ordered) * 100) / 100,
    };
  });

  return NextResponse.json({
    hasOrder: true,
    orderNumber: invoice.order.orderNumber,
    lines,
    poTotal: Math.round(poTotal * 100) / 100,
    receivedTotal: Math.round(receivedTotal * 100) / 100,
    billedTotal: Number(invoice.amount),
  });
}
