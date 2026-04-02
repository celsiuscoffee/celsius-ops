import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const orders = await prisma.order.findMany({
    include: {
      branch: true,
      supplier: true,
      createdBy: true,
      approvedBy: true,
      items: {
        include: {
          product: true,
          productPackage: true,
        },
      },
      receivings: {
        include: {
          _count: { select: { items: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const mapped = orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    branch: o.branch.name,
    branchCode: o.branch.code,
    supplier: o.supplier.name,
    supplierPhone: o.supplier.phone ?? "",
    status: o.status,
    totalAmount: Number(o.totalAmount),
    notes: o.notes,
    deliveryDate: o.deliveryDate?.toISOString().split("T")[0] ?? null,
    createdBy: o.createdBy.name,
    approvedBy: o.approvedBy?.name ?? null,
    approvedAt: o.approvedAt?.toISOString() ?? null,
    sentAt: o.sentAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
    items: o.items.map((i) => ({
      id: i.id,
      product: i.product.name,
      sku: i.product.sku,
      package: i.productPackage?.packageLabel ?? i.productPackage?.packageName ?? "",
      quantity: Number(i.quantity),
      unitPrice: Number(i.unitPrice),
      totalPrice: Number(i.totalPrice),
      notes: i.notes,
    })),
    receivingCount: o.receivings.length,
  }));

  return NextResponse.json(mapped);
}
