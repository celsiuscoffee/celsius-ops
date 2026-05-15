import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireAuth } from "@/lib/auth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;

  const update: Record<string, unknown> = {};
  if (typeof body.position === "number" && Number.isFinite(body.position)) {
    update.position = Math.round(body.position);
  }
  if (typeof body.name === "string" && body.name.trim().length > 0) {
    update.name = body.name.trim();
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("categories")
    .update(update)
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
