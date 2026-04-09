/**
 * Server-side menu data fetcher.
 * Reads from Supabase (populated via Sync StoreHub button), falls back to mock.
 */
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { products as mockProducts, categories as mockCategories } from "@/data/mock";
import type { Product, Category } from "@/lib/types";

export interface MenuData {
  products: Product[];
  categories: Category[];
  source: "supabase" | "mock";
}

export async function getMenuData(): Promise<MenuData> {
  try {
    const supabase = getSupabaseAdmin();
    const [{ data: dbProducts, error: prodError }, { data: dbCategories, error: catError }] = await Promise.all([
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

    if (prodError) console.error("[menu-data] products query error:", prodError);
    if (catError)  console.error("[menu-data] categories query error:", catError);

    if (dbProducts && dbProducts.length > 0 && dbCategories && dbCategories.length > 0) {
      const products: Product[] = (dbProducts as Record<string, unknown>[]).map((p) => ({
        id:             p.id as string,
        categoryId:     p.category as string,
        name:           p.name as string,
        description:    (p.description as string) || undefined,
        basePrice:      p.price as number,
        image:          (p.image_url as string) ?? "",
        isAvailable:    (p.is_available as boolean) ?? true,
        isPopular:      (p.is_featured as boolean) ?? false,
        isNew:          false,
        variants:       [],
        modifierGroups: Array.isArray(p.modifiers) ? (p.modifiers as Product["modifierGroups"]) : [],
      }));

      const categories: Category[] = (dbCategories as Record<string, unknown>[]).map((c) => ({
        id:   c.id as string,
        name: c.name as string,
        slug: c.slug as string,
      }));

      return { products, categories, source: "supabase" };
    }
  } catch (err) {
    console.error("[menu-data] Supabase fetch failed, using mock:", err);
  }

  return { products: mockProducts, categories: mockCategories, source: "mock" };
}
