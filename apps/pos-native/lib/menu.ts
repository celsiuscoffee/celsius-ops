import { supabase } from "./supabase";

/**
 * Product catalog for the register. Read directly from Supabase with
 * the anon client (products + categories are RLS-public reads) — no
 * API hop, so the grid paints fast. Mirrors the columns the web POS
 * register uses.
 *
 * Prices are stored as RM (numeric) in the DB; we convert to sen
 * (integer) here so the rest of the POS does integer money math and
 * never hits floating-point rounding on a bill.
 */
const BRAND_ID = "brand-celsius";

export type Category = {
  id: string;
  name: string;
  slug: string;
  position: number;
};

export type ModifierOption = { id: string; name: string; price_sen: number };
export type ModifierGroup = {
  id: string;
  name: string;
  required: boolean;
  multi: boolean;
  options: ModifierOption[];
};

export type Product = {
  id: string;
  name: string;
  category: string;
  price_sen: number;
  image_url: string | null;
  kitchen_station: string | null;
  tax_rate: number;
  tax_inclusive: boolean;
  modifiers: ModifierGroup[];
  /** Per-outlet availability: false = "86'd" at THIS outlet (grey out, can't
   *  add). Globally-discontinued items (products.is_available=false) aren't
   *  loaded at all, so this only ever reflects the per-outlet override. */
  available: boolean;
};

const toSen = (rm: number | string | null | undefined) =>
  Math.round(Number(rm ?? 0) * 100);

/** A modifier group/option carries an optional `channels` list. Empty or
 *  missing = visible everywhere (backward-compatible). A non-empty list
 *  restricts it to those channels. The SUNMI register is the "pos" channel,
 *  so a grab-only group (e.g. the GrabFood "Packaging" fee) is hidden here.
 *  Mirrors @celsius/shared visibleOnChannel so POS / pickup / Grab agree. */
function visibleOnPos(channels: unknown): boolean {
  if (!Array.isArray(channels) || channels.length === 0) return true;
  return channels.includes("pos");
}

/** Normalize the products.modifiers JSONB (shape varies across the
 *  catalog's history) into a consistent ModifierGroup[]. Defensive —
 *  returns [] for anything unparseable so the grid never crashes.
 *  Channel-filtered to the POS register so other channels' modifiers
 *  (e.g. Grab-only Packaging) never appear on the cashier screen. */
function parseModifiers(raw: unknown): ModifierGroup[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((g: any) => visibleOnPos(g?.channels))
    .map((g: any, gi: number) => ({
      id: String(g?.id ?? g?.name ?? `g${gi}`),
      name: String(g?.name ?? "Options"),
      required: Boolean(g?.required ?? g?.is_required ?? false),
      // Live catalog uses `multiSelect`; keep the older aliases as fallbacks.
      multi: Boolean(g?.multiSelect ?? g?.multi ?? g?.multiple ?? g?.allow_multiple ?? false),
      options: Array.isArray(g?.options)
        ? g.options
            .filter((o: any) => visibleOnPos(o?.channels))
            .map((o: any, oi: number) => ({
              // Option label is stored under `label` (price under `priceDelta`,
              // in RM). Earlier `name`/`price` were wrong fields → blank rows
              // with no add-on price. Keep both as fallbacks.
              id: String(o?.id ?? o?.label ?? o?.name ?? `o${oi}`),
              name: String(o?.label ?? o?.name ?? ""),
              price_sen: toSen(o?.priceDelta ?? o?.price ?? o?.price_rm ?? 0),
            }))
        : [],
    }))
    .filter((g) => g.options.length > 0);
}

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, slug, position")
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Category[];
}

/** Load the register catalog. Globally-discontinued items
 *  (products.is_available=false) are excluded entirely. Per-outlet "86"
 *  overrides — `outlet_product_availability` rows for the outlet's STORE slug
 *  (e.g. "shah-alam") — are overlaid as `available=false` so the register can
 *  GREY them out instead of hiding, matching StoreHub + the pickup app + Grab.
 *  Pass the resolved store_id; omit it and everything reads as available. */
export async function fetchProducts(storeId?: string | null): Promise<Product[]> {
  const [{ data, error }, oosRes] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, name, category, price, image_url, is_available, kitchen_station, tax_rate, tax_inclusive, modifiers, position",
      )
      .eq("brand_id", BRAND_ID)
      .eq("is_available", true)
      .order("category", { ascending: true })
      .order("position", { ascending: true })
      .order("name", { ascending: true }),
    storeId
      ? supabase
          .from("outlet_product_availability")
          .select("product_id")
          .eq("outlet_id", storeId)
          .eq("is_available", false)
      : Promise.resolve({ data: [] as { product_id: string }[] }),
  ]);
  if (error) throw error;
  const oos = new Set(
    ((oosRes as { data: { product_id: string }[] | null }).data ?? []).map((r) => r.product_id),
  );
  return (data ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    category: p.category ?? "",
    price_sen: toSen(p.price),
    image_url: p.image_url ?? null,
    kitchen_station: p.kitchen_station ?? null,
    tax_rate: Number(p.tax_rate ?? 0),
    tax_inclusive: p.tax_inclusive ?? true,
    modifiers: parseModifiers(p.modifiers),
    available: !oos.has(p.id),
  }));
}

// Food/snack categories used as "pair with a bite" upsell suggestions on
// the customer-display — guest-friendly (no member needed).
const BITE_CATEGORIES = ["cakes", "cookies", "croissant", "fries", "nasi-lemak", "noodle", "pasta", "roti-bakar", "sandwiches"];

export type DisplayBite = { id: string; name: string; category: string; price_sen: number; image_url: string | null };

/** Available bite/snack products (with images, anon read) to upsell
 *  alongside a drink order. Used by the customer-display hero. */
export async function fetchBites(limit = 8): Promise<DisplayBite[]> {
  const { data, error } = await supabase
    .from("products")
    .select("id, name, category, price, image_url, position")
    .eq("brand_id", BRAND_ID)
    .eq("is_available", true)
    .in("category", BITE_CATEGORIES)
    .not("image_url", "is", null)
    .order("position", { ascending: true })
    .limit(limit);
  if (error) return [];
  return (data ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    category: p.category ?? "",
    price_sen: toSen(p.price),
    image_url: p.image_url ?? null,
  }));
}
