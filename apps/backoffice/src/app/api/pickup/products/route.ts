import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";

// GET /api/pickup/products
// Maps the loyalty app's products table schema to the backoffice DbProduct interface.
export async function GET() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("products")
    .select("id, name, category, price, image_url, is_available, is_featured, modifiers, track_stock, synced_at")
    .eq("brand_id", "brand-celsius")
    .order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Map loyalty schema -> DbProduct shape expected by the menu page
  const mapped = (data ?? []).map((p, i) => ({
    id:           p.id,
    category_id:  p.category ?? "",
    name:         p.name,
    description:  "",
    base_price:   Math.round((p.price as number) * 100),  // RM -> sen
    image:        (p.image_url as string) ?? "",
    image_zoom:   100,
    is_available: p.is_available ?? true,
    is_popular:   p.is_featured ?? false,
    is_new:       false,
    variants:     [],
    modifiers:    Array.isArray(p.modifiers) ? p.modifiers : [],
    position:     i + 1,
  }));

  return NextResponse.json(mapped);
}

// POST /api/pickup/products — create
export async function POST(request: NextRequest) {
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

  const { data, error } = await supabase
    .from("products")
    .insert({
      id,
      brand_id:    "brand-celsius",
      name:        body.name,
      description: body.description ?? "",
      category:    body.category_id ?? "",
      price:       body.base_price_rm,
      image_url:   body.image ?? "",
      is_available: body.is_available ?? true,
      is_featured:  body.is_popular ?? false,
      modifiers:    body.modifiers ?? [],
    })
    .select("id, name, category, price, image_url, is_available, is_featured, modifiers")
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
    position:     999,
  };

  return NextResponse.json(mapped, { status: 201 });
}
