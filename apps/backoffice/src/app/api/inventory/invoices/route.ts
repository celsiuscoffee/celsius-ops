import { NextResponse, NextRequest } from "next/server";
import type { Prisma } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { detectCreationFlags } from "@/lib/inventory/flag-detector";
import { mytTodayRange } from "@/lib/inventory/myt-today";
import { mintPlaceholderNumber } from "@/lib/inventory/placeholder-number";

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

  // "Today" is the MALAYSIA calendar day (UTC+8), not the server's UTC day — otherwise invoices
  // due today drop out of the Due Today card every Malaysia morning (00:00–08:00 MYT, when UTC is
  // still yesterday). See lib/inventory/myt-today.
  const { start: _todayStart, end: _todayEnd } = mytTodayRange();

  // "Overdue" semantically = anything unpaid past its due date. The OVERDUE
  // status auto-rollover only flips PENDING → OVERDUE (line below); INITIATED
  // is intentionally left alone so Finance can see "payment in progress" at a
  // glance. But once an INITIATED invoice sits past its due date, it really
  // is overdue from the supplier's perspective. We surface it as overdue in
  // the cards and filter without rewriting the status, so the table badge
  // still reads INITIATED — useful triage info for Finance.
  //
  // Same treatment for the two-leg payment states: a DEPOSIT_PAID or
  // PARTIALLY_PAID invoice still owes its balance, so once that balance is
  // past the due date it's overdue. We surface it without rewriting the
  // status — flipping to OVERDUE would erase the "deposit paid" state and
  // break the Initiate Balance Payment flow. dueNow() (below) already counts
  // only the remaining balance for these, so the Overdue card amount is right.
  const overdueOr: Prisma.InvoiceWhereInput[] = [
    { status: "OVERDUE" },
    { status: "INITIATED", dueDate: { lt: _todayStart } },
    { status: "DEPOSIT_PAID", dueDate: { lt: _todayStart } },
    { status: "PARTIALLY_PAID", dueDate: { lt: _todayStart } },
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

  // Multi-select supplier filter — repeated `?supplier=<id>` params, OR'd
  // together via Prisma `in`. Only applies to supplier-type invoices; staff
  // claims and payment requests skip this filter naturally because they
  // have null supplierId.
  const supplierIds = req.nextUrl.searchParams.getAll("supplier").filter(Boolean);
  if (supplierIds.length === 1) where.supplierId = supplierIds[0];
  else if (supplierIds.length > 1) where.supplierId = { in: supplierIds };

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
      { order: { orderNumber: { contains: search, mode: "insensitive" } } },
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
      aiPrefilledAt: true,
      aiPrefilledFields: true,
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

  // Distinct suppliers that appear on at least one invoice — same shape
  // as outlets, used to populate the Suppliers filter card.
  const suppliers = await prisma.supplier.findMany({
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

  // Cards now show "what AP actually owes right now" per invoice — the
  // active-leg amount, not the full invoice. For a deposit-bearing
  // invoice in the deposit leg, that's the deposit; in the balance leg,
  // it's the remaining balance. For everything else, it's the full
  // outstanding amount.
  const legSelect = { id: true, amount: true, status: true, depositAmount: true, amountPaid: true } as const;

  const [allAgg, paidAgg, overdueRows, initiatedRows, payableInvoices, dueTodayInvoices, pendingInvoiceAgg] = await Promise.all([
    prisma.invoice.aggregate({ _sum: { amount: true }, _count: { _all: true } }),
    prisma.invoice.aggregate({ where: { status: "PAID" }, _sum: { amount: true }, _count: { _all: true } }),
    // Overdue = literal OVERDUE status PLUS INITIATED past due date.
    // Same OR shape as the cardFilter so card count and table count agree.
    prisma.invoice.findMany({ where: { OR: overdueOr }, select: legSelect }),
    // Initiated card — every INITIATED row regardless of due date.
    prisma.invoice.findMany({ where: { status: "INITIATED" }, select: legSelect }),
    prisma.invoice.findMany({
      // Payable = unpaid AND NOT a GRNI placeholder. Placeholders surface
      // separately in the Pending Invoice card so cashflow planning sees
      // the full liability.
      where: {
        status: { in: UNPAID_STATUSES as ("DRAFT" | "INITIATED" | "PENDING" | "PARTIALLY_PAID" | "DEPOSIT_PAID" | "OVERDUE")[] },
        NOT: pendingInvoiceWhere,
      },
      select: legSelect,
    }),
    prisma.invoice.findMany({
      where: {
        status: { in: UNPAID_STATUSES as ("DRAFT" | "INITIATED" | "PENDING" | "PARTIALLY_PAID" | "DEPOSIT_PAID" | "OVERDUE")[] },
        dueDate: { gte: todayStart, lt: todayEnd },
        NOT: pendingInvoiceWhere,
      },
      select: legSelect,
    }),
    // Pending Invoice = goods received but supplier invoice not yet attached
    prisma.invoice.aggregate({ where: pendingInvoiceWhere, _sum: { amount: true }, _count: { _all: true } }),
  ]);

  // Two amount-of-interest helpers, used by different cards:
  //  - outstanding(i) = total still owed to the supplier (amount - amountPaid).
  //    Powers the Payable card — that's the AP balance.
  //  - dueNow(i)      = active-leg amount only — deposit when in the deposit
  //    leg, balance when in the balance leg. Powers Overdue / Initiated /
  //    Due Today since those cards represent "cash out for the current step",
  //    not total liability.
  const toNum = (v: { toNumber?: () => number } | number | null | undefined) =>
    v == null ? 0 : (typeof v === "number" ? v : v.toNumber?.() ?? 0);
  const outstanding = (i: { amount: { toNumber?: () => number } | number; amountPaid?: { toNumber?: () => number } | number | null }) =>
    Math.max(0, toNum(i.amount) - toNum(i.amountPaid));
  const dueNow = (i: { amount: { toNumber?: () => number } | number; status: string; depositAmount: { toNumber?: () => number } | number | null; amountPaid?: { toNumber?: () => number } | number | null }) => {
    const amt = toNum(i.amount);
    const paid = toNum(i.amountPaid);
    if (paid > 0) return Math.max(0, amt - paid);
    const dep = toNum(i.depositAmount);
    return dep > 0 ? dep : amt;
  };

  const payableAmount = payableInvoices.reduce((s, i) => s + outstanding(i), 0);
  const payableCount = payableInvoices.length;
  const overdueAmount = overdueRows.reduce((s, i) => s + dueNow(i), 0);
  const overdueCount = overdueRows.length;
  const initiatedAmount = initiatedRows.reduce((s, i) => s + dueNow(i), 0);
  const initiatedCount = initiatedRows.length;
  const dueTodayCount = dueTodayInvoices.length;
  const dueTodayAmount = dueTodayInvoices.reduce((s, i) => s + dueNow(i), 0);

  const summary = {
    total: { count: allAgg._count._all, amount: Number(allAgg._sum.amount ?? 0) },
    payable: { count: payableCount, amount: payableAmount },
    overdue: { count: overdueCount, amount: overdueAmount },
    initiated: { count: initiatedCount, amount: initiatedAmount },
    paid: { count: paidAgg._count._all, amount: Number(paidAgg._sum.amount ?? 0) },
    dueToday: { count: dueTodayCount, amount: dueTodayAmount },
    pendingInvoice: { count: pendingInvoiceAgg._count._all, amount: Number(pendingInvoiceAgg._sum.amount ?? 0) },
  };

  // "Possible POP match" — ambiguous POPs the Telegram matcher couldn't auto-link. Surfaced on
  // each candidate invoice's row so a human can confirm which one it settles, right here.
  const openPops = await prisma.pendingPop.findMany({
    where: { status: "OPEN", candidateInvoiceIds: { hasSome: invoices.map((i) => i.id) } },
    select: { id: true, amount: true, referenceNumber: true, payeeName: true, photoUrl: true, candidateInvoiceIds: true },
  });
  type PopLite = { id: string; amount: number; referenceNumber: string | null; payeeName: string | null; photoUrl: string | null };
  const popByInvoice = new Map<string, PopLite>();
  for (const p of openPops) {
    const lite: PopLite = { id: p.id, amount: Number(p.amount), referenceNumber: p.referenceNumber, payeeName: p.payeeName, photoUrl: p.photoUrl };
    for (const invId of p.candidateInvoiceIds) if (!popByInvoice.has(invId)) popByInvoice.set(invId, lite);
  }

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
    // An uploaded POP the matcher couldn't auto-link, for which THIS invoice is a candidate →
    // the row shows a "possible POP" badge + a Confirm action. null when there's none.
    possiblePop: popByInvoice.get(inv.id) ?? null,
    // True when this is a GRNI placeholder — auto-created on receiving,
    // awaiting the supplier to send the actual invoice details.
    isPendingInvoice:
      inv.invoiceNumber.startsWith("INV-") &&
      inv.dueDate == null &&
      inv.status === "PENDING" &&
      inv.order != null &&
      inv.paymentType === "SUPPLIER",
    // AI-prefilled = staff submitted a receiving photo, the extractor wrote
    // supplier-side fields into this row, and procurement hasn't confirmed
    // yet. UI surfaces a "verify before paying" banner and a Confirm CTA.
    aiPrefilledAt: inv.aiPrefilledAt?.toISOString() ?? null,
    aiPrefilledFields: inv.aiPrefilledFields ? JSON.parse(inv.aiPrefilledFields) as string[] : [],
    supplierPaymentTerms: inv.supplier?.paymentTerms ?? null,
  }));

  return NextResponse.json({ invoices: mapped, outlets, suppliers, dueTodayCount, dueTodayAmount, summary });
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
      invNumber = await mintPlaceholderNumber(prisma, outletId);
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
