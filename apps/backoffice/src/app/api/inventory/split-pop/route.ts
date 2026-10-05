import { NextRequest, NextResponse } from "next/server";
import { getUserFromHeaders } from "@/lib/auth";
import { splitPdfFromUrl, getPdfPageCount } from "@/lib/inventory/pdf-splitter";
import { assertAllowedFetchUrl, DisallowedFetchUrlError } from "@/lib/safe-fetch-url";

// GET /api/inventory/split-pop?url=<pdf_url>
// Returns page count of a PDF
export async function GET(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 });
  // SSRF guard: only our storage hosts may be fetched server-side.
  try { assertAllowedFetchUrl(url); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }

  try {
    const pageCount = await getPdfPageCount(url);
    return NextResponse.json({ pageCount });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to read PDF";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/inventory/split-pop
// Split a multi-page PDF into individual pages stored in Supabase
// Body: { url: string, page?: number }
// If page is specified, extract only that page. Otherwise split all.
// Returns: { urls: string[] } or { url: string } for single page
export async function POST(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { url, page } = await req.json();
    if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 });
    try { assertAllowedFetchUrl(String(url)); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }

    const baseName = `pop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    if (page) {
      // Extract single page
      const { PDFDocument } = await import("pdf-lib");
      const { uploadToStorage } = await import("@/lib/inventory/pdf-splitter");

      const res = await fetch(url);
      if (!res.ok) return NextResponse.json({ error: "Failed to fetch PDF" }, { status: 500 });
      const buffer = Buffer.from(await res.arrayBuffer());

      const srcDoc = await PDFDocument.load(buffer);
      if (page > srcDoc.getPageCount()) {
        return NextResponse.json({ error: `Page ${page} exceeds PDF page count (${srcDoc.getPageCount()})` }, { status: 400 });
      }

      const newDoc = await PDFDocument.create();
      const [copiedPage] = await newDoc.copyPages(srcDoc, [page - 1]);
      newDoc.addPage(copiedPage);
      const bytes = await newDoc.save();

      const pageUrl = await uploadToStorage(
        Buffer.from(bytes),
        `pop/${baseName}-page${page}.pdf`,
        "application/pdf",
      );

      return NextResponse.json({ url: pageUrl, pageCount: srcDoc.getPageCount() });
    }

    // Split all pages
    const urls = await splitPdfFromUrl(url, baseName);
    return NextResponse.json({ urls, pageCount: urls.length });
  } catch (err) {
    if (err instanceof DisallowedFetchUrlError) return NextResponse.json({ error: err.message }, { status: 400 });
    const msg = err instanceof Error ? err.message : "Failed to split PDF";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
