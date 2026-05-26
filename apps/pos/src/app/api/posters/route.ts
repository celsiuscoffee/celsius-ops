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

export async function GET() {
  try {
    const supabase = getClient();
    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
      .from("splash_posters")
      .select("id, image_url, title, deeplink, duration_ms, starts_at, ends_at, sort_order")
      .eq("brand_id", "brand-celsius")
      .eq("placement", "pos-display")
      .eq("active", true)
      .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
      .or(`ends_at.is.null,ends_at.gte.${nowIso}`)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("[POSTERS] query error:", error);
      return NextResponse.json({ posters: [] });
    }

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
