import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { adjustStockBalance } from "@/lib/stock";

export async function GET(req: NextRequest) {
  const tab = req.nextUrl.searchParams.get("tab") || "pending";
  const search = req.nextUrl.searchParams.get("search") || "";

  const outlet = req.nextUrl.searchParams.get("outlet") || "";

  const where: Record<string, unknown> = { orderType: "PAY_AND_CLAIM" };

  if (tab === "draft") {
    where.status = "DRAFT";
  } else if (tab === "pending") {
    where.status = { not: "DRAFT" };
    where.invoices = { some: { status: { in: ["PENDING", "OVERDUE"] } } };
  } else if (tab === "reimbursed") {
    where.status = { not: "DRAFT" };
    where.invoices = { every: { status: "PAID" } };
  }

  if (outlet) {
    where.outletId = outlet;
  }

  if (search) {
    where.OR = [
      { orderNumber: { contains: search, mode: "insensitive" } },
      { supplier: { name: { contains: search, mode: "insensitive" } } },
      { outlet: { name: { contains: search, mode: "insensitive" } } },
      { claimedBy: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  const orders = await prisma.order.findMany({
    where,
    take: 200,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      totalAmount: true,
      notes: true,
      createdAt: true,
      outlet: { select: { name: true, code: true } },
      supplier: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
      claimedBy: { select: { name: true, bankName: true, bankAccountNumber: true, bankAccountName: true } },
      items: {
        select: {
          id: true,
          productId: true,
          quantity: true,
          unitPrice: true,
          totalPrice: true,
          product: { select: { name: true, sku: true, baseUom: true } },
          productPackage: { select: { packageLabel: true } },
        },
      },
      invoices: {
        select: { id: true, invoiceNumber: true, amount: true, status: true, photos: true },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const mapped = orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    outlet: o.outlet.name,
    outletCode: o.outlet.code,
    supplierId: o.supplier?.id ?? null,
    supplier: o.supplier?.name ?? "Unknown",
    claimedBy: o.claimedBy?.name ?? null,
    claimedByBank: o.claimedBy ? {
      bankName: o.claimedBy.bankName ?? null,
      bankAccountNumber: o.claimedBy.bankAccountNumber ?? null,
      bankAccountName: o.claimedBy.bankAccountName ?? null,
    } : null,
    createdBy: o.createdBy.name,
    totalAmount: Number(o.totalAmount),
    notes: o.notes,
    createdAt: o.createdAt.toISOString(),
    items: o.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      product: i.product.name,
      sku: i.product.sku,
      uom: i.productPackage?.packageLabel ?? i.product.baseUom,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unitPrice),
      totalPrice: Number(i.totalPrice),
    })),
    status: o.status,
    invoice: o.invoices[0]
      ? {
          id: o.invoices[0].id,
          invoiceNumber: o.invoices[0].invoiceNumber,
          amount: Number(o.invoices[0].amount),
          status: o.invoices[0].status,
          photoCount: o.invoices[0].photos.length,
          photos: o.invoices[0].photos,
        }
      : null,
  }));

  return NextResponse.json(mapped);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { outletId, claimedById, items, notes, photos, purchaseDate, draft, quickUpload, aiExtracted } = body;
  let { supplierId } = body;

  const isDraft = draft === true;
  const isQuickUpload = quickUpload === true;

  // Auto-assign ad-hoc supplier for pay & claim if none provided
  if (!supplierId) {
    const adhoc = await prisma.supplier.findFirst({ where: { supplierCode: "ADHOC" } });
    if (adhoc) supplierId = adhoc.id;
  }

  // For non-draft non-quick-upload: require supplier, staff, items
  if (!isDraft && !isQuickUpload && (!outletId || !supplierId || !claimedById || !items?.length)) {
    return NextResponse.json(
      { error: "outletId, supplierId, claimedById, and items are required" },
      { status: 400 },
    );
  }

  // For draft or quick upload: at minimum need outletId
  if ((isDraft || isQuickUpload) && !outletId) {
    return NextResponse.json({ error: "outletId is required" }, { status: 400 });
  }

  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
  // Generate order number with PC- prefix
  const outletRecord = await prisma.outlet.findUniqueOrThrow({ where: { id: outletId } });
  const count = await prisma.order.count({ where: { outletId, orderType: "PAY_AND_CLAIM" } });
  const orderNumber = `PC-${outletRecord.code}-${String(count + 1).padStart(4, "0")}`;

  const totalAmount = items?.length
    ? items.reduce(
        (sum: number, i: { quantity: number; unitPrice: number }) => sum + i.quantity * i.unitPrice,
        0,
      )
    : 0;

  // Store AI-extracted data in notes for draft/quick-upload review
  const orderNotes = (isDraft || isQuickUpload) && aiExtracted
    ? JSON.stringify({ userNotes: notes || null, aiExtracted })
    : notes || null;

  if (isDraft || isQuickUpload) {
    // ── Draft / Quick Upload mode: no receiving, no stock adjustment ──
    const orderStatus = isQuickUpload && !isDraft ? "COMPLETED" : "DRAFT";
    const invoiceStatus = isQuickUpload && !isDraft ? "PENDING" : "DRAFT";

    const order = await prisma.order.create({
      data: {
        orderNumber,
        orderType: "PAY_AND_CLAIM",
        outletId,
        supplierId: supplierId || null,
        status: orderStatus,
        totalAmount,
        notes: orderNotes,
        deliveryDate: purchaseDate ? new Date(purchaseDate) : new Date(),
        createdById: caller.id,
        claimedById: claimedById || caller.id,
        ...(items?.length
          ? {
              items: {
                create: items.map((i: { productId: string; productPackageId?: string; quantity: number; unitPrice: number }) => ({
                  productId: i.productId,
                  productPackageId: i.productPackageId || null,
                  quantity: i.quantity,
                  unitPrice: i.unitPrice,
                  totalPrice: i.quantity * i.unitPrice,
                })),
              },
            }
          : {}),
      },
    });

    // Create invoice
    const invCount = await prisma.invoice.count();
    const invoiceNumber = `INV-${String(invCount + 1).padStart(4, "0")}`;
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        orderId: order.id,
        outletId,
        supplierId: supplierId || null,
        amount: totalAmount,
        status: invoiceStatus,
        paymentType: "STAFF_CLAIM",
        claimedById: claimedById || caller.id,
        photos: photos || [],
        notes: isDraft
          ? (notes ? `Draft claim: ${notes}` : "Draft claim")
          : (notes ? `Quick upload claim: ${notes}` : "Quick upload claim"),
      },
    });

    return NextResponse.json(
      {
        order: { id: order.id, orderNumber: order.orderNumber },
        invoice: { id: invoice.id, invoiceNumber: invoice.invoiceNumber },
      },
      { status: 201 },
    );
  }

  // ── Non-draft: full flow (existing behavior) ──

  // 1. Create order (already COMPLETED since items are in hand)
  const order = await prisma.order.create({
    data: {
      orderNumber,
      orderType: "PAY_AND_CLAIM",
      outletId,
      supplierId,
      status: "COMPLETED",
      totalAmount,
      notes: notes || null,
      deliveryDate: purchaseDate ? new Date(purchaseDate) : new Date(),
      createdById: caller.id,
      claimedById,
      items: {
        create: items.map((i: { productId: string; productPackageId?: string; quantity: number; unitPrice: number }) => ({
          productId: i.productId,
          productPackageId: i.productPackageId || null,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          totalPrice: i.quantity * i.unitPrice,
        })),
      },
    },
  });

  // 2. Create receiving record (stock goes in)
  const receiving = await prisma.receiving.create({
    data: {
      orderId: order.id,
      outletId,
      supplierId,
      receivedById: caller.id,
      status: "COMPLETE",
      notes: notes ? `Pay & Claim: ${notes}` : "Pay & Claim",
      invoicePhotos: photos || [],
      items: {
        create: items.map((i: { productId: string; productPackageId?: string; quantity: number }) => ({
          productId: i.productId,
          productPackageId: i.productPackageId || null,
          orderedQty: i.quantity,
          receivedQty: i.quantity,
        })),
      },
    },
  });

  // 3. Update stock balances — track per package
  await Promise.all(
    items.map((item: { productId: string; productPackageId?: string; quantity: number }) =>
      adjustStockBalance(outletId, item.productId, item.quantity, item.productPackageId),
    ),
  );

  // 4. Create invoice for reimbursement tracking
  const invCount = await prisma.invoice.count();
  const invoiceNumber = `INV-${String(invCount + 1).padStart(4, "0")}`;

  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber,
      orderId: order.id,
      outletId,
      supplierId,
      amount: totalAmount,
      status: "PENDING",
      paymentType: "STAFF_CLAIM",
      claimedById,
      photos: photos || [],
      notes: notes ? `Staff claim: ${notes}` : "Staff claim",
    },
  });

  return NextResponse.json(
    {
      order: { id: order.id, orderNumber: order.orderNumber },
      receiving: { id: receiving.id },
      invoice: { id: invoice.id, invoiceNumber: invoice.invoiceNumber },
    },
    { status: 201 },
  );
  } catch (err) {
    console.error("Pay & Claim POST error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
