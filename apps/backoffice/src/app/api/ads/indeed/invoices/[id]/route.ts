import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// PATCH /api/ads/indeed/invoices/[id]
// Updates invoice fields — most commonly status (paid/unpaid).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireRole(req.headers, "ADMIN", "OWNER");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({})) as Partial<{
    invoiceNumber: string | null;
    issueDate:     string;
    periodStart:   string;
    periodEnd:     string;
    amountUsd:     number | string;
    amountMyr:     number | string | null;
    status:        string;
    pdfUrl:        string | null;
    notes:         string | null;
  }>;

  const data: Record<string, unknown> = {};
  if ("invoiceNumber" in body) data.invoiceNumber = body.invoiceNumber;
  if (body.issueDate)   data.issueDate   = new Date(body.issueDate);
  if (body.periodStart) data.periodStart = new Date(body.periodStart);
  if (body.periodEnd)   data.periodEnd   = new Date(body.periodEnd);
  if (body.amountUsd != null) data.amountUsd = typeof body.amountUsd === "string" ? body.amountUsd : body.amountUsd.toString();
  if ("amountMyr" in body)    data.amountMyr = body.amountMyr == null ? null : (typeof body.amountMyr === "string" ? body.amountMyr : body.amountMyr.toString());
  if (body.status) data.status = body.status;
  if ("pdfUrl" in body) data.pdfUrl = body.pdfUrl;
  if ("notes"  in body) data.notes  = body.notes;

  const updated = await prisma.indeedAdsInvoice.update({ where: { id }, data });
  return NextResponse.json({ invoice: updated });
}

// DELETE /api/ads/indeed/invoices/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireRole(req.headers, "ADMIN", "OWNER");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  await prisma.indeedAdsInvoice.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
