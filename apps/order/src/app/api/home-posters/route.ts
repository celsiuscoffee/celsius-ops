import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// Public endpoint — no auth, called by the pickup app's home page on
// mount. Returns every currently-active poster for the brand whose
// schedule window includes now(), so the home hero can render an
// auto-rotating carousel. Splash on launch still uses /api/splash-poster
// (singular); this is the multi-result version for in-app surfacing.
//
// Cached for 60s on the edge — posters change infrequently and a small
// stale window beats hammering Supabase on every cold launch.
export const revalidate = 60;

export async function GET(request: NextRequest) {
  const brandId = request.nextUrl.searchParams.get("brand_id") ?? "brand-celsius";

  try {
    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("splash_posters")
      .select("id, image_url, title, deeplink, duration_ms, starts_at, ends_at")
      .eq("brand_id", brandId)
      .eq("active", true)
      // Home carousel only — splash posters stay on the launch screen.
      .eq("placement", "home")
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("home-posters fetch error:", error);
      return NextResponse.json({ posters: [] }, { status: 200 });
    }

    const posters = (data ?? [])
      .filter((p) => {
        const startOk = !p.starts_at || p.starts_at <= now;
        const endOk   = !p.ends_at   || p.ends_at   >= now;
        return startOk && endOk;
      })
      .map((p) => ({
        id:         p.id as string,
        imageUrl:   p.image_url as string,
        title:      (p.title as string | null) ?? null,
        deeplink:   (p.deeplink as string | null) ?? null,
        durationMs: (p.duration_ms as number | null) ?? 4500,
      }));

    return NextResponse.json({ posters });
  } catch (err) {
    console.error("home-posters route error:", err);
    return NextResponse.json({ posters: [] }, { status: 200 });
  }
}
