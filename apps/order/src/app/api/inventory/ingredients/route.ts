import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("ingredients")
    .select("*, ingredient_categories(name, sort_order)")
    .eq("is_active", true)
    .order("ingredient_categories(sort_order)", { ascending: true })
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const supabase = getSupabaseAdmin();
  const body = await req.json() as {
    name: string;
    category_id: string;
    unit: string;
    avg_unit_cost?: number;
    par_level?: number;
    notes?: string;
  };

  const { data, error } = await supabase
    .from("ingredients")
    .insert({
      name:          body.name,
      category_id:   body.category_id,
      unit:          body.unit,
      avg_unit_cost: body.avg_unit_cost ?? 0,
      par_level:     body.par_level ?? 0,
      notes:         body.notes ?? null,
      is_active:     true,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

export async function PATCH(req: NextRequest) {
  const supabase = getSupabaseAdmin();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const body = await req.json();
  const { error } = await supabase
    .from("ingredients")
    .update(body)
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const supabase = getSupabaseAdmin();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { error } = await supabase
    .from("ingredients")
    .update({ is_active: false })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
