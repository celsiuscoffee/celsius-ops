import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const tab = req.nextUrl.searchParams.get("tab") || "unpaid";
  const search = req.nextUrl.searchParams.get("search") || "";

  const UNPAID_STATUSES = ["DRAFT", "INITIATED", "PENDING", "OVERDUE"];

  const type = req.nextUrl.searchParams.get("type") || "all";

  const where: Record<string, unknown> = {};
  if (tab === "unpaid") where.status = { in: UNPAID_STATUSES };
  else if (tab === "paid") where.status = "PAID";

  if (type === "supplier") where.paymentType = { not: "STAFF_CLAIM" };
  else if (type === "staff_claim") where.paymentType = "STAFF_CLAIM";

  const outletId = req.nextUrl.searchParams.get("outlet") || "";
  if (outletId) where.outletId = outletId;

  const dueDateFrom = req.nextUrl.searchParams.get("dueDateFrom") || "";
  const dueDateTo = req.nextUrl.searchParams.get("dueDateTo") || "";
  if (dueDateFrom || dueDateTo) {
    const dueDateFilter: Record<string, Date> = {};
    if (dueDateFrom) dueDateFilter.gte = new Date(dueDateFrom);
    if (dueDateTo) dueDateFilter.lte = new Date(dueDateTo + "T23:59:59Z");
    where.dueDate = dueDateFilter;
  }

  if (search) {
    where.OR = [
      { invoiceNumber: { contains: search, mode: "insensitive" } },
      { supplier: { name: { contains: search, mode: "insensitive" } } },
      { outlet: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

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
      claimedById: true,
      order: { select: { orderNumber: true, claimedBy: { select: { name: true } } } },
      outlet: { select: { name: true } },
      supplier: { select: { name: true } },
    },
    orderBy: { issueDate: "desc" },
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
    supplier: inv.supplier.name,
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
  }));

  return NextResponse.json({ invoices: mapped, outlets, dueTodayCount, dueTodayAmount });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orderId, outletId, supplierId, amount, invoiceNumber, dueDate, photos } = body;

    if (!outletId || !supplierId) {
      return NextResponse.json({ error: "outletId and supplierId are required" }, { status: 400 });
    }

    // Generate invoice number if not provided
    let invNumber = invoiceNumber;
    if (!invNumber) {
      const invCount = await prisma.invoice.count();
      invNumber = `INV-${String(invCount + 1).padStart(4, "0")}`;
    }

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: invNumber,
        orderId: orderId || null,
        outletId,
        supplierId,
        amount: amount ?? 0,
        status: "PENDING",
        dueDate: dueDate ? new Date(dueDate) : null,
        photos: photos || [],
      },
    });

    return NextResponse.json(invoice, { status: 201 });
  } catch (err) {
    console.error("[invoices POST]", err);
    const message = err instanceof Error ? err.message : "Failed to create invoice";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
