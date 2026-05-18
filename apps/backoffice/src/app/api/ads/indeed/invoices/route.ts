import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/ads/indeed/invoices — list all Indeed invoices, newest first.
export async function GET(req: NextRequest) {
  try {
    await requireRole(req.headers, "ADMIN", "OWNER", "MANAGER");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const invoices = await prisma.indeedAdsInvoice.findMany({
    orderBy: { issueDate: "desc" },
  });
  return NextResponse.json({ invoices });
}

// POST /api/ads/indeed/invoices — create a new invoice.
// Body: { invoiceNumber?, issueDate, periodStart, periodEnd, amountUsd, amountMyr?, status?, pdfUrl?, notes? }
export async function POST(req: NextRequest) {
  try {
    await requireRole(req.headers, "ADMIN", "OWNER");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as null | {
    invoiceNumber?: string;
    issueDate:      string;
    periodStart:    string;
    periodEnd:      string;
    amountUsd:      number | string;
    amountMyr?:     number | string;
    status?:        string;
    pdfUrl?:        string;
    notes?:         string;
  };

  if (!body || !body.issueDate || !body.periodStart || !body.periodEnd || body.amountUsd == null) {
    return NextResponse.json({ error: "issueDate, periodStart, periodEnd, amountUsd required" }, { status: 400 });
  }

  const created = await prisma.indeedAdsInvoice.create({
    data: {
      invoiceNumber: body.invoiceNumber,
      issueDate:     new Date(body.issueDate),
      periodStart:   new Date(body.periodStart),
      periodEnd:     new Date(body.periodEnd),
      amountUsd:     typeof body.amountUsd === "string" ? body.amountUsd : body.amountUsd.toString(),
      amountMyr:     body.amountMyr != null ? (typeof body.amountMyr === "string" ? body.amountMyr : body.amountMyr.toString()) : null,
      status:        body.status ?? "unpaid",
      pdfUrl:        body.pdfUrl,
      notes:         body.notes,
    },
  });
  return NextResponse.json({ invoice: created });
}
