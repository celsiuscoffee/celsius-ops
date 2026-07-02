import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const DEFAULT_FIELDS = [
  { question: "Name", type: "short_text", required: true, active: true },
  { question: "Phone", type: "phone", required: true, active: true },
  { question: "Feedback", type: "paragraph", required: false, active: true },
];

// GET /api/reviews/public-settings?outletId=xxx — the QR review page's data,
// PUBLIC by design: customers scanning the QR are anonymous. This is the fix
// for the dead Google redirect + empty feedback form — the page previously
// called the auth-gated /api/reviews/settings and always got a 401, so it
// never saw googleReviewUrl, the threshold, or the feedback fields.
// Exposes only customer-safe fields; never writes.
export async function GET(request: NextRequest) {
  const outletId = request.nextUrl.searchParams.get("outletId");
  if (!outletId) return NextResponse.json({ error: "outletId required" }, { status: 400 });

  const outlet = await prisma.outlet.findUnique({
    where: { id: outletId },
    select: { name: true, status: true, reviewSettings: true },
  });
  if (!outlet) return NextResponse.json({ error: "Outlet not found" }, { status: 404 });

  const s = outlet.reviewSettings;
  const fields = Array.isArray(s?.feedbackFields) && (s.feedbackFields as unknown[]).length > 0
    ? s.feedbackFields
    : DEFAULT_FIELDS;

  return NextResponse.json({
    outletName: outlet.name,
    ratingThreshold: s?.ratingThreshold ?? 4,
    googleReviewUrl: s?.googleReviewUrl ?? null,
    heading: s?.heading ?? null,
    description: s?.description ?? null,
    logoUrl: s?.logoUrl ?? null,
    feedbackFields: fields,
  });
}
