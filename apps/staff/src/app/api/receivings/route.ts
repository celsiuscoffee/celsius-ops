import { NextResponse, NextRequest } from "next/server";
import { resolveReceiptPackages } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { adjustStockBalance } from "@/lib/stock";
import { getSession } from "@/lib/auth";
import { checkModuleAccess } from "@/lib/check-module-access";
import { logActivity } from "@/lib/activity-log";
import { aiPrefillInvoice } from "@/lib/ai-prefill";

export async function GET(req: NextRequest) {
  const session = await getSession();
  // This route sits behind no middleware auth gate (middleware exempts
  // /api/*), so the session check IS the boundary. Without it, an
  // unauthenticated GET fell through to `where = {}` and returned every
  // outlet's receiving history (suppliers, quantities, receiver names).
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);
  const offset = Number(searchParams.get("offset")) || 0;

  // Managers/owner/admin may target any outlet via ?outletId; everyone else
  // is pinned to their own assigned outlet regardless of the query param.
  const isManager = ["OWNER", "ADMIN", "MANAGER"].includes(session.role);
  const requestedOutletId = searchParams.get("outletId");
  const outletId = isManager
    ? requestedOutletId || session.outletId || null
    : session.outletId || null;

  // A non-manager with no assigned outlet sees nothing (never all outlets).
  const where = outletId
    ? { outletId }
    : isManager
      ? {}
      : { outletId: "__none__" };

  const [receivings, total] = await Promise.all([
    prisma.receiving.findMany({
      where,
      select: {
        id: true,
        orderId: true,
        status: true,
        notes: true,
        invoicePhotos: true,
        receivedAt: true,
        order: { select: { orderNumber: true } },
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
      take: limit,
      skip: offset,
    }),
    prisma.receiving.count({ where }),
  ]);

  const mapped = receivings.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    orderNumber: r.order?.orderNumber ?? "Ad-hoc",
    outlet: r.outlet.name,
    supplier: r.supplier?.name ?? "Unknown",
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

  return NextResponse.json({ data: mapped, total, limit, offset });
}

export async function POST(req: NextRequest) {
  // DB-backed RBAC (revocation-safe), mirroring the sibling PO routes
  // (apps/staff/src/app/api/orders/route.ts). Recording a receiving
  // requires the `inventory:receivings` module key, not just any logged-in
  // session. The outlet-ownership check below still applies on top.
  const guard = await checkModuleAccess(req, "inventory:receivings");
  if (!guard.ok) return guard.response;
  const session = guard.session;

  const body = await req.json();
  const { orderId, outletId, supplierId, items, notes, status, invoicePhotos } = body;

  // Staff/managers may only record receivings for their own outlet.
  const isAdmin = session.role === "OWNER" || session.role === "ADMIN";
  if (!isAdmin && outletId !== session.outletId) {
    return NextResponse.json({ error: "Cannot record receiving for another outlet" }, { status: 403 });
  }

  // PO ordered quantities by product+package, used to backfill orderedQty.
  const orderedQtyMap = new Map<string, number>();
  // PO package per product — receivings are counted in the PO's package unit,
  // so we use this to convert receivedQty to base UOM before touching stock.
  const poPkgMap = new Map<string, string | null>();
  const resolveOrderedQty = (i: { productId: string; productPackageId?: string; orderedQty?: number }): number | null => {
    if (i.orderedQty !== undefined && i.orderedQty !== null) return i.orderedQty;
    if (!orderId) return null;
    return orderedQtyMap.get(`${i.productId}::${i.productPackageId ?? ""}`) ?? null;
  };

  let receivingStatus = status || "COMPLETE";
  if (orderId) {
    // Receivable from SENT onwards — procurement must have transmitted the PO
    // to the supplier before goods would be in transit. Credit-term suppliers
    // can still deliver days/weeks before the invoice arrives, so we don't
    // require an attached invoice at receive time.
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    const RECEIVABLE = ["SENT", "AWAITING_DELIVERY", "PARTIALLY_RECEIVED"];
    if (order && !RECEIVABLE.includes(order.status)) {
      const msg =
        order.status === "COMPLETED" ? "Order already fully received." :
        order.status === "CANCELLED" ? "Order was cancelled and cannot be received." :
        "PO must be Sent to the supplier before goods can be received. Ask procurement to send it first.";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    // Auto-derive orderedQty from the PO server-side (the client may omit it),
    // so short-delivery tracking survives even though the PO reconcile below
    // overwrites OrderItem.quantity with the received total.
    const poItems = await prisma.orderItem.findMany({
      where: { orderId },
      select: { productId: true, productPackageId: true, quantity: true },
    });
    for (const oi of poItems) {
      orderedQtyMap.set(`${oi.productId}::${oi.productPackageId ?? ""}`, Number(oi.quantity));
      if (!poPkgMap.has(oi.productId)) poPkgMap.set(oi.productId, oi.productPackageId ?? null);
    }

    const hasShort = items.some((i: { productId: string; productPackageId?: string; orderedQty?: number; receivedQty: number }) => {
      const ordered = resolveOrderedQty(i);
      return ordered !== null && i.receivedQty < ordered;
    });
    if (hasShort) receivingStatus = "PARTIAL";
  }

  // Resolve every line to a package BEFORE writing anything. A missing package
  // used to fall through to factor 1 — "5 cartons" of milk booked as 5 ml — and
  // that silent guess accounted for 23% of receipts since June. Determined cases
  // (explicit choice, PO line, sole package, product with no packages at all)
  // resolve; only a genuinely ambiguous line is refused.
  const recvLines = (items as Array<{ productId: string; productPackageId?: string }>).map((i) => ({
    productId: i.productId,
    productPackageId: i.productPackageId ?? null,
  }));
  const pkgOptions = await prisma.productPackage.findMany({
    where: { productId: { in: [...new Set(recvLines.map((l) => l.productId))] } },
    select: { id: true, productId: true, packageLabel: true, conversionFactor: true },
  });
  const productNames = new Map(
    (
      await prisma.product.findMany({
        where: { id: { in: [...new Set(recvLines.map((l) => l.productId))] } },
        select: { id: true, name: true },
      })
    ).map((p) => [p.id, p.name]),
  );
  const resolution = resolveReceiptPackages(recvLines, {
    packages: pkgOptions.map((p) => ({ ...p, conversionFactor: Number(p.conversionFactor) })),
    poPackageByProduct: poPkgMap,
    productNames,
  });
  if (!resolution.ok) {
    return NextResponse.json(
      {
        error: "Choose a package for every item before receiving.",
        details: resolution.errors.map((e) => e.message),
      },
      { status: 400 },
    );
  }
  const resolved = resolution.resolved;

  const receiving = await prisma.receiving.create({
    data: {
      orderId: orderId || null,
      outletId,
      supplierId,
      receivedById: session.id,
      status: receivingStatus,
      notes: notes || null,
      invoicePhotos: invoicePhotos || [],
      items: {
        create: items.map((i: { productId: string; productPackageId?: string; orderedQty?: number; receivedQty: number; expiryDate?: string; discrepancyReason?: string }, idx: number) => ({
          productId: i.productId,
          // Persist the RESOLVED package. The row historically stored only the
          // client's explicit value, which left 71% of ReceivingItems
          // unconvertible for costing (finance-warehouse check 21) — and left
          // receiving and counting denominated differently, so no stock
          // reconciliation could ever tie out.
          productPackageId: resolved[idx].productPackageId,
          orderedQty: resolveOrderedQty(i),
          receivedQty: i.receivedQty,
          expiryDate: i.expiryDate ? new Date(i.expiryDate) : null,
          discrepancyReason: i.discrepancyReason || null,
        })),
      },
    },
  });

  // Update stock balances. Goods are received in a package unit ("12 bottles"),
  // but StockBalance is tracked in base UOM, so multiply each line by the
  // factor resolved above before incrementing the canonical per-product row
  // (productPackageId = null) — same rule as stock counts. Reusing `resolved`
  // rather than re-deriving keeps the stored row and the balance in step.
  const baseTotals = new Map<string, number>();
  (items as Array<{ productId: string; receivedQty: number }>).forEach((i, idx) => {
    const qty = Number(i.receivedQty);
    if (!Number.isFinite(qty)) return;
    const base = qty * resolved[idx].conversionFactor;
    baseTotals.set(i.productId, (baseTotals.get(i.productId) ?? 0) + base);
  });
  await Promise.all(
    [...baseTotals].map(([productId, baseQty]) =>
      adjustStockBalance(outletId, productId, baseQty, null),
    ),
  );

  // PO reconciliation: hard-overwrite each PO line to reflect cumulative
  // receivedQty so the PO total matches what the supplier should bill us.
  // Discrepancy is preserved on receiving rows (orderedQty vs receivedQty).
  if (orderId) {
    const allReceivings = await prisma.receiving.findMany({
      where: { orderId },
      select: {
        items: {
          select: { productId: true, productPackageId: true, receivedQty: true, orderedQty: true },
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

    // Is anything still short across ALL deliveries so far? Judged against the
    // ORIGINAL ordered qty snapshotted on each receiving line — OrderItem.quantity
    // is overwritten below, so on a follow-up delivery it no longer holds the
    // original target (take the MAX across receivings: the first one saw the
    // pre-overwrite PO). Lines never touched by any receiving keep the legacy
    // assumption (recorded-complete), same as the per-request hasShort check.
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

    // A short delivery must NOT close the PO: PARTIALLY_RECEIVED keeps it
    // receivable for the balance, keeps it in the exec's awaiting-delivery /
    // overdue-GRN chase, and tells procurement the shortfall exists. It used to
    // force-complete here, which silently swallowed every short delivery. If the
    // supplier won't deliver the balance, procurement closes it from the PO page.
    await prisma.order.update({
      where: { id: orderId },
      data: { totalAmount: newTotalAmount, status: stillShort ? "PARTIALLY_RECEIVED" : "COMPLETED" },
    });

    // Placeholder invoice (GRNI). Staff app needs this so the supplier
    // invoice can be attached later via backoffice. If a placeholder
    // already exists for this order, update its amount to match the
    // freshly-overwritten PO total. Don't touch a real (non-placeholder)
    // invoice — finance owns those.
    try {
      const existing = await prisma.invoice.findFirst({
        where: { orderId },
        orderBy: { createdAt: "desc" },
        select: { id: true, invoiceNumber: true, dueDate: true, status: true },
      });

      let placeholderInvoiceId: string | null = null;
      if (existing) {
        const isPlaceholder =
          existing.invoiceNumber.startsWith("INV-") &&
          existing.dueDate == null &&
          existing.status === "PENDING";
        const updateData: Record<string, unknown> = {};
        if (invoicePhotos && invoicePhotos.length > 0) {
          updateData.photos = { push: invoicePhotos };
        }
        if (isPlaceholder) updateData.amount = newTotalAmount;
        if (Object.keys(updateData).length > 0) {
          await prisma.invoice.update({ where: { id: existing.id }, data: updateData });
        }
        if (isPlaceholder) placeholderInvoiceId = existing.id;
      } else if (supplierId) {
        const invCount = await prisma.invoice.count();
        const invoiceNumber = `INV-${String(invCount + 1).padStart(4, "0")}`;
        const created = await prisma.invoice.create({
          data: {
            invoiceNumber,
            orderId,
            outletId,
            supplierId,
            amount: newTotalAmount,
            status: "PENDING",
            photos: invoicePhotos || [],
            notes: notes ? `From receiving: ${notes}` : null,
          },
        });
        placeholderInvoiceId = created.id;
      }

      // Fire-and-forget AI prefill on the placeholder. Pulls invoice number,
      // dates, and amount off the supplier invoice photo so procurement
      // doesn't have to retype anything — they just review + confirm.
      // Failures are logged inside aiPrefillInvoice; they don't block the
      // receiving response.
      if (placeholderInvoiceId && invoicePhotos && invoicePhotos.length > 0) {
        void aiPrefillInvoice(placeholderInvoiceId, invoicePhotos);
      }
    } catch (err) {
      console.error("[staff receivings] placeholder invoice attach/create failed:", err);
    }
  }

  await logActivity({
    userId: session.id,
    action: "receive",
    module: "receivings",
    targetId: receiving.id,
    details: `Received ${items.length} items${orderId ? ` for order` : " (ad-hoc)"}`,
  });

  return NextResponse.json(receiving, { status: 201 });
}
