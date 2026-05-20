import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tab = req.nextUrl.searchParams.get("tab") || "active";
  const search = req.nextUrl.searchParams.get("search") || "";

  const ACTIVE_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "AWAITING_DELIVERY", "PARTIALLY_RECEIVED"];
  const COMPLETED_STATUSES = ["COMPLETED", "CANCELLED"];

  const where: Record<string, unknown> = { orderType: "PURCHASE_ORDER" };
  if (tab === "active") where.status = { in: ACTIVE_STATUSES };
  else if (tab === "completed") where.status = { in: COMPLETED_STATUSES };

  if (search) {
    where.OR = [
      { orderNumber: { contains: search, mode: "insensitive" } },
      { supplier: { name: { contains: search, mode: "insensitive" } } },
      { outlet: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  // Created-date range — filters by Order.createdAt. `createdTo` is inclusive
  // (end-of-day). Mirrors the dueDate filter pattern on the invoices API.
  const createdFrom = req.nextUrl.searchParams.get("createdFrom") || "";
  const createdTo = req.nextUrl.searchParams.get("createdTo") || "";
  if (createdFrom || createdTo) {
    const createdFilter: Record<string, Date> = {};
    if (createdFrom) createdFilter.gte = new Date(createdFrom);
    if (createdTo) createdFilter.lte = new Date(createdTo + "T23:59:59Z");
    where.createdAt = createdFilter;
  }

  // Cross-tab summary — runs in parallel with the filtered list. The
  // summary cards on the page should always show all-time totals, not
  // shift counts when the user changes the tab filter.
  const summaryGroupsP = prisma.order.groupBy({
    by: ["status"],
    where: { orderType: "PURCHASE_ORDER" },
    _count: { _all: true },
    _sum: { totalAmount: true },
  });

  const orders = await prisma.order.findMany({
    where,
    take: 100,
    select: {
      id: true,
      orderNumber: true,
      outletId: true,
      status: true,
      totalAmount: true,
      deliveryCharge: true,
      notes: true,
      photos: true,
      deliveryDate: true,
      sentAt: true,
      approvedAt: true,
      createdAt: true,
      outlet: { select: { name: true, code: true } },
      supplier: { select: { id: true, name: true, phone: true, depositPercent: true, depositTermsDays: true } },
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
        select: {
          id: true, invoiceNumber: true, amount: true, status: true,
          issueDate: true, dueDate: true, photos: true,
          // Deposit + actual delivery — needed so the PO edit modal can
          // render its Deposit + Delivery panel when an invoice already exists.
          depositPercent: true, depositTermsDays: true, depositAmount: true,
          depositPaidAt: true, deliveryDate: true,
        },
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
    outletId: o.outletId,
    outlet: o.outlet.name,
    outletCode: o.outlet.code,
    supplierId: o.supplier?.id ?? null,
    supplier: o.supplier?.name ?? "Unknown",
    supplierPhone: o.supplier?.phone ?? "",
    status: o.status,
    totalAmount: Number(o.totalAmount),
    deliveryCharge: Number(o.deliveryCharge ?? 0),
    notes: o.notes,
    photos: o.photos,
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
          issueDate: o.invoices[0].issueDate.toISOString().split("T")[0],
          dueDate: o.invoices[0].dueDate?.toISOString().split("T")[0] ?? null,
          photoCount: o.invoices[0].photos.length,
          photos: o.invoices[0].photos,
          depositPercent: o.invoices[0].depositPercent ?? null,
          depositTermsDays: o.invoices[0].depositTermsDays ?? null,
          depositAmount: o.invoices[0].depositAmount ? Number(o.invoices[0].depositAmount) : null,
          depositPaidAt: o.invoices[0].depositPaidAt?.toISOString() ?? null,
          deliveryDate: o.invoices[0].deliveryDate?.toISOString().split("T")[0] ?? null,
        }
      : null,
    // Supplier defaults — used by the PO edit modal to pre-fill deposit %
    // when an invoice doesn't exist yet (or hasn't had its deposit set).
    supplierDepositPercent: o.supplier?.depositPercent ?? null,
    supplierDepositTermsDays: o.supplier?.depositTermsDays ?? null,
  }));

  const summaryGroups = await summaryGroupsP;
  const summary = {
    total: 0,
    draft: 0,
    active: 0,
    completed: 0,
    totalValue: 0,
  };
  for (const g of summaryGroups) {
    const count = g._count._all;
    const value = Number(g._sum.totalAmount ?? 0);
    summary.total += count;
    summary.totalValue += value;
    if ((g.status as string) === "DRAFT") summary.draft += count;
    else if (g.status === "COMPLETED") summary.completed += count;
    else if (ACTIVE_STATUSES.includes(g.status)) summary.active += count;
  }

  return NextResponse.json({ orders: mapped, summary });
}

export async function POST(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { outletId, supplierId, items, notes, deliveryDate, clientRequestId } = body;

    // Idempotency. The create page mints a UUID per submit and resends
    // it on retry. If we've already persisted a PO for this UUID, we
    // return the same row instead of creating a fresh duplicate. This
    // is the upstream fix for the 2026-05-13 incident where double-tap
    // / network retries spawned twin POs that each generated their own
    // placeholder invoice and both got paid by Finance.
    //
    // Server-side creators (AI agent, Telegram bot) call this without a
    // clientRequestId and keep the legacy create-every-time behaviour —
    // those entry points generate POs from concrete signals, not user
    // gestures, so accidental dupes aren't the failure mode there.
    if (typeof clientRequestId === "string" && clientRequestId.length > 0) {
      const existing = await prisma.order.findUnique({
        where: { clientRequestId },
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
      if (existing) {
        return NextResponse.json(existing, { status: 200 });
      }
    }

    const outlet = await prisma.outlet.findUniqueOrThrow({ where: { id: outletId } });

    const totalAmount = items.reduce(
      (sum: number, i: { quantity: number; unitPrice: number }) => sum + i.quantity * i.unitPrice,
      0,
    );

    // Retry loop to handle orderNumber collisions
    let order;
    for (let attempt = 0; attempt < 5; attempt++) {
      const maxResult = await prisma.order.aggregate({
        where: { orderNumber: { startsWith: `CC-${outlet.code}-` } },
        _max: { orderNumber: true },
      });
      const lastNum = maxResult._max.orderNumber
        ? parseInt(maxResult._max.orderNumber.split("-").pop() || "0")
        : 0;
      const orderNumber = `CC-${outlet.code}-${String(lastNum + 1 + attempt).padStart(4, "0")}`;

      try {
        order = await prisma.order.create({
          data: {
            orderNumber,
            outletId,
            supplierId,
            status: "DRAFT",
            totalAmount,
            notes: notes || null,
            deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
            createdById: caller.id,
            // Stamp the idempotency key when the client provides one.
            // The unique index on this column means two concurrent
            // POSTs racing past the findUnique check above will hit
            // P2002 here, and we recover by reading the now-existing
            // row instead of creating a second PO.
            clientRequestId:
              typeof clientRequestId === "string" && clientRequestId.length > 0
                ? clientRequestId
                : null,
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
        break;
      } catch (e: unknown) {
        // P2002 = unique constraint violation. Two flavours we care about:
        //   1) orderNumber collision — bump the suffix and retry.
        //   2) clientRequestId collision — a concurrent POST won the
        //      race with the same idempotency key. Return that PO
        //      instead of failing the user's retry.
        const code = (e as { code?: string }).code;
        const target = (e as { meta?: { target?: string[] | string } }).meta?.target;
        const targets = Array.isArray(target) ? target : target ? [target] : [];
        const isOrderNumberCollision = code === "P2002" && targets.some((t) => t.includes("orderNumber"));
        const isIdempotencyCollision = code === "P2002" && targets.some((t) => t.includes("clientRequestId"));
        if (isIdempotencyCollision && typeof clientRequestId === "string") {
          const existing = await prisma.order.findUnique({
            where: { clientRequestId },
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
          if (existing) return NextResponse.json(existing, { status: 200 });
        }
        if (!isOrderNumberCollision || attempt === 4) throw e;
      }
    }

    return NextResponse.json(order, { status: 201 });
  } catch (err) {
    console.error("[orders POST]", err);
    const message = err instanceof Error ? err.message : "Failed to create order";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
