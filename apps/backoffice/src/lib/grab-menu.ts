/**
 * Shared POS-products → GrabFood menu mapping.
 *
 * Used by BOTH directions:
 *  - outbound: /api/grab/menu POST (we push the menu to Grab)
 *  - inbound:  /api/grab/merchant/menu GET (Grab fetches our menu via webhook)
 */

import type {
  GrabMenuCategory,
  GrabMenuItem,
  GrabMenuSection,
  GrabModifierGroup,
  GrabMenuPayload,
} from "@/lib/grab";
import { filterModifiersForChannel } from "@celsius/shared";

export interface RawProduct {
  id: string;
  name: string;
  category: string;
  // Per-channel pricing (StoreHub parity). All RM decimal. `price` is the base
  // and is always set; the channel columns are nullable overrides. There is no
  // `sell_price` column — that was the source of the all-null-price bug.
  price: number; // base RM price (always populated)
  price_grab?: number | null; // per-channel GrabFood price (preferred for Grab)
  grabfood_price?: number | null; // legacy GrabFood price column
  online_price?: number | null; // generic online price
  description?: string;
  image_url?: string;
  is_available?: boolean;
  // Real shape of products.modifiers (jsonb), aligned with @celsius/shared
  // ModifierGroupLike. Earlier we had `title`/`isMultiSelect`/nested `modifiers`
  // here — wrong; the DB stores `name`/`multiSelect`/`options`. That mismatch
  // meant convertToGrabModifiers silently dropped EVERY group (filter on
  // undefined `modifiers`), shipping a Grab menu with zero modifier options.
  modifiers?: Array<{
    id?: string;
    name?: string;
    multiSelect?: boolean;
    channels?: string[];
    options?: Array<{
      id?: string;
      label?: string;
      priceDelta?: number;
      isDefault?: boolean;
      channels?: string[];
    }>;
  }>;
}

/**
 * Resolve the RM price to publish to GrabFood: prefer a positive per-channel
 * Grab price, then legacy/online overrides, else the base price. Returns RM
 * (decimal); the caller converts to sen. Guards null/NaN so we never emit a
 * `null`/`NaN` price (which Grab rejects).
 */
export function resolveGrabPriceRM(product: RawProduct): number {
  for (const candidate of [product.price_grab, product.grabfood_price, product.online_price]) {
    const n = Number(candidate);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const base = Number(product.price);
  return Number.isFinite(base) && base > 0 ? base : 0;
}

export function convertToGrabModifiers(
  productId: string,
  rawModifiers: RawProduct["modifiers"],
): GrabModifierGroup[] {
  if (!rawModifiers || rawModifiers.length === 0) return [];
  return rawModifiers
    .filter((g) => Array.isArray(g.options) && g.options.length > 0)
    .map((group, gIdx) => {
      const opts = group.options ?? [];
      const multi = !!group.multiSelect;
      return {
        id: `${productId}-mg-${gIdx}`,
        name: group.name || `Option ${gIdx + 1}`,
        sequence: gIdx + 1,
        availableStatus: "AVAILABLE" as const,
        selectionRangeMin: multi ? 0 : 1,
        selectionRangeMax: multi ? opts.length : 1,
        modifiers: opts.map((mod, mIdx) => ({
          id: `${productId}-m-${gIdx}-${mIdx}`,
          name: mod.label || "Option",
          sequence: mIdx + 1,
          availableStatus: "AVAILABLE" as const,
          price: Math.round((mod.priceDelta || 0) * 100), // RM → sen
        })),
      };
    });
}

export function convertProductToGrabItem(product: RawProduct, sequence = 1): GrabMenuItem {
  // Drop modifier groups (or individual options) that opt out of the "grab"
  // channel via products.modifiers[*].channels / options[*].channels. The cast
  // bridges our local RawProduct.modifiers shape (uses `modifiers` for nested
  // options) with the shared ModifierGroupLike contract (uses `options`); at
  // runtime both shapes carry the `channels` field that the filter reads.
  const visibleMods = filterModifiersForChannel(
    product.modifiers as unknown as Parameters<typeof filterModifiersForChannel>[0],
    "grab",
  ) as unknown as RawProduct["modifiers"];

  return {
    id: product.id,
    name: product.name,
    sequence,
    availableStatus: product.is_available === false ? "UNAVAILABLE" : "AVAILABLE",
    description: product.description || undefined,
    price: Math.round(resolveGrabPriceRM(product) * 100), // RM → sen
    campaignInfo: null,
    photos: product.image_url ? [product.image_url] : undefined,
    modifierGroups: convertToGrabModifiers(product.id, visibleMods),
  };
}

// Single all-day section wraps the whole catalogue (we don't day-part the menu).
const ALL_DAY_PERIOD = { startTime: "08:00", endTime: "22:00" };
const ALL_DAY_SERVICE_HOURS = {
  mon: { openPeriodType: "OpenPeriod", periods: [ALL_DAY_PERIOD] },
  tue: { openPeriodType: "OpenPeriod", periods: [ALL_DAY_PERIOD] },
  wed: { openPeriodType: "OpenPeriod", periods: [ALL_DAY_PERIOD] },
  thu: { openPeriodType: "OpenPeriod", periods: [ALL_DAY_PERIOD] },
  fri: { openPeriodType: "OpenPeriod", periods: [ALL_DAY_PERIOD] },
  sat: { openPeriodType: "OpenPeriod", periods: [ALL_DAY_PERIOD] },
  sun: { openPeriodType: "OpenPeriod", periods: [ALL_DAY_PERIOD] },
};

export interface GrabMenuOptions {
  /** Our identifier for the store — Grab's "Partner store ID" / partnerMerchantID. */
  partnerMerchantId?: string;
  /** Currency override; defaults to Malaysian Ringgit (Celsius's home currency). */
  currency?: { code: string; symbol: string; exponent: number };
  /**
   * Map of category slug → display name (e.g. "artisan-choc" → "Artisan Choc").
   * products.category stores the slug; without this map the slug ships to Grab
   * as the visible category header. Pass the categories table here.
   */
  categoryNames?: Record<string, string>;
}

/** Read menu options (partner store ID + currency override) from env. */
export function grabMenuOptionsFromEnv(): GrabMenuOptions {
  const code = process.env.GRAB_CURRENCY_CODE;
  const symbol = process.env.GRAB_CURRENCY_SYMBOL;
  return {
    partnerMerchantId: process.env.GRAB_PARTNER_MERCHANT_ID || undefined,
    currency: code ? { code, symbol: symbol || code, exponent: 2 } : undefined,
  };
}

/** Build a full GrabFood menu payload from POS products. */
export function buildGrabMenuPayload(
  products: RawProduct[],
  merchantId: string,
  opts: GrabMenuOptions = {},
): GrabMenuPayload {
  const categoryMap = new Map<string, RawProduct[]>();
  for (const product of products) {
    const cat = product.category || "Uncategorized";
    if (!categoryMap.has(cat)) categoryMap.set(cat, []);
    categoryMap.get(cat)!.push(product);
  }
  const categories: GrabMenuCategory[] = Array.from(categoryMap.entries()).map(
    ([slug, prods], cIdx) => ({
      id: `cat-${cIdx}`,
      name: opts.categoryNames?.[slug] || slug || "Uncategorized",
      sequence: cIdx + 1,
      availableStatus: "AVAILABLE" as const,
      items: prods.map((product, iIdx) => convertProductToGrabItem(product, iIdx + 1)),
    }),
  );
  const section: GrabMenuSection = {
    id: "section-all-day",
    name: "All Day",
    sequence: 1,
    serviceHours: ALL_DAY_SERVICE_HOURS,
    categories,
  };
  return {
    merchantID: merchantId,
    ...(opts.partnerMerchantId ? { partnerMerchantID: opts.partnerMerchantId } : {}),
    currency: opts.currency ?? { code: "MYR", symbol: "RM", exponent: 2 },
    sections: [section],
  };
}
