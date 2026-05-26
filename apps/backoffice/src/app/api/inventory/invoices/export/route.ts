import { NextResponse, NextRequest } from "next/server";
import type { Prisma } from "@celsius/db";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";

export const runtime = "nodejs"; // xlsx needs Node

/**
 * GET /api/inventory/invoices/export
 *
 * Returns an XLSX of invoices matching the supplied filters. Mirrors the
 * filter logic of GET /api/inventory/invoices but with no row cap, so the
 * caller gets everything in scope (the list endpoint caps at 200).
 *
 * No filter params → all invoices (status rollover applied first).
 * With filter params → only matching rows.
 */
export async function GET(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  // Default to "all" (not "unpaid" like the list endpoint) so calling the
  // export with no params returns everything — matches the "export without
  // filter = all data" expectation.
  const tab = sp.get("tab") || "all";
  const type = sp.get("type") || "all";
  const cardFilter = sp.get("cardFilter") || "";
  const search = sp.get("search") || "";
  const bankFilter = sp.get("bank") || "all";

  const UNPAID_STATUSES = ["DRAFT", "INITIATED", "PENDING", "PARTIALLY_PAID", "DEPOSIT_PAID", "OVERDUE"];

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86400000);

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
  const notPlaceholder: Prisma.InvoiceWhereInput = { NOT: pendingInvoiceWhere };

  const where: Record<string, unknown> = {};
  if (cardFilter === "paid") where.status = "PAID";
  else if (cardFilter === "overdue") { where.OR = overdueOr; Object.assign(where, notPlaceholder); }
  else if (cardFilter === "initiated") where.status = "INITIATED";
  else if (cardFilter === "pending") { where.status = "PENDING"; Object.assign(where, notPlaceholder); }
  else if (cardFilter === "pending_invoice") Object.assign(where, pendingInvoiceWhere);
  else if (cardFilter === "payable") { where.status = { in: UNPAID_STATUSES }; Object.assign(where, notPlaceholder); }
  else if (cardFilter === "due_today") {
    where.status = { in: UNPAID_STATUSES };
    where.dueDate = { gte: todayStart, lt: todayEnd };
    Object.assign(where, notPlaceholder);
  } else if (tab === "unpaid") { where.status = { in: UNPAID_STATUSES }; Object.assign(where, notPlaceholder); }
  else if (tab === "paid") where.status = "PAID";
  else if (tab !== "all") { Object.assign(where, notPlaceholder); }

  if (type === "supplier") {
    where.paymentType = "SUPPLIER";
    where.order = { orderType: { not: "PAYMENT_REQUEST" } };
  } else if (type === "staff_claim") where.paymentType = "STAFF_CLAIM";
  else if (type === "transfer") where.paymentType = "INTERNAL_TRANSFER";
  else if (type === "payment_request") where.order = { orderType: "PAYMENT_REQUEST" };

  const outletIds = sp.getAll("outlet").filter(Boolean);
  if (outletIds.length === 1) where.outletId = outletIds[0];
  else if (outletIds.length > 1) where.outletId = { in: outletIds };

  const supplierIds = sp.getAll("supplier").filter(Boolean);
  if (supplierIds.length === 1) where.supplierId = supplierIds[0];
  else if (supplierIds.length > 1) where.supplierId = { in: supplierIds };

  const dueDateFrom = sp.get("dueDateFrom") || "";
  const dueDateTo = sp.get("dueDateTo") || "";
  if (dueDateFrom || dueDateTo) {
    const f: Record<string, Date> = {};
    if (dueDateFrom) f.gte = new Date(dueDateFrom);
    if (dueDateTo) f.lte = new Date(dueDateTo + "T23:59:59Z");
    where.dueDate = f;
  }

  const paidDateFrom = sp.get("paidDateFrom") || "";
  const paidDateTo = sp.get("paidDateTo") || "";
  if (paidDateFrom || paidDateTo) {
    const f: Record<string, Date> = {};
    if (paidDateFrom) f.gte = new Date(paidDateFrom);
    if (paidDateTo) f.lte = new Date(paidDateTo + "T23:59:59Z");
    where.paidAt = f;
  }

  if (search) {
    where.OR = [
      { invoiceNumber: { contains: search, mode: "insensitive" } },
      { supplier: { name: { contains: search, mode: "insensitive" } } },
      { outlet: { name: { contains: search, mode: "insensitive" } } },
      { order: { orderNumber: { contains: search, mode: "insensitive" } } },
    ];
  }

  // Same status rollover the list endpoint runs, so the export reflects
  // the same world view.
  await prisma.invoice.updateMany({
    where: { status: "PENDING", dueDate: { lt: todayStart } },
    data: { status: "OVERDUE" },
  });

  const invoices = await prisma.invoice.findMany({
    where,
    select: {
      invoiceNumber: true,
      amount: true,
      amountPaid: true,
      status: true,
      issueDate: true,
      dueDate: true,
      deliveryDate: true,
      paidAt: true,
      paidVia: true,
      paymentRef: true,
      popShortLink: true,
      paymentType: true,
      expenseCategory: true,
      notes: true,
      vendorName: true,
      vendorBankName: true,
      vendorBankAccountNumber: true,
      vendorBankAccountName: true,
      depositPercent: true,
      depositAmount: true,
      depositPaidAt: true,
      depositRef: true,
      photos: true,
      flags: true,
      order: {
        select: {
          orderNumber: true,
          orderType: true,
          claimedBy: { select: { name: true, bankName: true, bankAccountNumber: true, bankAccountName: true } },
        },
      },
      outlet: { select: { name: true } },
      supplier: { select: { name: true, phone: true, bankName: true, bankAccountNumber: true, bankAccountName: true, paymentTerms: true } },
    },
    orderBy: [
      { paidAt: { sort: "desc", nulls: "last" } },
      { issueDate: "desc" },
    ],
  });

  // Bank filter is applied here because the list endpoint historically
  // did it client-side. STAFF_CLAIM uses claimant bank, everything else
  // uses supplier bank.
  const filtered = bankFilter === "all"
    ? invoices
    : invoices.filter((inv) => {
        const bankName = (inv.paymentType === "STAFF_CLAIM"
          ? inv.order?.claimedBy?.bankName
          : inv.supplier?.bankName) ?? "";
        const has = bankName.toLowerCase().includes("maybank");
        return bankFilter === "maybank" ? has : !has;
      });

  const n = (v: unknown): number =>
    typeof v === "object" && v !== null && "toNumber" in v
      ? (v as { toNumber: () => number }).toNumber()
      : Number(v ?? 0);
  const d = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : "");

  type Flag = { code: string; message: string; dismissed?: boolean };
  const FLAG_TITLE: Record<string, string> = {
    DUPLICATE_PO: "Duplicate PO",
    DUPLICATE_PAYMENT_REF: "Payment ref already used",
    REF_MATCHES_PAID_INVOICE: "Reference matches paid invoice",
    AMOUNT_TOLERANCE_MATCH: "Amount matched only within tolerance",
    BANK_MISMATCH: "POP bank ≠ supplier bank",
  };

  const rows = filtered.map((inv) => {
    const amount = n(inv.amount);
    const amountPaid = n(inv.amountPaid);
    const useClaimantBank = inv.paymentType === "STAFF_CLAIM";
    const bank = useClaimantBank
      ? {
          bankName: inv.order?.claimedBy?.bankName ?? "",
          accountNumber: inv.order?.claimedBy?.bankAccountNumber ?? "",
          accountName: inv.order?.claimedBy?.bankAccountName ?? "",
        }
      : {
          bankName: inv.supplier?.bankName ?? "",
          accountNumber: inv.supplier?.bankAccountNumber ?? "",
          accountName: inv.supplier?.bankAccountName ?? "",
        };
    const activeFlags = ((inv.flags ?? []) as unknown as Flag[]).filter((f) => !f.dismissed);
    const isPendingInvoice =
      inv.paymentType === "SUPPLIER"
      && (inv.invoiceNumber?.startsWith("INV-") ?? false)
      && inv.dueDate === null
      && inv.status === "PENDING";
    return {
      "Invoice #":     inv.invoiceNumber ?? "",
      "PO Number":     inv.order?.orderNumber ?? "",
      Outlet:          inv.outlet?.name ?? "",
      Supplier:        inv.supplier?.name ?? "",
      Vendor:          inv.vendorName ?? "",
      Type:            inv.paymentType,
      "Order Type":    inv.order?.orderType ?? "",
      "Expense Category": inv.expenseCategory,
      Status:          inv.status,
      "Pending Invoice (GRNI)": isPendingInvoice ? "Yes" : "",
      "Amount (RM)":   amount,
      "Amount Paid (RM)": amountPaid,
      "Outstanding (RM)": Math.max(0, amount - amountPaid),
      "Issue date":    d(inv.issueDate),
      "Due date":      d(inv.dueDate),
      "Delivery date": d(inv.deliveryDate),
      "Paid at":       d(inv.paidAt),
      "Paid via":      inv.paidVia ?? "",
      "Payment ref":   inv.paymentRef ?? "",
      "Claimed by":    inv.order?.claimedBy?.name ?? "",
      "Deposit %":     inv.depositPercent ?? "",
      "Deposit (RM)":  inv.depositAmount == null ? "" : n(inv.depositAmount),
      "Deposit paid at": d(inv.depositPaidAt),
      "Deposit ref":   inv.depositRef ?? "",
      "Supplier phone": inv.supplier?.phone ?? "",
      "Supplier terms": inv.supplier?.paymentTerms ?? "",
      "Bank name":     bank.bankName,
      "Account number": bank.accountNumber,
      "Account name":  bank.accountName,
      "Photo count":   inv.photos?.length ?? 0,
      "POP link":      inv.popShortLink ?? "",
      Flags:           activeFlags.map((f) => FLAG_TITLE[f.code] ?? f.code).join("; "),
      Notes:           inv.notes ?? "",
    };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Invoices");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const filename = `invoices-${d(now)}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
