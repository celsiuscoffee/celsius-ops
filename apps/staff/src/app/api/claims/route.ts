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
      flow = "CLAIM",
      vendorName,
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
      // Flow split — REQUEST = finance pays a one-off vendor directly
      // (staff submits the request, doesn't front the money). CLAIM is
      // the original "I paid, reimburse me" flow.
      flow?: "CLAIM" | "REQUEST";
      vendorName?: string;
    };

    const requestFlow: "CLAIM" | "REQUEST" = flow === "REQUEST" ? "REQUEST" : "CLAIM";

    if (!outletId || !amount || !photos?.length) {
      return NextResponse.json(
        { error: "Missing required fields: outletId, amount, photos" },
        { status: 400 },
      );
    }
    if (requestFlow === "CLAIM" && !claimedById) {
      return NextResponse.json(
        { error: "claimedById required for claim flow" },
        { status: 400 },
      );
    }
    if (requestFlow === "REQUEST" && !vendorName?.trim()) {
      return NextResponse.json(
        { error: "vendorName required for payment request flow" },
        { status: 400 },
      );
    }

    // Payment Request gate — managers only. Reimbursement claims stay
    // open to all staff with `inventory:pay-and-claim`; vendor payment
    // requests commit finance to pay a third-party, so trust bar is
    // higher. Owner/admin/manager can submit REQUEST flow.
    if (
      requestFlow === "REQUEST" &&
      session.role !== "OWNER" &&
      session.role !== "ADMIN" &&
      session.role !== "MANAGER"
    ) {
      return NextResponse.json(
        {
          error:
            "Payment requests require manager role. Ask your outlet manager to submit it.",
        },
        { status: 403 },
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

    // Generate order number: PC-{outletCode}-{count+1}. PAY_AND_CLAIM
    // and PAYMENT_REQUEST share the PC- namespace; count across both
    // to avoid collisions when the user creates one of each.
    const orderCount = await prisma.order.count({
      where: {
        orderType: { in: ["PAY_AND_CLAIM", "PAYMENT_REQUEST"] },
        outletId,
      },
    });
    const orderNumber = `PC-${outlet.code}-${String(orderCount + 1).padStart(4, "0")}`;

    // Generate invoice number: INV-{count+1}
    const invoiceCount = await prisma.invoice.count({
      where: { outletId },
    });
    const invoiceNumber = `INV-${String(invoiceCount + 1).padStart(4, "0")}`;

    const orderType =
      requestFlow === "REQUEST" ? "PAYMENT_REQUEST" : "PAY_AND_CLAIM";
    const invoicePaymentType =
      requestFlow === "REQUEST" ? "SUPPLIER" : "STAFF_CLAIM";

    // Create Order + Invoice in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          orderNumber,
          orderType,
          outletId,
          supplierId: resolvedSupplierId!,
          status: "DRAFT",
          totalAmount: amount,
          notes: fullNotes,
          // REQUEST flow doesn't have a claimant (no one to reimburse) —
          // null is fine here.
          claimedById: requestFlow === "CLAIM" ? claimedById : null,
          createdById: session.id,
          ...(items?.length
            ? {
                items: {
                  create: items.map((i) => ({
                    productId: i.productId,
                    quantity: i.quantity,
                    unitPrice: i.unitPrice,
                    totalPrice: i.quantity * i.unitPrice,
                  })),
                },
              }
            : {}),
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
          paymentType: invoicePaymentType,
          claimedById: requestFlow === "CLAIM" ? claimedById : null,
          issueDate: new Date(purchaseDate),
          photos,
          notes: fullNotes,
          ...(requestFlow === "REQUEST" && vendorName
            ? { vendorName: vendorName.trim() }
            : {}),
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
