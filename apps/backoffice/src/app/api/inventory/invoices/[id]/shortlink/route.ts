import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { createShortLink } from "@/lib/shortlink";

// POST /api/inventory/invoices/[id]/shortlink
// Creates a shortlink for the invoice's last POP photo (if not already created)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: { id: true, popShortLink: true, photos: true },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  // Already has a shortlink
  if (invoice.popShortLink) {
    return NextResponse.json({ shortLink: invoice.popShortLink });
  }

  // No photos to link
  if (!invoice.photos || invoice.photos.length === 0) {
    return NextResponse.json({ error: "No POP photo to create shortlink for" }, { status: 400 });
  }

  // Create shortlink for the last photo (most recent POP)
  const popUrl = invoice.photos[invoice.photos.length - 1];
  const shortLink = await createShortLink(popUrl);

  // Save to invoice
  await prisma.invoice.update({
    where: { id },
    data: { popShortLink: shortLink },
  });

  return NextResponse.json({ shortLink });
}
