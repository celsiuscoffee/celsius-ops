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
    .select("id, name, category, price, image_url, is_available, is_featured, modifiers, hidden_modifier_ids, track_stock, synced_at, position, featured_position, print_additional_docket, e_invoice_classification_code, schedule_start_date, schedule_end_date, schedule_days_of_week, schedule_time_from, schedule_time_to, price_pickup, price_grab, price_foodpanda, price_dinein, tax_rate, tax_inclusive")
    .eq("brand_id", "brand-celsius")
    .order("category")
    .order("position")
    .order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const mapped = (data ?? []).map((p: any) => ({
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
    // StoreHub-parity fields.
    print_additional_docket:        p.print_additional_docket ?? false,
    e_invoice_classification_code:  p.e_invoice_classification_code ?? "",
    schedule_start_date:            p.schedule_start_date ?? null,
    schedule_end_date:              p.schedule_end_date ?? null,
    schedule_days_of_week:          Array.isArray(p.schedule_days_of_week) ? p.schedule_days_of_week : [],
    schedule_time_from:             p.schedule_time_from ?? null,
    schedule_time_to:               p.schedule_time_to ?? null,
    // Channel-specific pricing — nullable; null means "fall back to base price".
    // Stored as numeric(10,2) RM in DB (not sen) — keep RM here too for parity with base_price_rm.
    price_pickup:                   p.price_pickup ?? null,
    price_grab:                     p.price_grab ?? null,
    price_foodpanda:                p.price_foodpanda ?? null,
    price_dinein:                   p.price_dinein ?? null,
    // SST tax fields (per-product overrides; outlet-level defaults
    // live on pos_branch_settings). The classification code already
    // lives in e_invoice_classification_code above.
    tax_rate:                       p.tax_rate ?? 0,
    tax_inclusive:                  p.tax_inclusive ?? true,
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
    // Channel pricing + tax/e-Invoice (StoreHub-parity, added 2026-05-26).
    // All optional — empty/undefined channel price means "use base price".
    price_pickup?: number | null;
    price_grab?: number | null;
    price_foodpanda?: number | null;
    price_dinein?: number | null;
    tax_rate?: number | null;
    tax_inclusive?: boolean | null;
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

  // Build channel + tax overrides. We only pass the column if the caller
  // sent something meaningful — keeps the row at DB defaults when blank.
  const channelTaxInsert: Record<string, unknown> = {};
  if (typeof body.price_pickup === "number")          channelTaxInsert.price_pickup    = body.price_pickup;
  if (typeof body.price_grab === "number")            channelTaxInsert.price_grab      = body.price_grab;
  if (typeof body.price_foodpanda === "number")       channelTaxInsert.price_foodpanda = body.price_foodpanda;
  if (typeof body.price_dinein === "number")          channelTaxInsert.price_dinein    = body.price_dinein;
  if (typeof body.tax_rate === "number" && Number.isFinite(body.tax_rate)) {
    channelTaxInsert.tax_rate = body.tax_rate;
  }
  if (typeof body.tax_inclusive === "boolean") channelTaxInsert.tax_inclusive = body.tax_inclusive;

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
      ...channelTaxInsert,
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
