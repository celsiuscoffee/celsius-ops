import { NextResponse, NextRequest } from "next/server";
import type { Prisma } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { checkModuleAccess } from "@/lib/check-module-access";

// Native staff app — invoice list. Scoped to the caller's outlet for
// non-managers (managers/owners/admins see all). Mirrors backoffice
// `/api/inventory/invoices` but simplified: no leg-amount math, no
// summary cards on the response (cards are computed client-side from
// the returned list, which is bounded at 200 by default).
//
// Tabs: unpaid / paid / all
// Cards (cardFilter param, optional): paid / overdue / payable / due_today /
//   pending_invoice
//
// Pending invoice = GRNI placeholder (goods received but supplier
// hasn't sent the real invoice yet). Identified by `INV-` prefix +
// `dueDate=null` + status=PENDING + linked to a PO. Native app uses
// this card to surface "things you should attach an invoice to".
const UNPAID_STATUSES = [
  "DRAFT",
  "INITIATED",
  "PENDING",
  "PARTIALLY_PAID",
  "DEPOSIT_PAID",
  "OVERDUE",
] as const;

export async function GET(req: NextRequest) {
  const guard = await checkModuleAccess(req, "inventory:invoices");
  if (!guard.ok) return guard.response;
  const session = guard.session;

  const url = new URL(req.url);
  const tab = url.searchParams.get("tab") || "unpaid";
  const cardFilter = url.searchParams.get("cardFilter") || "";
  const search = url.searchParams.get("search")?.trim() ?? "";
  // Phase 10 filters — all optional, layered on top of tab/cardFilter.
  // - popStatus: "sent" | "not_sent" — paid invoices only; for finance
  //   to find what's been collected but not yet acknowledged to supplier.
  // - supplierId: drill into one supplier's invoices.
  // - outletId: manager-only override of the default outlet scope below.
  // - dateFrom / dateTo: filter by issueDate (ISO yyyy-mm-dd). Inclusive.
  const popStatus = url.searchParams.get("popStatus") || "";
  const filterSupplierId = url.searchParams.get("supplierId") || "";
  const filterOutletId = url.searchParams.get("outletId") || "";
  const dateFrom = url.searchParams.get("dateFrom") || "";
  const dateTo = url.searchParams.get("dateTo") || "";

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart.getTime() + 86_400_000);

  const overdueOr: Prisma.InvoiceWhereInput[] = [
    { status: "OVERDUE" },
    { status: "INITIATED", dueDate: { lt: todayStart } },
  ];

  const pendingInvoiceWhere: Prisma.InvoiceWhereInput = {
    invoiceNumber: { startsWith: "INV-" },
    dueDate: null,
    status: "PENDING",
    orderId: { not: null },
    paymentType: "SUPPLIER",
  };

  const where: Record<string, unknown> = {};

  if (cardFilter === "paid") {
    where.status = "PAID";
  } else if (cardFilter === "overdue") {
    where.OR = overdueOr;
    where.NOT = pendingInvoiceWhere;
  } else if (cardFilter === "pending_invoice") {
    Object.assign(where, pendingInvoiceWhere);
  } else if (cardFilter === "payable") {
    where.status = { in: UNPAID_STATUSES };
    where.NOT = pendingInvoiceWhere;
  } else if (cardFilter === "due_today") {
    where.status = { in: UNPAID_STATUSES };
    where.dueDate = { gte: todayStart, lt: todayEnd };
    where.NOT = pendingInvoiceWhere;
  } else if (tab === "unpaid") {
    where.status = { in: UNPAID_STATUSES };
    where.NOT = pendingInvoiceWhere;
  } else if (tab === "paid") {
    where.status = "PAID";
  } else if (tab === "pending_invoice") {
    Object.assign(where, pendingInvoiceWhere);
  } else {
    where.NOT = pendingInvoiceWhere;
  }

  // Outlet scope — non-managers only see invoices for their assigned
  // outlet. An invoice's outlet is on the linked order; for PR/staff-
  // claim invoices (no order) we currently show them to everyone since
  // there's no outlet to scope by. Mirrors the staff-side claims API.
  //
  // Managers can override via ?outletId=... in the filter sheet. We
  // enforce server-side that non-managers can NOT pass outletId — they
  // stay locked to their assigned outlet (silent no-op rather than 403
  // so a stale UI doesn't break the list).
  const isManager = ["OWNER", "ADMIN", "MANAGER"].includes(session.role);
  if (isManager && filterOutletId) {
    where.order = { outletId: filterOutletId };
  } else if (!isManager && session.outletId) {
    where.OR = [
      ...((where.OR as Prisma.InvoiceWhereInput[] | undefined) ?? []),
      { order: { outletId: session.outletId } },
      { orderId: null }, // ad-hoc / staff-claim invoices have no order
    ];
  }

  // Supplier filter — applies to any role.
  if (filterSupplierId) {
    where.supplierId = filterSupplierId;
  }

  // POP-sent filter — only meaningful for paid statuses (a DRAFT POP
  // makes no sense). The list still respects whatever tab/cardFilter is
  // applied; this just narrows further.
  if (popStatus === "sent") {
    where.popSentAt = { not: null };
  } else if (popStatus === "not_sent") {
    where.popSentAt = null;
  }

  // Date range — filter by issueDate (the supplier-set date on the
  // invoice). End-of-day rollover on dateTo so the user gets a full
  // inclusive day when they pick a single date.
  if (dateFrom || dateTo) {
    const range: { gte?: Date; lte?: Date } = {};
    if (dateFrom) range.gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      range.lte = end;
    }
    where.issueDate = range;
  }

  if (search) {
    where.AND = [
      ...((where.AND as Prisma.InvoiceWhereInput[] | undefined) ?? []),
      {
        OR: [
          { invoiceNumber: { contains: search, mode: "insensitive" } },
          {
            supplier: {
              name: { contains: search, mode: "insensitive" },
            },
          },
          {
            order: {
              orderNumber: { contains: search, mode: "insensitive" },
            },
          },
        ],
      },
    ];
  }

  const invoices = await prisma.invoice.findMany({
    where,
    take: 200,
    select: {
      id: true,
      invoiceNumber: true,
      amount: true,
      amountPaid: true,
      depositAmount: true,
      // Need the deposit context fields so the native list can build
      // a status-aware POP message inline (no detail fetch needed).
      depositPercent: true,
      depositRef: true,
      paymentRef: true,
      popShortLink: true,
      // Phase 10 — when the supplier was last sent the POP via WhatsApp.
      popSentAt: true,
      status: true,
      paymentType: true,
      dueDate: true,
      paidAt: true,
      createdAt: true,
      photos: true,
      // supplierPhone needed for the wa.me deeplink target on the list.
      supplier: { select: { id: true, name: true, phone: true } },
      order: {
        select: {
          id: true,
          orderNumber: true,
          outlet: { select: { name: true, code: true } },
        },
      },
    },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({
    items: invoices.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      amount: Number(i.amount),
      amountPaid: i.amountPaid != null ? Number(i.amountPaid) : 0,
      depositAmount: i.depositAmount != null ? Number(i.depositAmount) : 0,
      depositPercent: i.depositPercent ?? null,
      depositRef: i.depositRef ?? null,
      paymentRef: i.paymentRef ?? null,
      popShortLink: i.popShortLink ?? null,
      popSentAt: i.popSentAt?.toISOString() ?? null,
      status: i.status,
      paymentType: i.paymentType,
      dueDate: i.dueDate?.toISOString() ?? null,
      paidAt: i.paidAt?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
      photos: i.photos ?? [],
      supplierName: i.supplier?.name ?? null,
      supplierPhone: i.supplier?.phone ?? null,
      orderId: i.order?.id ?? null,
      orderNumber: i.order?.orderNumber ?? null,
      outletName: i.order?.outlet?.name ?? null,
    })),
  });
}
