import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const receivings = await prisma.receiving.findMany({
    include: {
      order: true,
      branch: true,
      supplier: true,
      receivedBy: true,
      items: {
        include: {
          product: true,
          productPackage: true,
        },
      },
    },
    orderBy: { receivedAt: "desc" },
  });

  const mapped = receivings.map((r) => ({
    id: r.id,
    orderNumber: r.order?.orderNumber ?? "Ad-hoc",
    branch: r.branch.name,
    supplier: r.supplier.name,
    receivedBy: r.receivedBy.name,
    receivedAt: r.receivedAt.toISOString(),
    status: r.status,
    notes: r.notes,
    photoCount: r.invoicePhotos.length,
    items: r.items.map((i) => ({
      id: i.id,
      product: i.product.name,
      sku: i.product.sku,
      package: i.productPackage?.packageLabel ?? "",
      orderedQty: i.orderedQty ? Number(i.orderedQty) : null,
      receivedQty: Number(i.receivedQty),
      expiryDate: i.expiryDate?.toISOString().split("T")[0] ?? null,
      discrepancyReason: i.discrepancyReason,
    })),
  }));

  return NextResponse.json(mapped);
}
