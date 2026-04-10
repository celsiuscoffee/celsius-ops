import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

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
    } = body as {
      outletId: string;
      supplierId?: string;
      supplierName?: string;
      claimedById: string;
      amount: number;
      purchaseDate: string;
      photos: string[];
      notes?: string;
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

    // If still no supplier, create a placeholder or use a "MISC" supplier
    if (!resolvedSupplierId) {
      // Try to find a MISC/Other supplier first
      let miscSupplier = await prisma.supplier.findFirst({
        where: { name: { in: ["MISC", "Other", "Cash Purchase"] } },
        select: { id: true },
      });

      if (!miscSupplier) {
        miscSupplier = await prisma.supplier.create({
          data: { name: "Cash Purchase", status: "ACTIVE" },
          select: { id: true },
        });
      }

      resolvedSupplierId = miscSupplier.id;
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
