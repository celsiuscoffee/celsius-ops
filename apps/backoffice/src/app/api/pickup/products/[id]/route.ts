import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";

// PATCH /api/pickup/products/[id]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;

  const update: Record<string, unknown> = {};

  if (typeof body.base_price_rm === "number") {
    update.price = body.base_price_rm;
  }
  if (typeof body.name === "string")         update.name         = body.name;
  if (typeof body.description === "string")  update.description  = body.description;
  if (typeof body.category_id === "string")  update.category     = body.category_id;
  if (typeof body.image === "string")        update.image_url    = body.image;
  if (typeof body.is_available === "boolean") update.is_available = body.is_available;
  if (typeof body.is_popular === "boolean")  update.is_featured  = body.is_popular;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("products")
    .update(update)
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/pickup/products/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("products").delete().eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
