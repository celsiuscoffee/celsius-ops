import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { getProducts, getInventory } from "@/lib/pickup/storehub-client";

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * POST /api/pickup/sync-storehub
 *
 * Pulls all products from StoreHub and upserts into Supabase.
 */
export async function POST() {
  if (!process.env.STOREHUB_API_KEY) {
    return NextResponse.json(
      { error: "STOREHUB_API_KEY not configured in environment variables" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();

  // 1. Fetch all products from StoreHub
  const shProducts = await getProducts();

  // 2. Derive unique categories from products
  const categoryNames = [...new Set(
    shProducts.map((p) => p.category).filter(Boolean)
  )].sort();

  const categoryRows = categoryNames.map((name, i) => ({
    id:       slugify(name),
    name:     name,
    slug:     slugify(name),
    position: i + 1,
  }));

  const { error: catError } = await supabase
    .from("categories")
    .upsert(categoryRows, { onConflict: "id" });

  if (catError) {
    return NextResponse.json(
      { error: `Category upsert failed: ${catError.message}` },
      { status: 500 }
    );
  }

  // 3. Fetch existing products to preserve their image_url and featured flag
  const { data: existing } = await supabase
    .from("products")
    .select("id, image_url, is_featured")
    .eq("brand_id", "brand-celsius");

  const existingMap = new Map(
    (existing ?? []).map((p) => [
      p.id as string,
      {
        imageUrl:   (p.image_url as string) ?? "",
        isFeatured: (p.is_featured as boolean) ?? false,
      },
    ])
  );

  // 3b. Fetch inventory for availability check
  const trackMap = new Map(shProducts.map((p) => [p.id, p.trackStockLevel]));
  let inventoryByProduct = new Map<string, number>();
  try {
    const { data: storeHubStores } = await supabase.from("outlet_settings").select("store_id");
    const storeIds = (storeHubStores ?? []).map((s) => s.store_id as string);
    const inventoryArrays = await Promise.all(storeIds.map((sid) => getInventory(sid).catch(() => [])));
    for (const inv of inventoryArrays.flat()) {
      inventoryByProduct.set(inv.productId, (inventoryByProduct.get(inv.productId) ?? 0) + inv.quantityOnHand);
    }
  } catch { /* inventory fetch is best-effort */ }

  // 4. Map StoreHub products to Supabase rows
  const topLevelProducts = shProducts.filter((p) => !p.parentProductId && p.category);

  const MULTI_SELECT = new Set(["add on", "add ons", "add-on", "add-ons"]);

  const productRows = topLevelProducts.map((p) => {
    const prev     = existingMap.get(p.id);
    const catSlug  = slugify(p.category);

    const modifierGroups = (p.variantGroups ?? []).map((vg) => ({
      id:          vg.id,
      name:        vg.name,
      multiSelect: MULTI_SELECT.has(vg.name.toLowerCase()),
      options:     vg.options.map((opt) => ({
        id:         opt.id,
        label:      opt.optionValue,
        priceDelta: opt.priceDifference,
        isDefault:  opt.isDefault ?? false,
      })),
    }));

    return {
      id:                   p.id,
      brand_id:             "brand-celsius",
      storehub_product_id:  p.id,
      name:                 p.name,
      sku:                  p.sku ?? null,
      category:             catSlug,
      description:          "",
      price:                p.unitPrice,
      image_url:            prev?.imageUrl ?? "",
      is_available:         trackMap.get(p.id)
        ? (inventoryByProduct.get(p.id) ?? 0) > 0
        : true,
      is_featured:          prev?.isFeatured ?? false,
      modifiers:            modifierGroups,
      track_stock:          p.trackStockLevel,
      synced_at:            new Date().toISOString(),
    };
  });

  const { error: prodError } = await supabase
    .from("products")
    .upsert(productRows, { onConflict: "id" });

  if (prodError) {
    return NextResponse.json(
      { error: `Product upsert failed: ${prodError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    synced: {
      categories: categoryRows.length,
      products:   productRows.length,
    },
    timestamp: new Date().toISOString(),
  });
}
