import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/posters
 *
 * Active POS customer-display posters, filtered by the schedule window
 * (active=true AND now ∈ [starts_at, ends_at] when present), sorted by
 * sort_order. Shape matches the pickup-native carousel so the client
 * component stays one definition.
 */

export const revalidate = 60; // cache 60s — posters change rarely

function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

// Current day-part round in MYT (UTC+8). Mirrors the canonical bands in
// backoffice sales/_lib/storehub-helpers.ts ROUNDS. Returns "" outside
// trading hours (before 08:00 / from 23:00) — then only round-less posters show.
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

export async function GET() {
  try {
    const supabase = getClient();
    const nowIso = new Date().toISOString();
    const round = currentRound();

    const { data, error } = await supabase
      .from("splash_posters")
      .select("id, image_url, title, deeplink, duration_ms, starts_at, ends_at, sort_order, round")
      .eq("brand_id", "brand-celsius")
      .eq("placement", "pos-display")
      .eq("active", true)
      .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
      .or(`ends_at.is.null,ends_at.gte.${nowIso}`)
      // Recurring day-part round: a round-less poster shows always; a tagged
      // poster only during its round (MYT). See currentRound() above.
      .or(round ? `round.is.null,round.eq.${round}` : "round.is.null")
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("[POSTERS] query error:", error);
      return NextResponse.json({ posters: [] });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
    const posters = (data ?? []).map((p: any) => ({
      id: p.id,
      imageUrl: p.image_url,
      title: p.title,
      deeplink: p.deeplink,
      durationMs: p.duration_ms ?? 4500,
    }));

    return NextResponse.json({ posters });
  } catch (err) {
    console.error("[POSTERS] error:", err);
    return NextResponse.json({ posters: [] });
  }
}
