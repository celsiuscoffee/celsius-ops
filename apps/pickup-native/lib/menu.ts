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
};

type RawProduct = Product & { hidden_modifier_ids?: string[] };

export async function fetchMenu(
  outletId?: string | null,
): Promise<{ categories: Category[]; products: Product[] }> {
  const productsQuery = supabase
    .from("products")
    .select("id,name,category,description,price,image_url,is_available,is_featured,modifiers,hidden_modifier_ids")
    .eq("brand_id", "brand-celsius")
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
  total:          number;
  store_id:       string | null;
  created_at:     string;
  payment_method: string | null;
  order_items: Array<{
    product_id:   string | null;
    product_name: string | null;
    quantity:     number;
    unit_price:   number;
    item_total:   number;
    modifiers:    unknown;
  }>;
};

export async function fetchOrder(orderId: string): Promise<OrderDetail> {
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id,order_number,status,total,store_id,created_at,payment_method," +
        "order_items(product_id,product_name,quantity,unit_price,item_total,modifiers)"
    )
    .eq("id", orderId)
    .single();
  if (error) throw error;
  return data as unknown as OrderDetail;
}
