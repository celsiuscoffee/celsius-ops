import { NextRequest, NextResponse } from "next/server";
import { selectHomePosters } from "@/lib/poster/select-home";

// Public endpoint — no auth, called by the home carousel on mount. Returns the
// tight, day-part-windowed carousel (same selector the web home uses, so the
// two surfaces never drift). Pass ?member=<loyaltyId> to personalize (surface
// high-AOV items the member hasn't tried). Cached 60s per URL on the edge.
export const revalidate = 60;

export async function GET(request: NextRequest) {
  try {
    const memberId = request.nextUrl.searchParams.get("member");
    const picks = await selectHomePosters({ limit: 3, memberId });
    const posters = picks.map((p) => ({
      id: p.id,
      imageUrl: p.image_url,
      title: p.title,
      deeplink: p.deeplink,
      durationMs: p.duration_ms,
    }));
    return NextResponse.json({ posters });
  } catch (err) {
    console.error("home-posters route error:", err);
    return NextResponse.json({ posters: [] }, { status: 200 });
  }
}
