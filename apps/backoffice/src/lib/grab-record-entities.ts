/**
 * Pure helper: turn built GrabFood menu items into batch ("ITEM") record
 * entities for the Update Menu Record API (price + availability).
 *
 * Kept free of `@/`-aliased / network imports so it's unit-testable in
 * isolation; the side-effecting sync orchestration lives in grab-auto-sync.ts.
 */

export interface GrabMenuItemLike {
  id: string; // our product id (what buildGrabMenuPayload declares)
  price: number;
  availableStatus: "AVAILABLE" | "UNAVAILABLE" | "HIDE";
  maxStock?: number;
}

export interface GrabRecordEntity {
  id: string;
  price?: number;
  availableStatus?: "AVAILABLE" | "UNAVAILABLE" | "HIDE";
  maxStock?: number;
}

/**
 * Translate built menu items into batch record entities, keyed by Grab's own
 * item id when the product is linked (products.grab_item_id), else by our
 * product id. The latter only matches on stores that pulled OUR menu; the
 * former is what makes price/availability land on a portal-built (self-serve)
 * menu, whose items carry Grab-assigned ids (e.g. "MYITE2026...").
 */
export function buildGrabRecordEntities(
  items: GrabMenuItemLike[],
  grabItemIdByProductId: Map<string, string>,
): GrabRecordEntity[] {
  return items.map((it) => ({
    id: grabItemIdByProductId.get(it.id) ?? it.id,
    price: it.price,
    availableStatus: it.availableStatus,
    ...(it.maxStock != null ? { maxStock: it.maxStock } : {}),
  }));
}
