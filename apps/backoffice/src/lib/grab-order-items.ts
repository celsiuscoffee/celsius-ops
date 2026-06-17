/**
 * Resolve GrabFood order-item lines against our product catalogue.
 *
 * Grab order items carry NO name — only an `id` (the partner externalID we
 * shipped in the menu, = products.id when WE pushed the menu) and a `grabItemID`
 * (Grab's own id, e.g. "MYITE2026011703282830543"). For a store whose Grab menu
 * was created via self-serve / in the Grab portal, the order only carries Grab's
 * id, which never matches our products.id (a Mongo-style "68ad6eac..." id). Those
 * lines used to fall back to "Item @ RM x [MYITE202]" on the docket.
 *
 * The fix: the catalogue product carries an optional `grab_item_id` (set in
 * BackOffice → Pickup → Menu). We index products by BOTH their id and their
 * grab_item_id, so an order line resolves whether Grab sends our externalID or
 * its own item id.
 */

export interface GrabItemProductRow {
  id: string;
  name: string;
  grab_item_id?: string | null;
}

/** The identifying fields an order line can carry (everything else ignored). */
export interface GrabOrderItemRef {
  id?: string;
  grabItemID?: string;
  price?: number; // minor units (sen) — used only for the fallback label
}

/**
 * Index catalogue rows by every key an order line might reference: the
 * product's own id AND its linked grab_item_id. Later rows don't clobber an
 * existing id key (id is the strongest signal); grab_item_id only fills a key
 * that isn't already taken.
 */
export function indexProductsByGrabKeys(
  rows: GrabItemProductRow[],
): Map<string, GrabItemProductRow> {
  const index = new Map<string, GrabItemProductRow>();
  for (const row of rows) {
    if (row.id) index.set(row.id, row);
  }
  for (const row of rows) {
    const gid = row.grab_item_id;
    if (gid && !index.has(gid)) index.set(gid, row);
  }
  return index;
}

/**
 * Resolve the catalogue product for an order line: prefer a match on the
 * partner externalID (`item.id`), then Grab's own id (`item.grabItemID`).
 * Returns undefined when the item isn't linked to any catalogue product.
 */
export function resolveGrabItemProduct(
  item: GrabOrderItemRef,
  index: Map<string, GrabItemProductRow>,
): GrabItemProductRow | undefined {
  return (
    (item.id ? index.get(item.id) : undefined) ??
    (item.grabItemID ? index.get(item.grabItemID) : undefined)
  );
}

/**
 * Human-readable fallback when an order line has no catalogue match: surface
 * the price + a short id hint so the kitchen can still act, instead of a bare
 * "Item". The hint is the first 8 chars of whichever id is present.
 */
export function fallbackGrabItemName(item: GrabOrderItemRef): string {
  const unitPrice = item.price ?? 0;
  const idHint = (item.id || item.grabItemID || "").slice(0, 8);
  const suffix = idHint ? ` [${idHint}]` : "";
  return unitPrice > 0
    ? `Item @ RM ${(unitPrice / 100).toFixed(2)}${suffix}`
    : `Item${suffix}`;
}
