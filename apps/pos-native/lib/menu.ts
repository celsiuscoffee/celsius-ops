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
};

const toSen = (rm: number | string | null | undefined) =>
  Math.round(Number(rm ?? 0) * 100);

/** Normalize the products.modifiers JSONB (shape varies across the
 *  catalog's history) into a consistent ModifierGroup[]. Defensive —
 *  returns [] for anything unparseable so the grid never crashes. */
function parseModifiers(raw: unknown): ModifierGroup[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((g: any, gi: number) => ({
      id: String(g?.id ?? g?.name ?? `g${gi}`),
      name: String(g?.name ?? "Options"),
      required: Boolean(g?.required ?? g?.is_required ?? false),
      multi: Boolean(g?.multi ?? g?.multiple ?? g?.allow_multiple ?? false),
      options: Array.isArray(g?.options)
        ? g.options.map((o: any, oi: number) => ({
            id: String(o?.id ?? o?.name ?? `o${oi}`),
            name: String(o?.name ?? ""),
            price_sen: toSen(o?.price ?? o?.price_rm ?? 0),
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

export async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, name, category, price, image_url, is_available, kitchen_station, tax_rate, tax_inclusive, modifiers, position",
    )
    .eq("brand_id", BRAND_ID)
    .eq("is_available", true)
    .order("category", { ascending: true })
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
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
  }));
}
