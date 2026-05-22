import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

  try {
    const invoices = await prisma.invoice.findMany({
      where: {
        paymentType: "STAFF_CLAIM",
        claimedById: session.id,
      },
      orderBy: { issueDate: "desc" },
      take: limit,
      select: {
        id: true,
        invoiceNumber: true,
        amount: true,
        status: true,
        issueDate: true,
        photos: true,
        notes: true,
        paidAt: true,
        supplier: { select: { name: true } },
        order: { select: { orderNumber: true } },
      },
    });

    const claims = invoices.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      orderNumber: i.order?.orderNumber ?? null,
      amount: Number(i.amount),
      status: i.status,
      supplierName: i.supplier?.name ?? null,
      issueDate: i.issueDate.toISOString(),
      paidAt: i.paidAt?.toISOString() ?? null,
      photos: i.photos,
      notes: i.notes,
    }));

    return NextResponse.json({ claims });
  } catch (err) {
    console.error("[claims GET]", err);
    const message = err instanceof Error ? err.message : "Failed to list claims";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      outletId,
      supplierId,
      supplierName,
      claimedById,
      amount,
      purchaseDate,
      photos,
      notes,
      items,
    } = body as {
      outletId: string;
      supplierId?: string;
      supplierName?: string;
      claimedById: string;
      amount: number;
      purchaseDate: string;
      photos: string[];
      notes?: string;
      items?: { productId: string; quantity: number; unitPrice: number }[];
    };

    if (!outletId || !claimedById || !amount || !photos?.length) {
      return NextResponse.json(
        { error: "Missing required fields: outletId, claimedById, amount, photos" },
        { status: 400 }
      );
    }

    // Get outlet for code
    const outlet = await prisma.outlet.findUnique({
      where: { id: outletId },
      select: { code: true },
    });

    if (!outlet) {
      return NextResponse.json({ error: "Outlet not found" }, { status: 404 });
    }

    // Resolve supplier — if supplierId provided use it, otherwise try to find by name
    let resolvedSupplierId = supplierId || null;

    if (!resolvedSupplierId && supplierName) {
      const existing = await prisma.supplier.findFirst({
        where: {
          name: { contains: supplierName, mode: "insensitive" },
          status: "ACTIVE",
        },
        select: { id: true },
      });
      if (existing) resolvedSupplierId = existing.id;
    }

    // If still no supplier, use the Ad-hoc Purchase supplier
    if (!resolvedSupplierId) {
      const adhoc = await prisma.supplier.findFirst({
        where: { supplierCode: "ADHOC" },
        select: { id: true },
      });
      if (adhoc) resolvedSupplierId = adhoc.id;
    }

    // Build notes with supplier name if it wasn't matched
    const fullNotes = [
      supplierName && !supplierId ? `Supplier: ${supplierName}` : null,
      notes,
    ]
      .filter(Boolean)
      .join(" | ") || null;

    // Generate order number: PC-{outletCode}-{count+1}
    const orderCount = await prisma.order.count({
      where: { orderType: "PAY_AND_CLAIM", outletId },
    });
    const orderNumber = `PC-${outlet.code}-${String(orderCount + 1).padStart(4, "0")}`;

    // Generate invoice number: INV-{count+1}
    const invoiceCount = await prisma.invoice.count({
      where: { outletId },
    });
    const invoiceNumber = `INV-${String(invoiceCount + 1).padStart(4, "0")}`;

    // Create Order + Invoice in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          orderNumber,
          orderType: "PAY_AND_CLAIM",
          outletId,
          supplierId: resolvedSupplierId!,
          status: "DRAFT",
          totalAmount: amount,
          notes: fullNotes,
          claimedById,
          createdById: session.id,
          ...(items?.length ? {
            items: {
              create: items.map((i) => ({
                productId: i.productId,
                quantity: i.quantity,
                unitPrice: i.unitPrice,
                totalPrice: i.quantity * i.unitPrice,
              })),
            },
          } : {}),
        },
        select: { id: true, orderNumber: true },
      });

      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          orderId: order.id,
          outletId,
          supplierId: resolvedSupplierId!,
          amount,
          status: "DRAFT",
          paymentType: "STAFF_CLAIM",
          claimedById,
          issueDate: new Date(purchaseDate),
          photos,
          notes: fullNotes,
        },
        select: { id: true, invoiceNumber: true },
      });

      return { order, invoice };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[claims POST]", err);
    const message = err instanceof Error ? err.message : "Failed to create claim";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
