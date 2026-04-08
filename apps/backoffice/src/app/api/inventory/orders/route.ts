import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const tab = req.nextUrl.searchParams.get("tab") || "active";
  const search = req.nextUrl.searchParams.get("search") || "";

  const ACTIVE_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "AWAITING_DELIVERY", "PARTIALLY_RECEIVED"];
  const COMPLETED_STATUSES = ["COMPLETED", "CANCELLED"];

  const where: Record<string, unknown> = {};
  if (tab === "active") where.status = { in: ACTIVE_STATUSES };
  else if (tab === "completed") where.status = { in: COMPLETED_STATUSES };

  if (search) {
    where.OR = [
      { orderNumber: { contains: search, mode: "insensitive" } },
      { supplier: { name: { contains: search, mode: "insensitive" } } },
      { outlet: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  const orders = await prisma.order.findMany({
    where,
    take: 100,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      totalAmount: true,
      notes: true,
      deliveryDate: true,
      sentAt: true,
      approvedAt: true,
      createdAt: true,
      outlet: { select: { name: true, code: true } },
      supplier: { select: { id: true, name: true, phone: true } },
      createdBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      items: {
        select: {
          id: true,
          productId: true,
          quantity: true,
          unitPrice: true,
          totalPrice: true,
          notes: true,
          product: { select: { name: true, sku: true, shelfLifeDays: true, baseUom: true } },
          productPackage: { select: { packageLabel: true, packageName: true } },
        },
      },
      invoices: {
        select: { id: true, invoiceNumber: true, amount: true, status: true, dueDate: true, photos: true },
        orderBy: { createdAt: "desc" as const },
        take: 1,
      },
      _count: { select: { receivings: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const mapped = orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    outlet: o.outlet.name,
    outletCode: o.outlet.code,
    supplierId: o.supplier.id,
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
      productId: i.productId,
      product: i.product.name,
      sku: i.product.sku,
      uom: i.productPackage?.packageLabel ?? i.product.baseUom,
      shelfLifeDays: i.product.shelfLifeDays,
      package: i.productPackage?.packageLabel ?? i.productPackage?.packageName ?? "",
      quantity: Number(i.quantity),
      unitPrice: Number(i.unitPrice),
      totalPrice: Number(i.totalPrice),
      notes: i.notes,
    })),
    receivingCount: o._count.receivings,
    invoice: o.invoices[0]
      ? {
          id: o.invoices[0].id,
          invoiceNumber: o.invoices[0].invoiceNumber,
          amount: Number(o.invoices[0].amount),
          status: o.invoices[0].status,
          dueDate: o.invoices[0].dueDate?.toISOString().split("T")[0] ?? null,
          photoCount: o.invoices[0].photos.length,
        }
      : null,
  }));

  return NextResponse.json(mapped);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { outletId, supplierId, items, notes, deliveryDate } = body;

  const outlet = await prisma.outlet.findUniqueOrThrow({ where: { id: outletId } });
  const count = await prisma.order.count({ where: { outletId } });
  const orderNumber = `CC-${outlet.code}-${String(count + 1).padStart(4, "0")}`;

  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const totalAmount = items.reduce(
    (sum: number, i: { quantity: number; unitPrice: number }) => sum + i.quantity * i.unitPrice,
    0,
  );

  const order = await prisma.order.create({
    data: {
      orderNumber,
      outletId,
      supplierId,
      status: "DRAFT",
      totalAmount,
      notes: notes || null,
      deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
      createdById: caller.id,
      items: {
        create: items.map((i: { productId: string; productPackageId?: string; quantity: number; unitPrice: number; notes?: string }) => ({
          productId: i.productId,
          productPackageId: i.productPackageId || null,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          totalPrice: i.quantity * i.unitPrice,
          notes: i.notes || null,
        })),
      },
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      totalAmount: true,
      outlet: { select: { name: true } },
      supplier: { select: { name: true } },
      items: {
        select: {
          product: { select: { name: true } },
          productPackage: { select: { packageLabel: true } },
          quantity: true,
          unitPrice: true,
          totalPrice: true,
        },
      },
    },
  });

  return NextResponse.json(order, { status: 201 });
}
