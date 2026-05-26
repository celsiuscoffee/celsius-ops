/**
 * Outlet identifiers and labels — single source of truth.
 *
 * Every app (POS, backoffice, pickup web, pickup native, customer
 * display, loyalty, staff app) refers to the same four outlets. We
 * keep the canonical `outlet_id` as the only identifier that ever
 * gets persisted (orders, settings, printers, members, etc.), and a
 * short display label that's consistent everywhere the cashier or
 * customer sees an outlet name.
 *
 * No mall suffix on the short label. Previously the BO showed
 * "Putrajaya (Conezion)" and the POS showed plain "Putrajaya" —
 * inconsistent, and the "(Conezion)" doesn't add information for a
 * customer or operator who already knows where the store is.
 */

export const OUTLET_IDS = [
  "outlet-sa",
  "outlet-con",
  "outlet-tam",
  "outlet-nilai",
] as const;

export type OutletId = (typeof OUTLET_IDS)[number];

/**
 * Short display label per outlet — used in UI dropdowns, headers,
 * receipts, and anywhere a cashier or customer needs to identify the
 * outlet. Matches the DB `outlets.name` minus the "Celsius Coffee "
 * brand prefix.
 *
 * If the brand prefix is wanted (e.g. on a customer-facing receipt
 * header), use OUTLET_FULL_NAMES below.
 */
export const OUTLET_LABELS: Record<OutletId, string> = {
  "outlet-sa":    "Shah Alam",
  "outlet-con":   "Putrajaya",
  "outlet-tam":   "Tamarind",
  "outlet-nilai": "Nilai",
};

/**
 * Full brand-prefixed name, as stored in `outlets.name`. For receipts
 * and other places where the brand name needs to read as a complete
 * business name.
 */
export const OUTLET_FULL_NAMES: Record<OutletId, string> = {
  "outlet-sa":    "Celsius Coffee Shah Alam",
  "outlet-con":   "Celsius Coffee Putrajaya",
  "outlet-tam":   "Celsius Coffee Tamarind",
  "outlet-nilai": "Celsius Coffee Nilai",
};

/**
 * City per outlet. Used by Indeed/Google Ads location targeting,
 * shift-template scheduling, and a few BO admin surfaces that want
 * to group outlets by city.
 */
export const OUTLET_CITIES: Record<OutletId, string> = {
  "outlet-sa":    "Shah Alam",
  "outlet-con":   "Putrajaya",
  "outlet-tam":   "Cyberjaya",
  "outlet-nilai": "Nilai",
};

/** Look up the short label by outlet id. Returns the id back if the
 *  outlet isn't in the known list (defensive — handles legacy rows). */
export function outletLabel(id: string | null | undefined): string {
  if (!id) return "";
  return OUTLET_LABELS[id as OutletId] ?? id;
}

/** Like outletLabel, but returns the full brand-prefixed name. */
export function outletFullName(id: string | null | undefined): string {
  if (!id) return "Celsius Coffee";
  return OUTLET_FULL_NAMES[id as OutletId] ?? id;
}

/** Active outlet list shaped for dropdowns. Stable order: SA → CON
 *  → TAM → Nilai (rough geographic order, matches OUTLET_IDS). */
export const OUTLET_OPTIONS: Array<{ id: OutletId; label: string }> =
  OUTLET_IDS.map((id) => ({ id, label: OUTLET_LABELS[id] }));
