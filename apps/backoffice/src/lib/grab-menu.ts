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
  // Grab's own menu item id, set in BackOffice when the Grab menu was built in
  // Grab's portal. Used to target outbound price/availability record pushes (and
  // to resolve inbound order item names). See grab-order-items.ts / grab-auto-sync.ts.
  grab_item_id?: string | null;
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

/**
 * Cap a product image for Grab's menu import. Grab's importer rejects oversized
 * images — several of our Cloudinary product PNGs are 6–8MB, and a single
 * over-limit image fails the WHOLE menu push ("failed to push your menu") even
 * when every other field is valid. For Cloudinary URLs, insert an on-the-fly
 * transform: downscale to ≤1280px (c_limit never upscales), auto-quality, force
 * JPEG — bringing every image under ~200KB without re-uploading. Non-Cloudinary
 * (or already-transformed) URLs pass through unchanged.
 */
export function grabSafeImageUrl(url: string): string {
  const MARKER = "/image/upload/";
  const i = url.indexOf(MARKER);
  if (i === -1 || !url.includes("res.cloudinary.com")) return url;
  const tail = url.slice(i + MARKER.length);
  // Only transform the raw `v<version>/…` form so we never double-stack params.
  if (!/^v\d+\//.test(tail)) return url;
  return `${url.slice(0, i + MARKER.length)}c_limit,w_1280,q_auto:good,f_jpg/${tail}`;
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

  const availableStatus: GrabMenuItem["availableStatus"] =
    product.is_available === false ? "UNAVAILABLE" : "AVAILABLE";
  return {
    id: product.id,
    name: product.name,
    sequence,
    availableStatus,
    description: product.description || undefined,
    price: Math.round(resolveGrabPriceRM(product) * 100), // RM → sen
    photos: product.image_url ? [grabSafeImageUrl(product.image_url)] : undefined,
    // Grab REQUIRES maxStock:0 whenever availableStatus is UNAVAILABLE — omitting it
    // makes Grab reject the entire menu push ("failed to push your menu"). AVAILABLE
    // items leave maxStock unset (Grab treats absent maxStock as in-stock).
    ...(availableStatus === "UNAVAILABLE" ? { maxStock: 0 } : {}),
    modifierGroups: convertToGrabModifiers(product.id, visibleMods),
  };
}

// Single section wraps the whole catalogue (we don't day-part the menu). The
// open/close window is now per-outlet (pos_branch_settings.grab_open_time /
// grab_close_time / grab_open_24h) — see buildGrabServiceHours. Default below
// is the historical 08:00–22:00 used when an outlet has no override.
const DEFAULT_PERIOD = { startTime: "08:00", endTime: "22:00" };
const sameEveryDay = <T>(period: T) => ({
  mon: period, tue: period, wed: period, thu: period, fri: period, sat: period, sun: period,
});
const DEFAULT_SERVICE_HOURS = sameEveryDay({ openPeriodType: "OpenPeriod", periods: [DEFAULT_PERIOD] });

export type GrabHours = { open?: string | null; close?: string | null; open24h?: boolean | null };

/** Build a 7-day serviceHours block from an outlet's open/close (or 24h). A
 *  24h outlet becomes a full 00:00–23:59 daily window (Grab has no finer
 *  "always open" we rely on here, and the 1-minute seam at midnight is moot). */
export function buildGrabServiceHours(h: GrabHours) {
  const period = h.open24h
    ? { openPeriodType: "OpenPeriod", periods: [{ startTime: "00:00", endTime: "23:59" }] }
    : { openPeriodType: "OpenPeriod", periods: [{ startTime: h.open || "08:00", endTime: h.close || "22:00" }] };
  return sameEveryDay(period);
}

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
  /** Per-outlet open hours (from pos_branch_settings). Defaults to 08:00–22:00. */
  serviceHours?: ReturnType<typeof buildGrabServiceHours>;
  /** Product ids "86'd" (out of stock) at THIS merchant's outlet — from
   *  outlet_product_availability. Forced to UNAVAILABLE in the payload so a full
   *  menu re-sync honours per-outlet stock-outs, not just the global flag. */
  unavailableProductIds?: Set<string>;
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
  // GrabFood self-serve activation ONLY accepts the "Selling Time Based" menu —
  // section-based payloads are rejected ("section-based menus will not be able to
  // proceed with integration activation"). One all-day selling time; every
  // category references it via sellingTimeID, all hung at the top level.
  const SELLING_TIME_ID = "all-day";
  const categories: GrabMenuCategory[] = Array.from(categoryMap.entries()).map(
    ([slug, prods], cIdx) => ({
      id: `cat-${cIdx}`,
      name: opts.categoryNames?.[slug] || slug || "Uncategorized",
      sequence: cIdx + 1,
      availableStatus: "AVAILABLE" as const,
      sellingTimeID: SELLING_TIME_ID,
      items: prods.map((product, iIdx) => {
        const item = convertProductToGrabItem(product, iIdx + 1);
        // Per-outlet 86 overrides the global flag → out of stock on Grab too.
        // Grab requires maxStock:0 alongside UNAVAILABLE (see convertProductToGrabItem).
        if (opts.unavailableProductIds?.has(product.id)) {
          item.availableStatus = "UNAVAILABLE";
          item.maxStock = 0;
        }
        return item;
      }),
    }),
  );
  return {
    merchantID: merchantId,
    ...(opts.partnerMerchantId ? { partnerMerchantID: opts.partnerMerchantId } : {}),
    currency: opts.currency ?? { code: "MYR", symbol: "RM", exponent: 2 },
    sellingTimes: [
      {
        id: SELLING_TIME_ID,
        name: "All Day",
        // Date window must be present + wide so the selling time is always active;
        // the per-day serviceHours carry the real open/close window.
        startTime: "2020-01-01 00:00:00",
        endTime: "2099-12-31 23:59:59",
        serviceHours: opts.serviceHours ?? DEFAULT_SERVICE_HOURS,
      },
    ],
    categories,
  };
}
