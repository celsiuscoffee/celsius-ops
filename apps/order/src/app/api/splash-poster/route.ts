import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// Public endpoint — no auth, called by the native app on launch.
// Returns the currently-active splash poster for the requested brand,
// or null if none. CDN-cacheable for 60s so we don't hammer Supabase
// every time the app cold-starts.
export const revalidate = 60;

// Current MYT day-part round (mirrors /api/home-posters & /api/pos/posters).
// A round-less poster shows always; a round-tagged poster only during its
// round — lets the autopilot schedule the launch splash by day-part.
function currentRound(): string {
  const h = (new Date().getUTCHours() + 8) % 24;
  if (h >= 8 && h < 10) return "breakfast";
  if (h >= 10 && h < 12) return "brunch";
  if (h >= 12 && h < 15) return "lunch";
  if (h >= 15 && h < 17) return "midday";
  if (h >= 17 && h < 19) return "evening";
  if (h >= 19 && h < 21) return "dinner";
  if (h >= 21 && h < 23) return "supper";
  return "";
}

export async function GET(request: NextRequest) {
  const brandId = request.nextUrl.searchParams.get("brand_id") ?? "brand-celsius";

  try {
    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();
    const round = currentRound();

    const { data, error } = await supabase
      .from("splash_posters")
      .select("id, image_url, deeplink, duration_ms, starts_at, ends_at, round, rounds")
      .eq("brand_id", brandId)
      .eq("active", true)
      // Splash surface only — home posters stay on the home carousel.
      .eq("placement", "splash")
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("splash-poster fetch error:", error);
      return NextResponse.json({ poster: null }, { status: 200 });
    }

    // Day-part window: shows when the current round is in `rounds`; empty falls
    // back to the legacy single `round` (null round = always-on).
    const inWindow = (p: { round: string | null; rounds: string[] | null }): boolean => {
      if (p.rounds && p.rounds.length) return round !== "" && p.rounds.includes(round);
      if (p.round) return p.round === round;
      return true;
    };

    // Pick the first active poster in-window whose schedule includes now()
    const poster = (data ?? []).find((p) => {
      const startOk = !p.starts_at || p.starts_at <= now;
      const endOk = !p.ends_at || p.ends_at >= now;
      return startOk && endOk && inWindow(p as { round: string | null; rounds: string[] | null });
    });

    return NextResponse.json({
      poster: poster
        ? {
            id: poster.id,
            imageUrl: poster.image_url,
            deeplink: poster.deeplink ?? null,
            durationMs: poster.duration_ms ?? 2500,
          }
        : null,
    });
  } catch (err) {
    console.error("splash-poster route error:", err);
    return NextResponse.json({ poster: null }, { status: 200 });
  }
}
