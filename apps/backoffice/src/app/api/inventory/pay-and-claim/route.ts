import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { adjustStockBalance } from "@/lib/stock";

export async function GET(req: NextRequest) {
  const tab = req.nextUrl.searchParams.get("tab") || "pending";
  const search = req.nextUrl.searchParams.get("search") || "";

  const outlet = req.nextUrl.searchParams.get("outlet") || "";

  // Show both staff claims (PAY_AND_CLAIM) and direct payment requests (PAYMENT_REQUEST)
  const where: Record<string, unknown> = { orderType: { in: ["PAY_AND_CLAIM", "PAYMENT_REQUEST"] } };

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
      orderType: true,
      expenseCategory: true,
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
        select: {
          id: true, invoiceNumber: true, amount: true, status: true, photos: true,
          vendorName: true, vendorBankName: true, vendorBankAccountNumber: true, vendorBankAccountName: true,
          claimBatchId: true,
          claimBatch: { select: { id: true, batchNumber: true, status: true } },
        },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const mapped = orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    orderType: o.orderType,
    // Flow = REQUEST (finance pays vendor) vs CLAIM (reimburse staff) — derived from orderType
    flow: o.orderType === "PAYMENT_REQUEST" ? "REQUEST" : "CLAIM",
    expenseCategory: o.expenseCategory,
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
          vendorName: o.invoices[0].vendorName ?? null,
          vendorBank: o.invoices[0].vendorBankName ? {
            bankName: o.invoices[0].vendorBankName,
            accountNumber: o.invoices[0].vendorBankAccountNumber ?? null,
            accountName: o.invoices[0].vendorBankAccountName ?? null,
          } : null,
        }
      : null,
  }));

  return NextResponse.json(mapped);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    outletId, claimedById, items, notes, photos, purchaseDate,
    draft, quickUpload, aiExtracted, invoiceNumber: bodyInvoiceNumber,
    // New fields for asset/maintenance/other expense requests:
    expenseCategory,          // "INGREDIENT" (default) | "ASSET" | "MAINTENANCE" | "OTHER"
    flow,                     // "CLAIM" (default) | "REQUEST" — REQUEST = finance pays one-off vendor
    vendorName,               // free-text one-off vendor (no Supplier record)
    vendorBankName,
    vendorBankAccountNumber,
    vendorBankAccountName,
  } = body;
  let { supplierId, amount: bodyAmount } = body;

  const isDraft = draft === true;
  const isQuickUpload = quickUpload === true;
  const category: "INGREDIENT" | "ASSET" | "MAINTENANCE" | "OTHER" = expenseCategory || "INGREDIENT";
  const isIngredient = category === "INGREDIENT";
  const requestFlow: "CLAIM" | "REQUEST" = flow === "REQUEST" ? "REQUEST" : "CLAIM";

  // Auto-assign ad-hoc supplier for ingredient pay & claim if none provided.
  // For non-ingredient (asset/maintenance/other) we leave supplier null and
  // rely on one-off vendor fields instead.
  if (!supplierId && isIngredient) {
    const adhoc = await prisma.supplier.findFirst({ where: { supplierCode: "ADHOC" } });
    if (adhoc) supplierId = adhoc.id;
  }

  // Non-ingredient expenses (asset/maintenance/other) don't need items/supplier —
  // they're a single amount + description + optional vendor details.
  const requiresItems = isIngredient;

  // For non-draft non-quick-upload: require supplier + staff + items (ingredient)
  // or outletId + amount + either claimant (CLAIM) or vendor info (REQUEST) for others.
  if (!isDraft && !isQuickUpload) {
    if (requiresItems) {
      if (!outletId || !supplierId || !claimedById || !items?.length) {
        return NextResponse.json(
          { error: "outletId, supplierId, claimedById, and items are required" },
          { status: 400 },
        );
      }
    } else {
      if (!outletId || !bodyAmount) {
        return NextResponse.json(
          { error: "outletId and amount are required for asset/maintenance/other requests" },
          { status: 400 },
        );
      }
      if (requestFlow === "CLAIM" && !claimedById) {
        return NextResponse.json({ error: "claimedById required for claim flow" }, { status: 400 });
      }
      if (requestFlow === "REQUEST" && !vendorName) {
        return NextResponse.json({ error: "vendorName required for payment request flow" }, { status: 400 });
      }
    }
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

  const itemsTotal = items?.length
    ? items.reduce(
        (sum: number, i: { quantity: number; unitPrice: number }) => sum + i.quantity * i.unitPrice,
        0,
      )
    : 0;
  // Use explicit amount if provided (from quick upload full form), else use items total
  const totalAmount = (bodyAmount && Number(bodyAmount) > 0) ? Number(bodyAmount) : itemsTotal;

  // Store AI-extracted data in notes for draft/quick-upload review
  const orderNotes = (isDraft || isQuickUpload) && aiExtracted
    ? JSON.stringify({ userNotes: notes || null, aiExtracted })
    : notes || null;

  if (isDraft || isQuickUpload) {
    // ── Draft / Quick Upload mode: no receiving, no stock adjustment ──
    const orderStatus = isQuickUpload && !isDraft ? "COMPLETED" : "DRAFT";
    const invoiceStatus = isQuickUpload && !isDraft ? "PENDING" : "DRAFT";
    // Payment type depends on flow: REQUEST pays vendor (SUPPLIER), CLAIM pays staff.
    const invoicePaymentType = requestFlow === "REQUEST" ? "SUPPLIER" : "STAFF_CLAIM";
    const orderType = requestFlow === "REQUEST" ? "PAYMENT_REQUEST" : "PAY_AND_CLAIM";

    const order = await prisma.order.create({
      data: {
        orderNumber,
        orderType,
        expenseCategory: category,
        outletId,
        supplierId: supplierId || null,
        status: orderStatus,
        totalAmount,
        notes: orderNotes,
        deliveryDate: purchaseDate ? new Date(purchaseDate) : new Date(),
        createdById: caller.id,
        // REQUEST flow has no claimant (staff didn't pay); CLAIM flow needs one.
        claimedById: requestFlow === "REQUEST" ? null : (claimedById || caller.id),
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

    // Create invoice — use provided invoice number if given, else auto-generate
    let invoiceNumber = bodyInvoiceNumber?.trim() || null;
    if (!invoiceNumber) {
      const invCount = await prisma.invoice.count();
      invoiceNumber = `INV-${String(invCount + 1).padStart(4, "0")}`;
    }
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        orderId: order.id,
        outletId,
        supplierId: supplierId || null,
        amount: totalAmount,
        status: invoiceStatus,
        paymentType: invoicePaymentType,
        expenseCategory: category,
        claimedById: requestFlow === "REQUEST" ? null : (claimedById || caller.id),
        // Capture one-off vendor on the invoice (used when no Supplier record)
        vendorName: vendorName || null,
        vendorBankName: vendorBankName || null,
        vendorBankAccountNumber: vendorBankAccountNumber || null,
        vendorBankAccountName: vendorBankAccountName || null,
        photos: photos || [],
        issueDate: purchaseDate ? new Date(purchaseDate) : new Date(),
        notes: isDraft
          ? (notes ? `Draft: ${notes}` : `Draft ${category.toLowerCase()} ${requestFlow === "REQUEST" ? "payment request" : "claim"}`)
          : (notes ? `Quick upload: ${notes}` : `Quick upload ${category.toLowerCase()} ${requestFlow === "REQUEST" ? "payment request" : "claim"}`),
      },
    });

    // If quickUpload with items and not draft → also create receiving + stock adjustments
    if (isQuickUpload && !isDraft && items?.length && supplierId) {
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

      await Promise.all(
        items.map((item: { productId: string; productPackageId?: string; quantity: number }) =>
          adjustStockBalance(outletId, item.productId, item.quantity, item.productPackageId),
        ),
      );

      return NextResponse.json(
        {
          order: { id: order.id, orderNumber: order.orderNumber },
          receiving: { id: receiving.id },
          invoice: { id: invoice.id, invoiceNumber },
        },
        { status: 201 },
      );
    }

    return NextResponse.json(
      {
        order: { id: order.id, orderNumber: order.orderNumber },
        invoice: { id: invoice.id, invoiceNumber },
      },
      { status: 201 },
    );
  }

  // ── Non-draft: full flow ──
  // For INGREDIENT: create order + receiving + stock adjust + invoice.
  // For non-ingredient (asset/maintenance/other): create order + invoice only.
  const invoicePaymentType = requestFlow === "REQUEST" ? "SUPPLIER" : "STAFF_CLAIM";
  const orderType = requestFlow === "REQUEST" ? "PAYMENT_REQUEST" : "PAY_AND_CLAIM";

  // 1. Create order (already COMPLETED since purchase is done)
  const order = await prisma.order.create({
    data: {
      orderNumber,
      orderType,
      expenseCategory: category,
      outletId,
      supplierId: supplierId || null,
      status: "COMPLETED",
      totalAmount,
      notes: notes || null,
      deliveryDate: purchaseDate ? new Date(purchaseDate) : new Date(),
      createdById: caller.id,
      claimedById: requestFlow === "REQUEST" ? null : claimedById,
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

  // 2. Receiving + stock adjustment — only for INGREDIENT (non-ingredient has no stock impact)
  let receivingId: string | null = null;
  if (isIngredient && items?.length && supplierId) {
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
    receivingId = receiving.id;

    await Promise.all(
      items.map((item: { productId: string; productPackageId?: string; quantity: number }) =>
        adjustStockBalance(outletId, item.productId, item.quantity, item.productPackageId),
      ),
    );
  }

  // 3. Create invoice
  const invCount = await prisma.invoice.count();
  const invoiceNumber = `INV-${String(invCount + 1).padStart(4, "0")}`;

  const noteLabel = requestFlow === "REQUEST"
    ? `${category.toLowerCase()} payment request`
    : `${category.toLowerCase()} claim`;
  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber,
      orderId: order.id,
      outletId,
      supplierId: supplierId || null,
      amount: totalAmount,
      status: "PENDING",
      paymentType: invoicePaymentType,
      expenseCategory: category,
      claimedById: requestFlow === "REQUEST" ? null : claimedById,
      vendorName: vendorName || null,
      vendorBankName: vendorBankName || null,
      vendorBankAccountNumber: vendorBankAccountNumber || null,
      vendorBankAccountName: vendorBankAccountName || null,
      photos: photos || [],
      notes: notes ? `${noteLabel}: ${notes}` : noteLabel,
    },
  });

  return NextResponse.json(
    {
      order: { id: order.id, orderNumber: order.orderNumber },
      receiving: receivingId ? { id: receivingId } : null,
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
