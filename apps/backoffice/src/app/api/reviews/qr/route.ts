import { NextRequest, NextResponse } from "next/server";
import { getUserFromHeaders } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/reviews/qr?outletId=xxx — returns QR data (URL + settings)
export async function GET(request: NextRequest) {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const outletId = request.nextUrl.searchParams.get("outletId");
  if (!outletId) return NextResponse.json({ error: "outletId required" }, { status: 400 });

  const settings = await prisma.reviewSettings.findUnique({ where: { outletId } });
  const outlet = await prisma.outlet.findUnique({ where: { id: outletId }, select: { name: true } });

  // Public review URL — the dedicated customer domain (middleware rewrites
  // review.celsiuscoffee.com/<outletId> → /review/<outletId>). Old QR codes
  // printed with backoffice.../review/<id> keep working.
  const baseUrl = process.env.NEXT_PUBLIC_REVIEW_URL || "https://review.celsiuscoffee.com";
  const reviewUrl = `${baseUrl}/${outletId}`;

  return NextResponse.json({
    url: reviewUrl,
    outletName: outlet?.name ?? "Unknown",
    ratingThreshold: settings?.ratingThreshold ?? 4,
    googleReviewUrl: settings?.googleReviewUrl ?? null,
    hasGoogleUrl: !!settings?.googleReviewUrl,
  });
}
