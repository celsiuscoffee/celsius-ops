import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireAuth } from "@/lib/auth";

// GET /api/pickup/products
// Maps the loyalty app's products table schema to the backoffice DbProduct interface.
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("products")
    .select("id, name, category, price, image_url, is_available, is_featured, modifiers, hidden_modifier_ids, track_stock, synced_at, position, featured_position")
    .eq("brand_id", "brand-celsius")
    .order("category")
    .order("position")
    .order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const mapped = (data ?? []).map((p) => ({
    id:           p.id,
    category_id:  p.category ?? "",
    name:         p.name,
    description:  "",
    base_price:   Math.round((p.price as number) * 100),
    image:        (p.image_url as string) ?? "",
    image_zoom:   100,
    is_available: p.is_available ?? true,
    is_popular:   p.is_featured ?? false,
    is_new:       false,
    variants:     [],
    modifiers:    Array.isArray(p.modifiers) ? p.modifiers : [],
    hidden_modifier_ids: Array.isArray(p.hidden_modifier_ids) ? p.hidden_modifier_ids : [],
    position:     (p.position as number) ?? 9999,
    featured_position: (p.featured_position as number) ?? 9999,
  }));

  // Also fetch categories so the menu page can group/filter by category
  const { data: catData } = await supabase
    .from("categories")
    .select("id, name, slug, position")
    .order("position");

  return NextResponse.json({
    products: mapped,
    categories: catData ?? [],
  });
}

// POST /api/pickup/products — create
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  const body = await request.json() as {
    id?: string;
    category_id?: string;
    name: string;
    description?: string;
    base_price_rm: number;
    image?: string;
    is_available?: boolean;
    is_popular?: boolean;
    modifiers?: unknown[];
  };

  const supabase = getSupabaseAdmin();

  const id = body.id || body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const category = body.category_id ?? "";

  const { data: maxRow } = await supabase
    .from("products")
    .select("position")
    .eq("brand_id", "brand-celsius")
    .eq("category", category)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPosition = ((maxRow?.position as number | undefined) ?? 0) + 1;

  const { data, error } = await supabase
    .from("products")
    .insert({
      id,
      brand_id:    "brand-celsius",
      name:        body.name,
      description: body.description ?? "",
      category,
      price:       body.base_price_rm,
      image_url:   body.image ?? "",
      is_available: body.is_available ?? true,
      is_featured:  body.is_popular ?? false,
      modifiers:    body.modifiers ?? [],
      position:     nextPosition,
    })
    .select("id, name, category, price, image_url, is_available, is_featured, modifiers, position")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const mapped = {
    id:           (data as Record<string,unknown>).id,
    category_id:  (data as Record<string,unknown>).category ?? "",
    name:         (data as Record<string,unknown>).name,
    description:  "",
    base_price:   Math.round(((data as Record<string,unknown>).price as number) * 100),
    image:        (data as Record<string,unknown>).image_url ?? "",
    image_zoom:   100,
    is_available: (data as Record<string,unknown>).is_available ?? true,
    is_popular:   (data as Record<string,unknown>).is_featured ?? false,
    is_new:       false,
    variants:     [],
    modifiers:    Array.isArray((data as Record<string,unknown>).modifiers) ? (data as Record<string,unknown>).modifiers : [],
    position:     ((data as Record<string,unknown>).position as number) ?? nextPosition,
    featured_position: 9999,
  };

  return NextResponse.json(mapped, { status: 201 });
}
