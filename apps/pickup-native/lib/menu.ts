import { supabase } from "./supabase";

export type Category = {
  id: string;
  name: string;
  slug: string;
  position: number;
};

export type ModifierOption = {
  id: string;
  label: string;
  priceDelta: number;
  isDefault: boolean;
};

export type ModifierGroup = {
  id: string;
  name: string;
  multiSelect: boolean;
  options: ModifierOption[];
};

export type Product = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  price: number;
  image_url: string | null;
  is_available: boolean;
  is_featured: boolean;
  modifiers: ModifierGroup[];
  featured_position?: number;
};

type RawProduct = Product & { hidden_modifier_ids?: string[] };

export async function fetchMenu(
  outletId?: string | null,
): Promise<{ categories: Category[]; products: Product[] }> {
  const productsQuery = supabase
    .from("products")
    .select("id,name,category,description,price,image_url,is_available,is_featured,modifiers,hidden_modifier_ids,featured_position")
    .eq("brand_id", "brand-celsius")
    .order("position")
    .order("name");

  // Per-outlet OOS overrides — sparse table populated by KDS staff
  // when something runs out at their outlet only. We fetch the
  // unavailable rows for the customer's selected outlet (if any)
  // and filter them out of the product list. Absence of a row =
  // use the product's global is_available.
  const overridesQuery = outletId
    ? supabase
        .from("outlet_product_availability")
        .select("product_id")
        .eq("outlet_id", outletId)
        .eq("is_available", false)
    : Promise.resolve({ data: [] as { product_id: string }[] });

  const [{ data: cats, error: catErr }, { data: prods, error: prodErr }, ovs] =
    await Promise.all([
      supabase.from("categories").select("id,name,slug,position").order("position"),
      productsQuery,
      overridesQuery,
    ]);
  if (catErr) throw catErr;
  if (prodErr) throw prodErr;

  const oosAtOutlet = new Set(
    ((ovs as { data: { product_id: string }[] | null }).data ?? []).map((o) => o.product_id),
  );

  return {
    categories: (cats ?? []) as Category[],
    // Backoffice can soft-hide noisy modifier groups or specific options
    // (think "ice level: cold", "cup type", etc) without losing the StoreHub
    // source data. Customers shouldn't see them — strip both at read time.
    products: ((prods ?? []) as RawProduct[])
      .filter((p) => !oosAtOutlet.has(p.id))
      .map((p) => {
        const hidden = new Set(Array.isArray(p.hidden_modifier_ids) ? p.hidden_modifier_ids : []);
        const modifiers = Array.isArray(p.modifiers) ? p.modifiers : [];
        return {
          ...p,
          modifiers: modifiers
            .filter((g) => !hidden.has(g.id))
            .map((g) => ({
              ...g,
              options: g.options.filter((opt) => !hidden.has(opt.id)),
            }))
            // Drop a group entirely if every option got hidden — empty
            // selectors confuse the product detail screen.
            .filter((g) => g.options.length > 0),
        };
      }),
  };
}

export type OrderDetail = {
  id:             string;
  order_number:   string;
  status:         string;
  // All monetary fields are integer sen (1 RM = 100 sen).
  subtotal:                    number;
  discount_amount:             number;          // voucher discount
  reward_discount_amount:      number;          // loyalty reward
  first_order_discount_amount: number;
  promo_discount:              number;          // promotion engine
  sst_amount:                  number;
  total:                       number;          // grand total after all
  reward_name:    string | null;
  voucher_code:   string | null;
  store_id:       string | null;
  /** Outlet display name + address, joined from outlet_settings. May
   *  be null on orders placed before the server started sending the
   *  join (older API binaries). */
  store_name?:    string | null;
  store_address?: string | null;
  created_at:     string;
  /** ISO timestamp the customer wants pickup. Null = ASAP (brew now). */
  pickup_at?:     string | null;
  payment_method: string | null;
  /** Base Beans earned on this order (before any Mystery Bean
   *  multiplier). Used by the MysteryBean reveal card to compute the
   *  post-multiplier total. May be 0 for guest orders. */
  loyalty_points_earned?: number;
  order_items: Array<{
    product_id:   string | null;
    product_name: string | null;
    quantity:     number;
    unit_price:   number;
    item_total:   number;
    modifiers:    unknown;
  }>;
};

// Fetch a single order via the order-app API instead of querying
// the `orders` table directly with the public anon key. The direct
// path worked while RLS was open, but anon read on the orders table
// is going away as part of the lockdown — and the same data is
// exposed at the API endpoint with identical shape.
export async function fetchOrder(orderId: string): Promise<OrderDetail> {
  const res = await fetch(
    `https://order.celsiuscoffee.com/api/orders/${encodeURIComponent(orderId)}`,
    {
      headers: {
        "Content-Type": "application/json",
        Origin:  "https://order.celsiuscoffee.com",
        Referer: "https://order.celsiuscoffee.com/",
      },
    }
  );
  if (!res.ok) throw new Error(`Order fetch failed (${res.status})`);
  return (await res.json()) as OrderDetail;
}
