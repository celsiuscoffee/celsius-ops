import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireAuth, hasModulePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Backoffice-side wrapper around the shared `app_settings` table.
// Read endpoint is open to admins; PUT writes back via service role.
// Same table the order app reads from at /api/settings — single source of truth.

// GET /api/settings?key=sst
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const key = request.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .single();

  if (error || !data) return NextResponse.json(null);
  return NextResponse.json(data.value);
}

// PUT /api/settings — body: { key, value }
export async function PUT(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  // app_settings carries payments_enabled / min_app_version / points_per_rm —
  // OWNER/ADMIN, or a manager granted one of the pages that edit it.
  const allowed =
    (await hasModulePermission(auth.user, "pickup:settings", prisma)) ||
    (await hasModulePermission(auth.user, "loyalty:rewards", prisma)) ||
    (await hasModulePermission(auth.user, "settings:integrations", prisma));
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { key, value } = await request.json();
    if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("app_settings")
      .upsert(
        { key, value, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("backoffice settings PUT error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
