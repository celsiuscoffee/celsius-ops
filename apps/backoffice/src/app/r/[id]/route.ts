import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /r/[id]
 *
 * Short-link resolver. Redirects to the underlying Cloudinary URL,
 * but PROXIES PDFs so we can force the correct `application/pdf`
 * content-type. Cloudinary serves `raw` uploads (which is how our
 * Telegram webhook stores PDFs) with `application/octet-stream`, and
 * some browsers then render them as garbled text instead of opening
 * the PDF viewer.
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

  // Fast path: images and obvious non-PDFs → 302 to Cloudinary directly.
  // Anything served from the `/raw/` namespace or without a recognised
  // image extension gets proxied with sniffed content-type.
  const isRaw = /\/raw\/upload\//i.test(link.url);
  const hasImageExt = /\.(jpe?g|png|webp|gif|heic|avif)(\?|$)/i.test(link.url);
  if (!isRaw && hasImageExt) {
    return NextResponse.redirect(link.url, 302);
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

  // Sniff the first bytes to detect PDFs regardless of upstream content-type.
  const buf = new Uint8Array(await upstream.arrayBuffer());
  const isPdf = buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF

  const upstreamType = upstream.headers.get("content-type") || "";
  const contentType = isPdf
    ? "application/pdf"
    : upstreamType || "application/octet-stream";

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(buf.byteLength),
      // Inline so browsers render the PDF instead of downloading it
      "Content-Disposition": `inline; filename="${id}${isPdf ? ".pdf" : ""}"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
