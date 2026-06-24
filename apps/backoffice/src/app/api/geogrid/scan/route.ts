import { NextRequest, NextResponse } from "next/server";
import { getUserFromHeaders } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runScan, GeoScanError } from "@/lib/geogrid/scan-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/geogrid/scan?outletId=...&keyword=... — recent scans (with points) for trend.
export async function GET(request: NextRequest) {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const outletId = url.searchParams.get("outletId");
  const keyword = url.searchParams.get("keyword");
  if (!outletId) return NextResponse.json({ error: "outletId required" }, { status: 400 });

  const scans = await prisma.geoGridScan.findMany({
    where: { outletId, ...(keyword ? { keyword } : {}) },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  return NextResponse.json({ scans, keyConfigured: !!process.env.GOOGLE_PLACES_API_KEY });
}

// POST /api/geogrid/scan — run a fresh grid scan.
// Body: { outletId, keyword, gridSize?=9, rangeMiles?=0.1 }
export async function POST(request: NextRequest) {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_PLACES_API_KEY not configured — set it + enable Places API on project 23036 to run scans." },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const outletId: string = body.outletId;
  const keyword: string = (body.keyword || "").trim();
  const gridSize: number = [5, 7, 9, 11, 13].includes(body.gridSize) ? body.gridSize : 9;
  const rangeMiles: number = typeof body.rangeMiles === "number" && body.rangeMiles > 0 ? body.rangeMiles : 0.1;
  if (!outletId || !keyword) {
    return NextResponse.json({ error: "outletId and keyword required" }, { status: 400 });
  }

  try {
    const { scan, failures } = await runScan({
      outletId,
      keyword,
      gridSize,
      rangeMiles,
      apiKey,
      createdBy: user.name || user.id,
    });
    return NextResponse.json({ scan, failures });
  } catch (err) {
    if (err instanceof GeoScanError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[geogrid] scan failed:", err);
    return NextResponse.json({ error: "Scan failed" }, { status: 500 });
  }
}
