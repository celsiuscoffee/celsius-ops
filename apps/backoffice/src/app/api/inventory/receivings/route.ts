import { NextResponse, NextRequest } from "next/server";
import { baseQtyByProduct } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { adjustStockBalance } from "@/lib/stock";
import { getUserFromHeaders } from "@/lib/auth";
import { computeDepositAmount } from "@/lib/inventory/deposit";

export async function GET(req: NextRequest) {
  // Auto-reconcile: fix PO statuses where receivings exist but the order is
  // still "awaiting" (stale rows from before the POST set status itself).
  // Judged PER LINE against the ORIGINAL ordered qty snapshotted on receiving
  // items — OrderItem.quantity is overwritten by the POST reconcile, so the
  // old aggregate compare (sum received vs current quantity) always read
  // "complete" for short POs, and over-receipt on one line could mask a
  // shortage on another.
  try {
    const staleOrders = await prisma.order.findMany({
      where: { status: { in: ["SENT", "APPROVED", "AWAITING_DELIVERY"] } },
      select: { id: true },
    });
    for (const order of staleOrders) {
      const receivings = await prisma.receiving.findMany({
        where: { orderId: order.id },
        select: { items: { select: { productId: true, productPackageId: true, receivedQty: true, orderedQty: true } } },
      });
      if (receivings.length === 0) continue;
      const cumulative = new Map<string, number>();
      const originalOrdered = new Map<string, number>();
      for (const r of receivings) {
        for (const it of r.items) {
          const key = `${it.productId}::${it.productPackageId ?? ""}`;
          cumulative.set(key, (cumulative.get(key) ?? 0) + Number(it.receivedQty));
          if (it.orderedQty != null) {
            originalOrdered.set(key, Math.max(originalOrdered.get(key) ?? 0, Number(it.orderedQty)));
          }
        }
      }
      let stillShort = false;
      for (const [key, cum] of cumulative) {
        const ordered = originalOrdered.get(key);
        if (ordered !== undefined && cum < ordered) {
          stillShort = true;
          break;
        }
      }
      await prisma.order.update({
        where: { id: order.id },
        data: { status: stillShort ? "PARTIALLY_RECEIVED" : "COMPLETED" },
      });
    }
  } catch (err) {
    console.error("[receivings] Auto-reconcile failed:", err);
  }

  const tab = req.nextUrl.searchParams.get("tab") || "recent";
  const search = req.nextUrl.searchParams.get("search") || "";

  const orderId = req.nextUrl.searchParams.get("orderId") || "";

  const where: Record<string, unknown> = {};
  if (orderId) {
    where.orderId = orderId;
  } else if (tab === "recent") {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    where.receivedAt = { gte: thirtyDaysAgo };
  }

  if (search) {
    where.OR = [
      { order: { orderNumber: { contains: search, mode: "insensitive" } } },
      { supplier: { name: { contains: search, mode: "insensitive" } } },
      { outlet: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  const receivings = await prisma.receiving.findMany({
    where,
    take: 100,
    select: {
      id: true,
      orderId: true,
      transferId: true,
      status: true,
      notes: true,
      invoicePhotos: true,
      receivedAt: true,
      order: { select: { orderNumber: true } },
      transfer: { select: { fromOutlet: { select: { name: true } } } },
      outlet: { select: { name: true } },
      supplier: { select: { name: true } },
      receivedBy: { select: { name: true } },
      items: {
        select: {
          id: true,
          orderedQty: true,
          receivedQty: true,
          expiryDate: true,
          discrepancyReason: true,
          product: { select: { name: true, sku: true } },
          productPackage: { select: { packageLabel: true } },
        },
      },
    },
    orderBy: { receivedAt: "desc" },
  });

  const mapped = receivings.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    transferId: r.transferId,
    orderNumber: r.order?.orderNumber ?? (r.transferId ? "Transfer" : "Ad-hoc"),
    outlet: r.outlet.name,
    supplier: r.supplier?.name ?? r.transfer?.fromOutlet?.name ?? "Transfer",
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

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { orderId, transferId, outletId, supplierId, items, notes, status, invoicePhotos } = body;

  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isTransfer = !!transferId;

  // Auto-derive orderedQty from the PO server-side so short-delivery tracking
  // doesn't depend on the client sending it. This is the ONLY surviving record
  // of what was ordered, because the PO-line reconcile below overwrites
  // OrderItem.quantity with the received total. Keyed by product+package.
  const orderedQtyMap = new Map<string, number>();
  // PO package per product — a client that omits productPackageId still books
  // stock in base UOM via the PO line's package (mirrors the staff app route).
  const poPkgMap = new Map<string, string | null>();
  if (orderId) {
    // Receivable from SENT onwards, same guard as the staff route — without it
    // a stale client could "receive" a COMPLETED/CANCELLED PO, overwriting its
    // line quantities/total and flipping its status back.
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
    const RECEIVABLE = ["SENT", "AWAITING_DELIVERY", "PARTIALLY_RECEIVED"];
    if (order && !RECEIVABLE.includes(order.status)) {
      const msg =
        order.status === "COMPLETED" ? "Order already fully received." :
        order.status === "CANCELLED" ? "Order was cancelled and cannot be received." :
        "PO must be Sent to the supplier before goods can be received.";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const poItems = await prisma.orderItem.findMany({
      where: { orderId },
      select: { productId: true, productPackageId: true, quantity: true },
    });
    for (const oi of poItems) {
      orderedQtyMap.set(`${oi.productId}::${oi.productPackageId ?? ""}`, Number(oi.quantity));
      if (!poPkgMap.has(oi.productId)) poPkgMap.set(oi.productId, oi.productPackageId ?? null);
    }
  }
  const resolveOrderedQty = (i: { productId: string; productPackageId?: string; orderedQty?: number }): number | null => {
    if (i.orderedQty !== undefined && i.orderedQty !== null) return i.orderedQty;
    if (!orderId) return null;
    return orderedQtyMap.get(`${i.productId}::${i.productPackageId ?? ""}`) ?? null;
  };

  let receivingStatus = status || "COMPLETE";
  if (orderId) {
    const hasShort = items.some((i: { productId: string; productPackageId?: string; orderedQty?: number; receivedQty: number }) => {
      const ordered = resolveOrderedQty(i);
      return ordered !== null && i.receivedQty < ordered;
    });
    if (hasShort) receivingStatus = "PARTIAL";
  }

  const receiving = await prisma.receiving.create({
    data: {
      orderId: orderId || null,
      transferId: transferId || null,
      outletId,
      supplierId: supplierId || null,
      receivedById: caller.id,
      status: receivingStatus,
      notes: notes || null,
      invoicePhotos: invoicePhotos || [],
      items: {
        create: items.map((i: { productId: string; productPackageId?: string; orderedQty?: number; receivedQty: number; expiryDate?: string; discrepancyReason?: string }) => ({
          productId: i.productId,
          productPackageId: i.productPackageId || null,
          orderedQty: resolveOrderedQty(i),
          receivedQty: i.receivedQty,
          expiryDate: i.expiryDate ? new Date(i.expiryDate) : null,
          discrepancyReason: i.discrepancyReason || null,
        })),
      },
    },
  });

  // Update stock balances. Goods are received in a package unit ("12 bottles"),
  // but StockBalance is tracked in base UOM — multiply each line by its package
  // conversionFactor and increment the canonical per-product row
  // (productPackageId = null), matching stock counts and the staff app.
  const recvPkgIds = [
    ...new Set(
      (items as Array<{ productId: string; productPackageId?: string }>)
        .map((i) => i.productPackageId ?? poPkgMap.get(i.productId) ?? null)
        .filter((id): id is string => id != null),
    ),
  ];
  const cfMap = new Map<string, number>();
  if (recvPkgIds.length > 0) {
    const pkgs = await prisma.productPackage.findMany({
      where: { id: { in: recvPkgIds } },
      select: { id: true, conversionFactor: true },
    });
    for (const p of pkgs) cfMap.set(p.id, Number(p.conversionFactor));
  }
  const baseTotals = baseQtyByProduct(
    (items as Array<{ productId: string; productPackageId?: string; receivedQty: number }>).map((i) => {
      // Fall back to the PO line's package: goods are counted in package units
      // even when the client omits the package id (staff-route parity — factor
      // 1 here used to book "3 cartons" as 3 base units).
      const pkgId = i.productPackageId ?? poPkgMap.get(i.productId) ?? null;
      return {
        productId: i.productId,
        countedQty: i.receivedQty,
        conversionFactor: pkgId ? cfMap.get(pkgId) ?? 1 : 1,
      };
    }),
  );
  await Promise.all(
    [...baseTotals].map(([productId, baseQty]) =>
      adjustStockBalance(outletId, productId, baseQty, null),
    ),
  );

  // PO reconciliation: hard-overwrite each PO line to reflect cumulative
  // receivedQty across all receivings on this PO. This way the PO total
  // matches what the supplier should actually invoice us for — critical
  // for the credit-term flow where the placeholder invoice (and downstream
  // Pending Invoice card) need the real received value, not the original
  // ordered total. Discrepancy is preserved on the receiving rows
  // (orderedQty vs receivedQty).
  if (orderId) {
    const allReceivings = await prisma.receiving.findMany({
      where: { orderId },
      select: {
        items: {
          select: {
            productId: true,
            productPackageId: true,
            receivedQty: true,
            orderedQty: true,
          },
        },
      },
    });
    const cumulativeByLine = new Map<string, number>();
    for (const r of allReceivings) {
      for (const it of r.items) {
        const key = `${it.productId}::${it.productPackageId ?? ""}`;
        cumulativeByLine.set(key, (cumulativeByLine.get(key) ?? 0) + Number(it.receivedQty));
      }
    }

    // Short-delivery detection against the ORIGINAL ordered qty (snapshotted on
    // receiving lines — OrderItem.quantity is overwritten below, so it can't be
    // the reference on follow-up deliveries; take the MAX across receivings).
    const originalOrdered = new Map<string, number>();
    for (const r of allReceivings) {
      for (const it of r.items) {
        if (it.orderedQty == null) continue;
        const key = `${it.productId}::${it.productPackageId ?? ""}`;
        originalOrdered.set(key, Math.max(originalOrdered.get(key) ?? 0, Number(it.orderedQty)));
      }
    }
    let stillShort = false;
    for (const [key, cum] of cumulativeByLine) {
      const ordered = originalOrdered.get(key);
      if (ordered !== undefined && cum < ordered) {
        stillShort = true;
        break;
      }
    }

    const orderItems = await prisma.orderItem.findMany({
      where: { orderId },
      select: { id: true, productId: true, productPackageId: true, unitPrice: true, quantity: true },
    });

    let newTotalAmount = 0;
    for (const oi of orderItems) {
      const key = `${oi.productId}::${oi.productPackageId ?? ""}`;
      const cumReceived = cumulativeByLine.get(key);
      const newQty = cumReceived ?? Number(oi.quantity);
      const lineTotal = newQty * Number(oi.unitPrice);
      newTotalAmount += lineTotal;
      if (cumReceived !== undefined && cumReceived !== Number(oi.quantity)) {
        await prisma.orderItem.update({
          where: { id: oi.id },
          data: { quantity: cumReceived, totalPrice: lineTotal },
        });
      }
    }

    // A short delivery leaves the PO PARTIALLY_RECEIVED (still receivable, still
    // chased by the exec's awaiting-delivery pass) instead of force-completing —
    // force-complete silently swallowed every shortfall. Fully received → COMPLETED.
    // If the supplier won't deliver the balance, procurement closes it on the PO page.
    await prisma.order.update({
      where: { id: orderId },
      data: { totalAmount: newTotalAmount, status: stillShort ? "PARTIALLY_RECEIVED" : "COMPLETED" },
    });
  }

  // Update transfer status to RECEIVED if linked to a transfer
  if (isTransfer) {
    await prisma.stockTransfer.update({
      where: { id: transferId },
      data: {
        status: "RECEIVED",
        receivedById: caller.id,
        receivedAt: new Date(),
        completedAt: new Date(),
      },
    });
  }

  // Attach/create supplier invoice for non-transfer receivings.
  //
  // For an existing PLACEHOLDER (auto-created INV-NNNN with null due date —
  // i.e. supplier hasn't sent the real invoice yet), update its amount to
  // match the freshly-overwritten PO total and append any new photos.
  // For an already-attached invoice (real supplier invoice number, has due
  // date, possibly PAID), don't touch the amount — finance owns that record.
  // For orders with no invoice yet, or ad-hoc receivings, create a new
  // PENDING placeholder.
  if (!isTransfer) {
    try {
      const existingForOrder = orderId
        ? await prisma.invoice.findFirst({
            where: { orderId },
            orderBy: { createdAt: "desc" },
            select: { id: true, invoiceNumber: true, dueDate: true, status: true },
          })
        : null;

      if (existingForOrder) {
        const isPlaceholder =
          existingForOrder.invoiceNumber.startsWith("INV-") &&
          existingForOrder.dueDate == null &&
          existingForOrder.status === "PENDING";

        const updateData: Record<string, unknown> = {};
        if (invoicePhotos && invoicePhotos.length > 0) {
          updateData.photos = { push: invoicePhotos };
        }
        if (isPlaceholder && orderId) {
          // Sync placeholder amount with the freshly-recalculated PO total.
          const o = await prisma.order.findUnique({
            where: { id: orderId },
            select: { totalAmount: true },
          });
          if (o) updateData.amount = o.totalAmount;
        }
        if (Object.keys(updateData).length > 0) {
          await prisma.invoice.update({
            where: { id: existingForOrder.id },
            data: updateData,
          });
        }
      } else {
        const invCount = await prisma.invoice.count();
        const invoiceNumber = `INV-${String(invCount + 1).padStart(4, "0")}`;
        const totalAmount = orderId
          ? (await prisma.order.findUnique({ where: { id: orderId }, select: { totalAmount: true } }))?.totalAmount ?? 0
          : items.reduce((s: number, i: { receivedQty: number; unitPrice?: number }) => s + (i.receivedQty * (i.unitPrice ?? 0)), 0);

        const depositAmount = await computeDepositAmount(supplierId, Number(totalAmount));

        await prisma.invoice.create({
          data: {
            invoiceNumber,
            orderId: orderId || null,
            outletId,
            supplierId: supplierId!,
            amount: totalAmount,
            status: "PENDING",
            photos: invoicePhotos || [],
            notes: notes ? `From receiving: ${notes}` : null,
            ...(depositAmount ? { depositAmount } : {}),
          },
        });
      }
    } catch (err) {
      console.error("[receivings] invoice attach/create failed:", err);
      // Invoice side-effect is non-critical — don't fail the receiving
    }
  }

  return NextResponse.json(receiving, { status: 201 });
}
