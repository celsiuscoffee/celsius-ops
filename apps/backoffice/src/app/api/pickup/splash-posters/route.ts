import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireAuth } from "@/lib/auth";

// GET /api/pickup/splash-posters — list all (admin view)
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("splash_posters")
    .select("*")
    .eq("brand_id", "brand-celsius")
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ posters: data ?? [] });
}

// POST /api/pickup/splash-posters — create new
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const body = await request.json();
  const supabase = getSupabaseAdmin();

  // Placement gates which surfaces the poster appears on:
  //   'splash' = launch-screen only, 'home' = home carousel only,
  //   'both'   = legacy default, posted to either.
  const placement: "splash" | "home" | "both" =
    body.placement === "splash" || body.placement === "home"
      ? body.placement
      : "both";

  const { data, error } = await supabase
    .from("splash_posters")
    .insert({
      brand_id:    "brand-celsius",
      image_url:   body.imageUrl,
      title:       body.title ?? null,
      deeplink:    body.deeplink ?? null,
      duration_ms: body.durationMs ?? 2500,
      active:      Boolean(body.active),
      starts_at:   body.startsAt ?? null,
      ends_at:     body.endsAt ?? null,
      placement,
    } as Record<string, unknown>)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ poster: data });
}

// PATCH /api/pickup/splash-posters?id=xxx — update existing
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const body = await request.json();
  const supabase = getSupabaseAdmin();

  const updates: Record<string, unknown> = {};
  if ("imageUrl"   in body) updates.image_url   = body.imageUrl;
  if ("title"      in body) updates.title       = body.title;
  if ("deeplink"   in body) updates.deeplink    = body.deeplink;
  if ("durationMs" in body) updates.duration_ms = body.durationMs;
  if ("active"     in body) updates.active      = Boolean(body.active);
  if ("startsAt"   in body) updates.starts_at   = body.startsAt;
  if ("endsAt"     in body) updates.ends_at     = body.endsAt;
  if ("placement"  in body && (body.placement === "splash" || body.placement === "home" || body.placement === "both")) {
    updates.placement = body.placement;
  }

  const { data, error } = await supabase
    .from("splash_posters")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ poster: data });
}

// DELETE /api/pickup/splash-posters?id=xxx
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("splash_posters").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
