import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("suppliers")
    .select("*")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const supabase = getSupabaseAdmin();
  const body = await req.json() as {
    name:          string;
    contact_name?: string;
    phone?:        string;
    email?:        string;
    address?:      string;
    notes?:        string;
  };

  if (!body.name) return NextResponse.json({ error: "Missing name" }, { status: 400 });

  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      name:         body.name,
      contact_name: body.contact_name ?? null,
      phone:        body.phone        ?? null,
      email:        body.email        ?? null,
      address:      body.address      ?? null,
      notes:        body.notes        ?? null,
      is_active:    true,
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
  const { error } = await supabase.from("suppliers").update(body).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const supabase = getSupabaseAdmin();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { error } = await supabase
    .from("suppliers")
    .update({ is_active: false })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
