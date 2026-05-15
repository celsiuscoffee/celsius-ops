import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/loyalty/supabase";
import { requireAuth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const brandId = new URL(request.url).searchParams.get("brand_id");
  if (!brandId) return NextResponse.json({ error: "brand_id is required" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("voucher_templates")
    .select("*")
    .eq("brand_id", brandId)
    .order("category", { ascending: true })
    .order("title", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const body = await request.json();
  if (!body.brand_id || !body.title || !body.description || !body.category) {
    return NextResponse.json({ error: "missing required fields" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("voucher_templates")
    .insert({
      brand_id: body.brand_id,
      title: body.title,
      description: body.description,
      icon: body.icon ?? "ticket",
      category: body.category,
      discount_type: body.discount_type,
      discount_value: body.discount_value,
      max_discount_value: body.max_discount_value,
      multiplier_value: body.multiplier_value,
      min_order_value: body.min_order_value,
      applicable_categories: body.applicable_categories,
      applicable_products: body.applicable_products,
      free_product_ids: body.free_product_ids,
      free_product_name: body.free_product_name,
      fulfillment_type: body.fulfillment_type,
      outlets_allowlist: body.outlets_allowlist,
      stacks_with_beans: body.stacks_with_beans ?? true,
      stacks_with_other: body.stacks_with_other ?? false,
      validity_days: body.validity_days ?? 14,
      is_active: body.is_active ?? true,
      reward_kind_id: body.reward_kind_id ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const body = await request.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("voucher_templates")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { error } = await supabaseAdmin.from("voucher_templates").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
