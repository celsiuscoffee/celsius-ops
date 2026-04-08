import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const tab = req.nextUrl.searchParams.get("tab") || "unpaid";
  const search = req.nextUrl.searchParams.get("search") || "";

  const UNPAID_STATUSES = ["PENDING", "OVERDUE"];

  const where: Record<string, unknown> = {};
  if (tab === "unpaid") where.status = { in: UNPAID_STATUSES };
  else if (tab === "paid") where.status = "PAID";

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
      order: { select: { orderNumber: true } },
      outlet: { select: { name: true } },
      supplier: { select: { name: true } },
    },
    orderBy: { issueDate: "desc" },
  });

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
    notes: inv.notes,
  }));

  return NextResponse.json(mapped);
}
