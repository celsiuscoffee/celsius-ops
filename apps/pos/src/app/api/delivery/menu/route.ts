import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { filterModifiersForChannel } from "@celsius/shared";

/**
 * Menu Sync API for Delivery Platforms
 *
 * GET /api/delivery/menu?outlet=outlet-sa
 *
 * Returns the product catalog in a format compatible with
 * Deliverect / delivery platform menu sync.
 *
 * Deliverect pulls this endpoint to build the delivery menu.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(req: NextRequest) {
  const outletId = req.nextUrl.searchParams.get("outlet") ?? "outlet-sa";

  // Fetch products
  const { data: products, error } = await supabase
    .from("products")
    .select("*")
    .order("category, name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Group by category
  const categories: Record<string, any[]> = {};
  for (const p of products ?? []) {
    const cat = p.category ?? "uncategorized";
    if (!categories[cat]) categories[cat] = [];

    // Parse modifiers from StoreHub JSONB format. Filter by "foodpanda"
    // channel first so groups/options opted out of delivery are dropped.
    const visibleMods = filterModifiersForChannel(p.modifiers ?? [], "foodpanda");
    const modifierGroups = visibleMods.map((m: any) => ({
      name: m.name,
      multiSelect: m.multiSelect ?? false,
      options: (m.options ?? []).map((o: any) => ({
        name: o.label,
        price: Math.round((o.priceDelta ?? 0) * 100), // Convert RM to sen
        isDefault: o.isDefault ?? false,
      })),
    }));

    categories[cat].push({
      id: p.id,
      name: p.name,
      description: p.description ?? "",
      price: Math.round(Number(p.price) * 100), // RM to sen
      currency: "MYR",
      imageUrl: p.image_url ?? null,
      isAvailable: p.is_available ?? true,
      category: cat,
      modifierGroups,
      taxRate: p.tax_rate ?? 0,
    });
  }

  return NextResponse.json({
    outlet: outletId,
    lastUpdated: new Date().toISOString(),
    totalProducts: (products ?? []).length,
    categories: Object.entries(categories).map(([name, items]) => ({
      name,
      displayName: name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      items,
    })),
  });
}
