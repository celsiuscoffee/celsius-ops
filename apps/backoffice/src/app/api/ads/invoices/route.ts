import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireRole(req.headers, "ADMIN");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const year = url.searchParams.get("year");

  const where = year
    ? {
        issueDate: {
          gte: new Date(`${year}-01-01T00:00:00Z`),
          lt: new Date(`${Number(year) + 1}-01-01T00:00:00Z`),
        },
      }
    : {};

  const invoices = await prisma.adsInvoice.findMany({
    where,
    orderBy: { issueDate: "desc" },
    include: { account: { select: { descriptiveName: true, customerId: true } } },
  });

  const total = invoices.reduce((acc, i) => acc + Number(i.totalMicros) / 1_000_000, 0);
  const tax = invoices.reduce((acc, i) => acc + Number(i.taxMicros) / 1_000_000, 0);

  return NextResponse.json({
    invoices: invoices.map((i) => ({
      id: i.id,
      invoiceId: i.invoiceId,
      accountName: i.account.descriptiveName,
      issueDate: i.issueDate.toISOString().slice(0, 10),
      periodStart: i.billingPeriodStart.toISOString().slice(0, 10),
      periodEnd: i.billingPeriodEnd.toISOString().slice(0, 10),
      subtotalMYR: Number(i.subtotalMicros) / 1_000_000,
      taxMYR: Number(i.taxMicros) / 1_000_000,
      totalMYR: Number(i.totalMicros) / 1_000_000,
      currency: i.currencyCode,
      status: i.status,
      hasPdf: !!i.pdfStoragePath,
      pdfSizeBytes: i.pdfSizeBytes,
      pdfHash: i.pdfHashSha256,
    })),
    summary: { totalMYR: total, taxMYR: tax, count: invoices.length },
  });
}
