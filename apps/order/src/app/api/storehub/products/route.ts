import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { products as mockProducts, categories as mockCategories } from "@/data/mock";
import type { Product, Category } from "@/lib/types";

/**
 * GET /api/storehub/products
 * Returns menu data — Supabase products table first, falls back to mock.
 */
export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const [
      { data: dbProducts, error: prodError },
      { data: dbCategories, error: catError },
    ] = await Promise.all([
      supabase
        .from("products")
        .select("id, name, category, description, price, image_url, is_available, is_featured, modifiers")
        .eq("brand_id", "brand-celsius")
        .order("name"),
      supabase
        .from("categories")
        .select("id, name, slug, position")
        .order("position"),
    ]);

    if (prodError) console.error("[menu] products query error:", prodError);
    if (catError)  console.error("[menu] categories query error:", catError);

    if (dbProducts && dbProducts.length > 0 && dbCategories && dbCategories.length > 0) {
      // Map loyalty app products table schema → frontend Product type
      // Columns: id, name, category (text slug), price (RM), image_url,
      //          is_available, is_featured, modifiers, track_stock
      const products: Product[] = (dbProducts as Record<string, unknown>[]).map((p) => ({
        id:          p.id as string,
        categoryId:  p.category as string,           // category is slug string, not FK
        name:        p.name as string,
        description: (p.description as string) || "",
        basePrice:   (p.price as number),            // already in RM
        image:       (p.image_url as string) || "",
        imageZoom:   100,                             // not stored in loyalty schema
        isAvailable: (p.is_available as boolean) ?? true,
        isPopular:   (p.is_featured as boolean) ?? false,
        isNew:       false,                           // not stored in loyalty schema
        variants:       [],
        modifierGroups: Array.isArray(p.modifiers) ? (p.modifiers as Product["modifierGroups"]) : [],
      }));

      const categories: Category[] = (dbCategories as Record<string, unknown>[]).map((c) => ({
        id:   c.id as string,
        name: c.name as string,
        slug: c.slug as string,
      }));

      const res = NextResponse.json({ products, categories, source: "supabase" });
      res.headers.set("Cache-Control", "s-maxage=60, stale-while-revalidate=600");
      return res;
    }
  } catch (err) {
    console.error("[menu] Supabase fetch failed, using mock:", err);
  }

  const res = NextResponse.json({ products: mockProducts, categories: mockCategories, source: "mock" });
  res.headers.set("Cache-Control", "s-maxage=60, stale-while-revalidate=600");
  return res;
}
