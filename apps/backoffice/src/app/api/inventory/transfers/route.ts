import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const outletId = searchParams.get("outletId");

    const where = outletId
      ? { OR: [{ fromOutletId: outletId }, { toOutletId: outletId }] }
      : {};

    const transfers = await prisma.stockTransfer.findMany({
      where,
      include: {
        fromOutlet: true,
        toOutlet: true,
        transferredBy: true,
        approvedBy: true,
        receivedBy: true,
        items: {
          include: {
            product: true,
            productPackage: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const mapped = transfers.map((t) => ({
      id: t.id,
      fromOutlet: t.fromOutlet.name,
      fromOutletId: t.fromOutletId,
      fromOutletCode: t.fromOutlet.code,
      toOutlet: t.toOutlet.name,
      toOutletId: t.toOutletId,
      toOutletCode: t.toOutlet.code,
      status: t.status,
      transferredBy: t.transferredBy.name,
      notes: t.notes,
      createdAt: t.createdAt.toISOString(),
      completedAt: t.completedAt?.toISOString() ?? null,
      approvedBy: t.approvedBy?.name ?? null,
      approvedAt: t.approvedAt?.toISOString() ?? null,
      receivedBy: t.receivedBy?.name ?? null,
      receivedAt: t.receivedAt?.toISOString() ?? null,
      rejectionReason: t.rejectionReason ?? null,
      items: t.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        productPackageId: i.productPackageId ?? null,
        product: i.product.name,
        sku: i.product.sku,
        package: i.productPackage?.packageLabel ?? i.productPackage?.packageName ?? "",
        quantity: Number(i.quantity),
      })),
    }));

    return NextResponse.json(mapped);
  } catch (err) {
    console.error("[transfers GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { fromOutletId, toOutletId, transferredById, notes, items } = body;

    const transfer = await prisma.$transaction(async (tx) => {
      const created = await tx.stockTransfer.create({
        data: {
          fromOutletId,
          toOutletId,
          transferredById,
          status: "DRAFT",
          notes: notes || null,
          items: {
            create: items.map((i: { productId: string; productPackageId?: string; quantity: number }) => ({
              productId: i.productId,
              productPackageId: i.productPackageId || null,
              quantity: i.quantity,
            })),
          },
        },
        include: {
          fromOutlet: true,
          toOutlet: true,
          transferredBy: true,
          items: { include: { product: true, productPackage: true } },
        },
      });

      return created;
    });

    return NextResponse.json(transfer, { status: 201 });
  } catch (err) {
    console.error("[transfers POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
