import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { popDownloadName, invoiceDownloadName } from "@/lib/inventory/file-naming";

/**
 * GET /r/[id]
 *
 * Short-link resolver. Proxies PDFs so we can force `application/pdf`
 * and a human-readable Content-Disposition filename (`POP_26-0374_Blancoz_RM240.00.pdf`
 * instead of `f1bb4eff.pdf`). Images 302 to Cloudinary with an
 * `fl_attachment` transformation so they also download with a proper name.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const link = await prisma.shortLink.findUnique({ where: { id } });
  if (!link) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Look up the linked invoice for filename metadata. Either the shortlink is
  // the POP (stored on Invoice.popShortLink) or it's an invoice photo.
  const popHost = `/r/${id}`;
  const invoice = await prisma.invoice.findFirst({
    where: {
      OR: [
        { popShortLink: { endsWith: popHost } },
        { photos: { has: link.url } },
      ],
    },
    select: {
      invoiceNumber: true,
      amount: true,
      paidAt: true,
      popShortLink: true,
      photos: true,
      supplier: { select: { name: true } },
      vendorName: true,
      order: { select: { claimedBy: { select: { name: true } } } },
    },
  });

  const isPopLink = invoice?.popShortLink?.endsWith(popHost) ?? false;

  const isRaw = /\/raw\/upload\//i.test(link.url);
  const hasImageExt = /\.(jpe?g|png|webp|gif|heic|avif)(\?|$)/i.test(link.url);

  // Build the download filename (falls back to the shortlink id if no invoice match).
  function buildName(ext: "pdf" | "jpg"): string {
    if (!invoice) return `${id}.${ext}`;
    return isPopLink ? popDownloadName(invoice, ext) : invoiceDownloadName(invoice, ext);
  }

  // Image fast path: 302 to Cloudinary with fl_attachment so the download
  // filename is set by Cloudinary itself (no proxy overhead).
  if (!isRaw && hasImageExt) {
    const name = buildName("jpg");
    const target = link.url.replace(
      /\/image\/upload\//,
      `/image/upload/fl_attachment:${encodeURIComponent(name.replace(/\.[^.]+$/, ""))}/`,
    );
    return NextResponse.redirect(target, 302);
  }

  let upstream: Response;
  try {
    upstream = await fetch(link.url);
  } catch (err) {
    console.error("[shortlink] upstream fetch failed:", err);
    return new NextResponse("Upstream unavailable", { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return new NextResponse("Upstream error", { status: upstream.status || 502 });
  }

  const buf = new Uint8Array(await upstream.arrayBuffer());
  const isPdf = buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF

  const upstreamType = upstream.headers.get("content-type") || "";
  const contentType = isPdf ? "application/pdf" : upstreamType || "application/octet-stream";
  const filename = buildName(isPdf ? "pdf" : "jpg");

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(buf.byteLength),
      // Inline so browsers render PDFs in-tab; the filename kicks in on download.
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
