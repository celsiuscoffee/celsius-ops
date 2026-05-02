import { NextResponse, NextRequest } from "next/server";
import type { Prisma } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { detectCreationFlags } from "@/lib/inventory/flag-detector";

export async function GET(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tab = req.nextUrl.searchParams.get("tab") || "unpaid";
  const search = req.nextUrl.searchParams.get("search") || "";

  const UNPAID_STATUSES = ["DRAFT", "INITIATED", "PENDING", "PARTIALLY_PAID", "DEPOSIT_PAID", "OVERDUE"];

  const type = req.nextUrl.searchParams.get("type") || "all";
  // cardFilter narrows the result set the same way the summary cards do.
  // Pushed to the server so paginated fetches don't hide unpaid rows that
  // sit below the top 200 PAID-by-paidAt-desc cutoff. cardFilter wins
  // over `tab` when they conflict — the user explicitly clicked a card.
  const cardFilter = req.nextUrl.searchParams.get("cardFilter") || "";

  const _now = new Date();
  const _todayStart = new Date(_now.getFullYear(), _now.getMonth(), _now.getDate());
  const _todayEnd = new Date(_todayStart.getTime() + 86400000);

  // "Overdue" semantically = anything unpaid past its due date. The OVERDUE
  // status auto-rollover only flips PENDING → OVERDUE (line below); INITIATED
  // is intentionally left alone so Finance can see "payment in progress" at a
  // glance. But once an INITIATED invoice sits past its due date, it really
  // is overdue from the supplier's perspective. We surface it as overdue in
  // the cards and filter without rewriting the status, so the table badge
  // still reads INITIATED — useful triage info for Finance.
  const overdueOr: Prisma.InvoiceWhereInput[] = [
    { status: "OVERDUE" },
    { status: "INITIATED", dueDate: { lt: _todayStart } },
  ];

  // GRNI / "pending invoice" = goods received, supplier hasn't sent the
  // actual invoice yet. Created by the receivings POST side-effect with
  // an auto-generated INV-NNNN number, no dueDate, status=PENDING, and
  // linked to the PO. Once the user clicks "Attach Invoice" and fills in
  // the supplier's real invoice number + dueDate, the row drops out of
  // this bucket naturally.
  const pendingInvoiceWhere: Prisma.InvoiceWhereInput = {
    invoiceNumber: { startsWith: "INV-" },
    dueDate: null,
    status: "PENDING",
    orderId: { not: null },
    paymentType: "SUPPLIER",
  };

  // NOT-placeholder shape — the inverse of pendingInvoiceWhere. Used to
  // filter placeholders out of all default views (Unpaid / Paid / All
  // tabs and Payable / Due Today / Overdue cards). Only the explicit
  // "Pending Invoice" cardFilter shows them.
  const notPlaceholder: Prisma.InvoiceWhereInput = {
    NOT: pendingInvoiceWhere,
  };

  const where: Record<string, unknown> = {};
  if (cardFilter === "paid") where.status = "PAID";
  else if (cardFilter === "overdue") { where.OR = overdueOr; Object.assign(where, notPlaceholder); }
  else if (cardFilter === "initiated") where.status = "INITIATED";
  else if (cardFilter === "pending") { where.status = "PENDING"; Object.assign(where, notPlaceholder); }
  else if (cardFilter === "pending_invoice") {
    Object.assign(where, pendingInvoiceWhere);
  }
  else if (cardFilter === "payable") { where.status = { in: UNPAID_STATUSES }; Object.assign(where, notPlaceholder); }
  else if (cardFilter === "due_today") {
    where.status = { in: UNPAID_STATUSES };
    where.dueDate = { gte: _todayStart, lt: _todayEnd };
    Object.assign(where, notPlaceholder);
  } else if (tab === "unpaid") { where.status = { in: UNPAID_STATUSES }; Object.assign(where, notPlaceholder); }
  else if (tab === "paid") where.status = "PAID";
  else { Object.assign(where, notPlaceholder); }

  if (type === "supplier") {
    // "Supplier" = ingredient supplier invoices only (exclude one-off vendor
    // payment requests even though they share paymentType=SUPPLIER).
    where.paymentType = "SUPPLIER";
    where.order = { orderType: { not: "PAYMENT_REQUEST" } };
  } else if (type === "staff_claim") where.paymentType = "STAFF_CLAIM";
  else if (type === "transfer") where.paymentType = "INTERNAL_TRANSFER";
  else if (type === "payment_request") {
    // Finance-pays-vendor requests (asset/maintenance/other one-offs)
    where.order = { orderType: "PAYMENT_REQUEST" };
  }

  const outletIds = req.nextUrl.searchParams.getAll("outlet").filter(Boolean);
  if (outletIds.length === 1) where.outletId = outletIds[0];
  else if (outletIds.length > 1) where.outletId = { in: outletIds };

  const dueDateFrom = req.nextUrl.searchParams.get("dueDateFrom") || "";
  const dueDateTo = req.nextUrl.searchParams.get("dueDateTo") || "";
  if (dueDateFrom || dueDateTo) {
    const dueDateFilter: Record<string, Date> = {};
    if (dueDateFrom) dueDateFilter.gte = new Date(dueDateFrom);
    if (dueDateTo) dueDateFilter.lte = new Date(dueDateTo + "T23:59:59Z");
    where.dueDate = dueDateFilter;
  }

  const paidDateFrom = req.nextUrl.searchParams.get("paidDateFrom") || "";
  const paidDateTo = req.nextUrl.searchParams.get("paidDateTo") || "";
  if (paidDateFrom || paidDateTo) {
    const paidDateFilter: Record<string, Date> = {};
    if (paidDateFrom) paidDateFilter.gte = new Date(paidDateFrom);
    if (paidDateTo) paidDateFilter.lte = new Date(paidDateTo + "T23:59:59Z");
    where.paidAt = paidDateFilter;
  }

  if (search) {
    where.OR = [
      { invoiceNumber: { contains: search, mode: "insensitive" } },
      { supplier: { name: { contains: search, mode: "insensitive" } } },
      { outlet: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  // Auto-mark overdue: only PENDING invoices past due date become OVERDUE
  // (INITIATED invoices stay INITIATED — payment is already in progress)
  await prisma.invoice.updateMany({
    where: {
      status: "PENDING",
      dueDate: { lt: _todayStart },
    },
    data: { status: "OVERDUE" },
  });

  const invoices = await prisma.invoice.findMany({
    where,
    take: 200,
    select: {
      id: true,
      invoiceNumber: true,
      amount: true,
      status: true,
      issueDate: true,
      dueDate: true,
      photos: true,
      notes: true,
      paymentType: true,
      expenseCategory: true,
      claimedById: true,
      vendorName: true,
      vendorBankName: true,
      vendorBankAccountNumber: true,
      vendorBankAccountName: true,
      flags: true,
      order: {
        select: {
          orderNumber: true,
          orderType: true,
          claimedBy: {
            select: {
              name: true,
              bankName: true,
              bankAccountNumber: true,
              bankAccountName: true,
            },
          },
        },
      },
      outlet: { select: { name: true } },
      supplier: { select: { name: true, phone: true, bankName: true, bankAccountNumber: true, bankAccountName: true, depositPercent: true, paymentTerms: true } },
      paidAt: true,
      paidVia: true,
      paymentRef: true,
      popShortLink: true,
      depositPercent: true,
      depositTermsDays: true,
      depositAmount: true,
      depositPaidAt: true,
      depositRef: true,
      deliveryDate: true,
      amountPaid: true,
    },
    // Paid invoices sort by paidAt desc (newest payment first). Unpaid rows
    // have paidAt=null and fall through to issueDate desc.
    orderBy: [
      { paidAt: { sort: "desc", nulls: "last" } },
      { issueDate: "desc" },
    ],
  });

  // Fetch distinct outlets for filter dropdown
  const outlets = await prisma.outlet.findMany({
    where: { invoices: { some: {} } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Summary cards aggregate over the FULL invoice table — not the paginated
  // 200-row response. Previously the client computed Total / Payable / Overdue
  // / Paid by filtering `invoices` (capped at 200), so once you had >200
  // PAID invoices the older unpaid ones fell off the page and Payable
  // collapsed to RM 0.00 even though Due Today (server-side) correctly
  // showed 17 outstanding. Compute everything server-side on the same
  // snapshot so the cards stay consistent. INITIATED counts as Payable —
  // it stays INITIATED rather than rolling to OVERDUE on its own (per the
  // updateMany above) but it's still owed, not paid.
  // Reuse the today window already computed at the top so the cardFilter,
  // auto-overdue update, and these summary queries all share one boundary.
  const todayStart = _todayStart;
  const todayEnd = _todayEnd;

  const [allAgg, paidAgg, overdueAgg, initiatedAgg, payableInvoices, dueTodayInvoices, pendingInvoiceAgg] = await Promise.all([
    prisma.invoice.aggregate({ _sum: { amount: true }, _count: { _all: true } }),
    prisma.invoice.aggregate({ where: { status: "PAID" }, _sum: { amount: true }, _count: { _all: true } }),
    // Overdue = literal OVERDUE status PLUS INITIATED past due date.
    // Same OR shape as the cardFilter so card count and table count agree.
    prisma.invoice.aggregate({ where: { OR: overdueOr }, _sum: { amount: true }, _count: { _all: true } }),
    // Initiated card — counts every INITIATED row regardless of due date.
    // Useful for Finance to see how many payments are mid-flight.
    prisma.invoice.aggregate({ where: { status: "INITIATED" }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.invoice.findMany({
      // Payable = unpaid AND NOT a GRNI placeholder. Placeholders surface
      // separately in the Pending Invoice card (and on the Payable card as
      // a soft sub-line) so cashflow planning still sees the full liability.
      where: {
        status: { in: UNPAID_STATUSES as ("DRAFT" | "INITIATED" | "PENDING" | "PARTIALLY_PAID" | "DEPOSIT_PAID" | "OVERDUE")[] },
        NOT: pendingInvoiceWhere,
      },
      select: { id: true, amount: true, status: true, depositAmount: true, amountPaid: true },
    }),
    prisma.invoice.findMany({
      where: {
        status: { in: UNPAID_STATUSES as ("DRAFT" | "INITIATED" | "PENDING" | "PARTIALLY_PAID" | "DEPOSIT_PAID" | "OVERDUE")[] },
        dueDate: { gte: todayStart, lt: todayEnd },
        NOT: pendingInvoiceWhere,
      },
      select: { id: true, amount: true, status: true, depositAmount: true, amountPaid: true },
    }),
    // Pending Invoice = goods received but supplier invoice not yet attached
    prisma.invoice.aggregate({ where: pendingInvoiceWhere, _sum: { amount: true }, _count: { _all: true } }),
  ]);

  // Outstanding balance = full amount minus what's already been paid.
  // amountPaid is the source of truth — covers DEPOSIT_PAID, PARTIALLY_PAID,
  // and any combination of partials. Falls back to the legacy depositAmount
  // calculation if amountPaid is somehow zero on a DEPOSIT_PAID row.
  const outstanding = (i: { amount: { toNumber?: () => number } | number; status: string; depositAmount: { toNumber?: () => number } | number | null; amountPaid?: { toNumber?: () => number } | number | null }) => {
    const amt = typeof i.amount === "number" ? i.amount : i.amount.toNumber?.() ?? 0;
    const paid = i.amountPaid == null ? 0 : (typeof i.amountPaid === "number" ? i.amountPaid : i.amountPaid.toNumber?.() ?? 0);
    if (paid > 0) return Math.max(0, amt - paid);
    const dep = i.depositAmount == null ? 0 : (typeof i.depositAmount === "number" ? i.depositAmount : i.depositAmount.toNumber?.() ?? 0);
    return i.status === "DEPOSIT_PAID" ? Math.max(0, amt - dep) : amt;
  };
  const payableAmount = payableInvoices.reduce((s, i) => s + outstanding(i), 0);
  const payableCount = payableInvoices.length;
  const dueTodayCount = dueTodayInvoices.length;
  const dueTodayAmount = dueTodayInvoices.reduce((s, i) => s + outstanding(i), 0);

  const summary = {
    total: { count: allAgg._count._all, amount: Number(allAgg._sum.amount ?? 0) },
    payable: { count: payableCount, amount: payableAmount },
    overdue: { count: overdueAgg._count._all, amount: Number(overdueAgg._sum.amount ?? 0) },
    initiated: { count: initiatedAgg._count._all, amount: Number(initiatedAgg._sum.amount ?? 0) },
    paid: { count: paidAgg._count._all, amount: Number(paidAgg._sum.amount ?? 0) },
    dueToday: { count: dueTodayCount, amount: dueTodayAmount },
    pendingInvoice: { count: pendingInvoiceAgg._count._all, amount: Number(pendingInvoiceAgg._sum.amount ?? 0) },
  };

  const mapped = invoices.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    poNumber: inv.order?.orderNumber ?? "—",
    outlet: inv.outlet.name,
    supplier: inv.supplier?.name ?? "—",
    amount: Number(inv.amount),
    status: inv.status,
    issueDate: inv.issueDate.toISOString().split("T")[0],
    dueDate: inv.dueDate?.toISOString().split("T")[0] ?? null,
    hasPhoto: inv.photos.length > 0,
    photoCount: inv.photos.length,
    photos: inv.photos,
    paymentType: inv.paymentType ?? "SUPPLIER",
    claimedBy: inv.order?.claimedBy?.name ?? null,
    notes: inv.notes,
    paidAt: inv.paidAt?.toISOString() ?? null,
    paidVia: inv.paidVia,
    paymentRef: inv.paymentRef,
    popShortLink: inv.popShortLink ?? null,
    supplierPhone: inv.supplier?.phone ?? null,
    supplierBank: inv.supplier?.bankName ? {
      bankName: inv.supplier.bankName,
      accountNumber: inv.supplier.bankAccountNumber ?? null,
      accountName: inv.supplier.bankAccountName ?? null,
    } : null,
    // For STAFF_CLAIM invoices, surface the claimant's bank details from
    // their User record (same fields the HR employees page reads from).
    claimantBank: inv.order?.claimedBy?.bankName ? {
      bankName: inv.order.claimedBy.bankName,
      accountNumber: inv.order.claimedBy.bankAccountNumber ?? null,
      accountName: inv.order.claimedBy.bankAccountName ?? null,
    } : null,
    // One-off vendor (asset/maintenance/other payment requests)
    vendorName: inv.vendorName ?? null,
    vendorBank: inv.vendorBankName ? {
      bankName: inv.vendorBankName,
      accountNumber: inv.vendorBankAccountNumber ?? null,
      accountName: inv.vendorBankAccountName ?? null,
    } : null,
    expenseCategory: inv.expenseCategory,
    orderType: inv.order?.orderType ?? null,
    // Invoice override wins; supplier default is the fallback so legacy
    // rows without an explicit override still render the deposit UI.
    depositPercent: inv.depositPercent ?? inv.supplier?.depositPercent ?? null,
    depositTermsDays: inv.depositTermsDays ?? null,
    depositAmount: inv.depositAmount ? Number(inv.depositAmount) : null,
    deliveryDate: inv.deliveryDate?.toISOString().split("T")[0] ?? null,
    amountPaid: inv.amountPaid ? Number(inv.amountPaid) : 0,
    depositPaidAt: inv.depositPaidAt?.toISOString() ?? null,
    depositRef: inv.depositRef ?? null,
    flags: Array.isArray(inv.flags) ? inv.flags : [],
    // True when this is a GRNI placeholder — auto-created on receiving,
    // awaiting the supplier to send the actual invoice details.
    isPendingInvoice:
      inv.invoiceNumber.startsWith("INV-") &&
      inv.dueDate == null &&
      inv.status === "PENDING" &&
      inv.order != null &&
      inv.paymentType === "SUPPLIER",
    supplierPaymentTerms: inv.supplier?.paymentTerms ?? null,
  }));

  return NextResponse.json({ invoices: mapped, outlets, dueTodayCount, dueTodayAmount, summary });
}

export async function POST(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { orderId, outletId, supplierId, amount, invoiceNumber, issueDate, dueDate, deliveryDate, photos } = body;
    // Per-invoice deposit override. `undefined` → fall back to supplier
    // default (typical case). `null` → explicitly no deposit on this invoice.
    // Number → use as the percent.
    const depositPercentInput: number | null | undefined = body.depositPercent;
    const depositTermsInput: number | null | undefined = body.depositTermsDays;

    if (!outletId || !supplierId) {
      return NextResponse.json({ error: "outletId and supplierId are required" }, { status: 400 });
    }

    // Generate invoice number if not provided
    let invNumber = invoiceNumber;
    if (!invNumber) {
      const invCount = await prisma.invoice.count();
      invNumber = `INV-${String(invCount + 1).padStart(4, "0")}`;
    }

    // Resolve deposit policy: invoice override wins, else supplier default.
    // We persist the effective percent on the invoice so future amount edits
    // can recompute without re-reading the supplier (which may change).
    let effectivePercent: number | null = null;
    if (depositPercentInput === null) {
      effectivePercent = null; // explicit off
    } else if (typeof depositPercentInput === "number") {
      effectivePercent = depositPercentInput > 0 ? depositPercentInput : null;
    } else if (supplierId) {
      const supplier = await prisma.supplier.findUnique({
        where: { id: supplierId },
        select: { depositPercent: true, depositTermsDays: true },
      });
      effectivePercent = supplier?.depositPercent && supplier.depositPercent > 0 ? supplier.depositPercent : null;
      // If caller didn't pass terms, inherit from supplier too
      if (depositTermsInput === undefined && supplier?.depositTermsDays) {
        body.depositTermsDays = supplier.depositTermsDays;
      }
    }
    const effectiveTerms: number | null =
      depositTermsInput === null ? null
      : typeof depositTermsInput === "number" && depositTermsInput > 0 ? depositTermsInput
      : (typeof body.depositTermsDays === "number" ? body.depositTermsDays : null);

    let depositAmount: number | null = null;
    if (effectivePercent && amount) {
      depositAmount = Math.round((Number(amount) * effectivePercent / 100) * 100) / 100;
    }

    const flagsAtCreation = await detectCreationFlags({
      orderId: orderId || null,
      supplierId: supplierId || null,
      amount: Number(amount ?? 0),
      issueDate: issueDate ? new Date(issueDate) : null,
    });

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: invNumber,
        orderId: orderId || null,
        outletId,
        supplierId,
        amount: amount ?? 0,
        status: "PENDING",
        issueDate: issueDate ? new Date(issueDate) : new Date(),
        dueDate: dueDate ? new Date(dueDate) : null,
        deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
        photos: photos || [],
        ...(effectivePercent ? { depositPercent: effectivePercent } : {}),
        ...(effectiveTerms ? { depositTermsDays: effectiveTerms } : {}),
        ...(depositAmount ? { depositAmount } : {}),
        ...(flagsAtCreation.length > 0
          ? { flags: flagsAtCreation as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });

    return NextResponse.json(invoice, { status: 201 });
  } catch (err) {
    console.error("[invoices POST]", err);
    // Friendly handling for the (supplierId, invoiceNumber) unique constraint.
    if (
      typeof err === "object" && err !== null && "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      const target = (err as { meta?: { target?: string[] } }).meta?.target;
      if (target?.includes("invoiceNumber")) {
        return NextResponse.json(
          { error: "That invoice number is already in use for this supplier. Use a different number or attach the existing invoice." },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: "Duplicate value — that combination already exists." }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "Failed to create invoice";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
