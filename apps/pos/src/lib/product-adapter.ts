/**
 * Adapts existing Supabase products (from StoreHub sync) to POS format.
 *
 * Key differences:
 * - Supabase products: prices in RM decimal (14.9), modifiers have {id, name, options[{id, label, priceDelta, isDefault}], multiSelect}
 * - POS internal: prices in sen (1490), modifiers have {group_name, is_required, min_select, max_select, options[{name, price}]}
 */

import type { Product, ModifierGroup } from "@/types/database";

type StoreHubModifier = {
  id: string;
  name: string;
  options: { id: string; label: string; priceDelta: number; isDefault: boolean }[];
  multiSelect: boolean;
};

export function adaptProduct(raw: Record<string, unknown>): Product {
  const price = Math.round(Number(raw.price ?? 0) * 100);
  const cost = raw.cost ? Math.round(Number(raw.cost) * 100) : null;
  const onlinePrice = raw.online_price ? Math.round(Number(raw.online_price) * 100) : null;

  // Adapt modifiers from StoreHub format to POS format
  const rawModifiers = (raw.modifiers ?? []) as StoreHubModifier[];
  const modifiers: ModifierGroup[] = rawModifiers.map((m) => ({
    group_name: m.name,
    // Single-select with a default = required. Multi-select = optional.
    // If group has an option with isDefault=true AND priceDelta=0, it's a sensible default (not truly "required to choose")
    is_required: !m.multiSelect && m.options.length > 0 && !m.options.some((o: any) => o.isDefault && o.priceDelta === 0),
    min_select: m.multiSelect ? 0 : (m.options.some((o: any) => o.isDefault) ? 0 : 1),
    max_select: m.multiSelect ? m.options.length : 1,
    options: m.options.map((o) => ({
      name: o.label,
      price: Math.round((o.priceDelta ?? 0) * 100), // RM to sen
    })),
  }));

  return {
    id: raw.id as string,
    brand_id: (raw.brand_id as string) ?? "brand-celsius",
    storehub_id: (raw.storehub_product_id as string) ?? null,
    name: raw.name as string,
    sku: (raw.sku as string) ?? null,
    category: (raw.category as string) ?? null,
    tags: (raw.tags as string[]) ?? [],
    description: (raw.description as string) ?? null,
    image_url: (raw.image_url as string) ?? null,
    image_urls: (raw.image_urls as string[]) ?? [],
    price,
    cost,
    online_price: onlinePrice,
    tax_code: (raw.tax_code as string) ?? null,
    tax_rate: raw.tax_rate ? Number(raw.tax_rate) : 0,
    pricing_type: (raw.pricing_type as "fixed" | "variable" | "weight") ?? "fixed",
    modifiers,
    track_stock: (raw.track_stock as boolean) ?? false,
    stock_level: raw.stock_level ? Number(raw.stock_level) : null,
    kitchen_station: (raw.kitchen_station as string) ?? null,
    is_available: (raw.is_available as boolean) ?? true,
    is_featured: (raw.is_featured as boolean) ?? false,
    // StoreHub-parity flag — the register checks this when printing the
    // kitchen docket and triggers a second copy when set.
    print_additional_docket: (raw.print_additional_docket as boolean) ?? false,
    synced_at: (raw.synced_at as string) ?? null,
    created_at: (raw.created_at as string) ?? "",
    updated_at: (raw.updated_at as string) ?? "",
  };
}

export function adaptProducts(rawProducts: Record<string, unknown>[]): Product[] {
  return rawProducts.map(adaptProduct);
}
