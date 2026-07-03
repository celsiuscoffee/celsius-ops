import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side "can these items be ordered at this outlet right now?" gate.
 *
 * The menu and pairing rails hide 86'd / snoozed items client-side, but that is
 * advisory only: an item can still reach checkout if it was added to the cart
 * BEFORE being 86'd, from a stale menu cache, or via a direct product link. This
 * is the authoritative check both order-creation paths (/api/checkout/initiate
 * for web-QR, /api/orders for native pickup) run before writing the order, so a
 * sold-out item can never actually be ordered.
 *
 * An item is unavailable when it is either:
 *   • globally discontinued  — products.is_available = false, or
 *   • snoozed at THIS outlet  — an outlet_product_availability row with
 *     is_available = false, keyed by the STORE SLUG (e.g. "shah-alam") — the
 *     same key the menu availability read, POS register, and pickup app use.
 *
 * Returns the blocked items as { id, name } (empty array = everything orderable)
 * so the caller can name them in the error the customer sees.
 */
// Loosely-typed client so either app's admin client is accepted.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export async function findUnavailableItems(
  supabase: Db,
  storeId: string,
  productIds: string[],
): Promise<{ id: string; name: string }[]> {
  const ids = Array.from(new Set(productIds.filter(Boolean)));
  if (ids.length === 0) return [];

  const [{ data: prods }, { data: oosRows }] = await Promise.all([
    supabase.from("products").select("id, name, is_available").in("id", ids),
    supabase
      .from("outlet_product_availability")
      .select("product_id")
      .eq("outlet_id", storeId)
      .eq("is_available", false)
      .in("product_id", ids),
  ]);

  const snoozed = new Set(
    ((oosRows ?? []) as Array<{ product_id: string }>).map((r) => r.product_id),
  );

  const blocked: { id: string; name: string }[] = [];
  for (const p of (prods ?? []) as Array<{ id: string; name: string | null; is_available: boolean | null }>) {
    if (p.is_available === false || snoozed.has(p.id)) {
      blocked.push({ id: p.id, name: p.name ?? p.id });
    }
  }
  return blocked;
}

/** Customer-facing "these items are sold out" message for a blocked list. */
export function unavailableItemsMessage(blocked: { name: string }[]): string {
  const names = blocked.map((b) => b.name);
  const list =
    names.length === 1
      ? names[0]
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  const verb = names.length === 1 ? "is" : "are";
  return `${list} ${verb} sold out at this outlet. Please remove ${names.length === 1 ? "it" : "them"} from your order to continue.`;
}
