import { NextResponse } from "next/server";
import { selectHomePosters } from "@/lib/poster/select-home";

// Public endpoint — no auth, called by the native app's home page on mount.
// Returns the tight, day-part-windowed home carousel (same selector the web
// home uses, so the two surfaces never drift). Cached 60s on the edge.
export const revalidate = 60;

export async function GET() {
  try {
    const picks = await selectHomePosters({ limit: 3 });
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
