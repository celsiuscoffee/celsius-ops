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

  const UNPAID_STATUSES = ["DRAFT", "INITIATED", "PENDING", "DEPOSIT_PAID", "OVERDUE"];

  const type = req.nextUrl.searchParams.get("type") || "all";

  const where: Record<string, unknown> = {};
  if (tab === "unpaid") where.status = { in: UNPAID_STATUSES };
  else if (tab === "paid") where.status = "PAID";

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
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  await prisma.invoice.updateMany({
    where: {
      status: "PENDING",
      dueDate: { lt: todayMidnight },
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
      supplier: { select: { name: true, phone: true, bankName: true, bankAccountNumber: true, bankAccountName: true, depositPercent: true } },
      paidAt: true,
      paidVia: true,
      paymentRef: true,
      popShortLink: true,
      depositAmount: true,
      depositPaidAt: true,
      depositRef: true,
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

  // Count due-today invoices (unpaid, due date = today)
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86400000);
  const dueTodayInvoices = await prisma.invoice.findMany({
    where: {
      status: { in: UNPAID_STATUSES as ("DRAFT" | "INITIATED" | "PENDING" | "OVERDUE")[] },
      dueDate: { gte: todayStart, lt: todayEnd },
    },
    select: { id: true, amount: true },
  });
  const dueTodayCount = dueTodayInvoices.length;
  const dueTodayAmount = dueTodayInvoices.reduce((s, i) => s + Number(i.amount), 0);

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
    depositPercent: inv.supplier?.depositPercent ?? null,
    depositAmount: inv.depositAmount ? Number(inv.depositAmount) : null,
    depositPaidAt: inv.depositPaidAt?.toISOString() ?? null,
    depositRef: inv.depositRef ?? null,
    flags: Array.isArray(inv.flags) ? inv.flags : [],
  }));

  return NextResponse.json({ invoices: mapped, outlets, dueTodayCount, dueTodayAmount });
}

export async function POST(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { orderId, outletId, supplierId, amount, invoiceNumber, issueDate, dueDate, photos } = body;

    if (!outletId || !supplierId) {
      return NextResponse.json({ error: "outletId and supplierId are required" }, { status: 400 });
    }

    // Generate invoice number if not provided
    let invNumber = invoiceNumber;
    if (!invNumber) {
      const invCount = await prisma.invoice.count();
      invNumber = `INV-${String(invCount + 1).padStart(4, "0")}`;
    }

    // Check if supplier requires deposit
    let depositAmount = null;
    if (supplierId && amount) {
      const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { depositPercent: true } });
      if (supplier?.depositPercent && supplier.depositPercent > 0) {
        depositAmount = Math.round((Number(amount) * supplier.depositPercent / 100) * 100) / 100;
      }
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
        photos: photos || [],
        ...(depositAmount ? { depositAmount } : {}),
        ...(flagsAtCreation.length > 0
          ? { flags: flagsAtCreation as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });

    return NextResponse.json(invoice, { status: 201 });
  } catch (err) {
    console.error("[invoices POST]", err);
    const message = err instanceof Error ? err.message : "Failed to create invoice";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
