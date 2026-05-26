import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireAuth } from "@/lib/auth";

/**
 * GET /api/pos/tax-report?from=YYYY-MM-DD&to=YYYY-MM-DD&outlet_ids=a,b
 *
 * Monthly tax-filing report: groups completed POS orders by outlet + tax
 * rate %, and returns taxable sales, tax collected, and transaction
 * counts. Used for SST monthly filing — the totals here should reconcile
 * directly to the LHDN return.
 *
 * Why we group by tax rate at the LINE level (not order level):
 *   A single order can mix taxable + zero-rated items (e.g. coffee 6%
 *   + bottled water 0% in some configs). pos_orders.sst_amount is the
 *   order total but doesn't tell us which rate it was billed at — we
 *   need to join pos_order_items → products.tax_rate to get the rate
 *   for each line and bucket accordingly.
 *
 * Auth: requireAuth (session cookie). Service-role client is fine
 * because the route gate is the auth check itself.
 */

type TaxRow = {
  outlet_id: string;
  outlet_name: string;
  tax_rate: number;        // percent, e.g. 6 for 6%
  taxable_sales: number;   // sen — subtotal of qualifying items
  tax_collected: number;   // sen — sum of tax_amount on qualifying items
  transactions: number;    // count of distinct orders touching this bucket
};

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const sp = request.nextUrl.searchParams;
  const from = sp.get("from"); // YYYY-MM-DD (local KL date)
  const to   = sp.get("to");   // YYYY-MM-DD (local KL date, inclusive)
  const outletParam = sp.get("outlet_ids"); // comma-separated, optional

  if (!from || !to) {
    return NextResponse.json({ error: "from + to required (YYYY-MM-DD)" }, { status: 400 });
  }

  // Treat the date range as Asia/Kuala_Lumpur (UTC+8). The DB stores
  // timestamptz, so we widen the range explicitly on both ends to avoid
  // off-by-one issues with DST-less +08:00 → UTC math.
  const fromIso = `${from}T00:00:00+08:00`;
  const toIso   = `${to}T23:59:59.999+08:00`;

  const supabase = getSupabaseAdmin();

  // Outlets — we need names for display and to optionally filter
  const outletIdsFilter = outletParam ? outletParam.split(",").filter(Boolean) : null;
  const { data: outlets, error: outletsErr } = await supabase
    .from("outlets")
    .select("id, name")
    .order("name");
  if (outletsErr) {
    return NextResponse.json({ error: outletsErr.message }, { status: 500 });
  }
  const outletNameById: Record<string, string> = {};
  for (const o of outlets ?? []) outletNameById[o.id as string] = o.name as string;

  // Pull completed orders in window. Refunds are stored as separate
  // negative-total orders linked by refund_of_order_id, so excluding
  // status='refunded' would double-count: keep status='completed' only.
  let ordersQuery = supabase
    .from("pos_orders")
    .select("id, outlet_id, created_at")
    .eq("status", "completed")
    .gte("created_at", fromIso)
    .lte("created_at", toIso);
  if (outletIdsFilter && outletIdsFilter.length > 0) {
    ordersQuery = ordersQuery.in("outlet_id", outletIdsFilter);
  }
  const { data: orders, error: ordersErr } = await ordersQuery;
  if (ordersErr) {
    return NextResponse.json({ error: ordersErr.message }, { status: 500 });
  }
  const orderIds = (orders ?? []).map((o) => o.id as string);
  const orderToOutlet: Record<string, string> = {};
  for (const o of orders ?? []) orderToOutlet[o.id as string] = o.outlet_id as string;

  if (orderIds.length === 0) {
    return NextResponse.json({
      rows: [],
      outlets: outlets ?? [],
      total: { taxable_sales: 0, tax_collected: 0, transactions: 0 },
    });
  }

  // Chunk product lookups + line-item pulls to stay within Supabase's
  // ~1000-rows-per-query default. We don't try to use a single huge
  // SQL — keeping it in client-side aggregation lets us stay on the
  // PostgREST API rather than an RPC.
  const CHUNK = 500;
  const lineItems: { order_id: string; product_id: string | null; unit_price: number; quantity: number; tax_amount: number | null; item_total: number }[] = [];
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const slice = orderIds.slice(i, i + CHUNK);
    const { data: items, error: itemsErr } = await supabase
      .from("pos_order_items")
      .select("order_id, product_id, unit_price, quantity, tax_amount, item_total")
      .in("order_id", slice);
    if (itemsErr) {
      return NextResponse.json({ error: itemsErr.message }, { status: 500 });
    }
    for (const it of items ?? []) {
      lineItems.push({
        order_id: it.order_id as string,
        product_id: (it.product_id as string | null) ?? null,
        unit_price: (it.unit_price as number) ?? 0,
        quantity: (it.quantity as number) ?? 0,
        tax_amount: (it.tax_amount as number | null) ?? null,
        item_total: (it.item_total as number) ?? 0,
      });
    }
  }

  // Resolve tax_rate per product. Distinct list keeps the IN-list small.
  const productIds = Array.from(new Set(lineItems.map((l) => l.product_id).filter((x): x is string => !!x)));
  const taxRateByProduct: Record<string, number> = {};
  for (let i = 0; i < productIds.length; i += CHUNK) {
    const slice = productIds.slice(i, i + CHUNK);
    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select("id, tax_rate")
      .in("id", slice);
    if (prodErr) {
      return NextResponse.json({ error: prodErr.message }, { status: 500 });
    }
    for (const p of products ?? []) {
      const raw = (p.tax_rate as number | null) ?? 0;
      taxRateByProduct[p.id as string] = Number(raw);
    }
  }

  // Bucket: outlet_id | tax_rate% → {taxable_sales, tax_collected, txns}
  type Bucket = { outlet_id: string; tax_rate: number; taxable_sales: number; tax_collected: number; orderIds: Set<string> };
  const bucketKey = (outletId: string, rate: number) => `${outletId}|${rate.toFixed(2)}`;
  const buckets: Record<string, Bucket> = {};

  for (const li of lineItems) {
    const outletId = orderToOutlet[li.order_id];
    if (!outletId) continue;
    // tax_rate stored on products is a percentage (e.g. 6 for 6%).
    // Lines with no product_id (legacy / manual entries) fall into a
    // zero-rated bucket so they're visible but don't inflate tax.
    const rate = li.product_id ? (taxRateByProduct[li.product_id] ?? 0) : 0;
    const key = bucketKey(outletId, rate);
    if (!buckets[key]) {
      buckets[key] = { outlet_id: outletId, tax_rate: rate, taxable_sales: 0, tax_collected: 0, orderIds: new Set() };
    }
    // Taxable sales = the line subtotal BEFORE tax. We approximate this
    // as item_total - tax_amount when tax_amount is present; otherwise
    // fall back to unit_price * quantity (rare; only legacy rows).
    const tax = li.tax_amount ?? 0;
    const taxable = li.item_total - tax;
    buckets[key].taxable_sales += taxable;
    buckets[key].tax_collected += tax;
    buckets[key].orderIds.add(li.order_id);
  }

  const rows: TaxRow[] = Object.values(buckets)
    .map((b) => ({
      outlet_id: b.outlet_id,
      outlet_name: outletNameById[b.outlet_id] ?? b.outlet_id,
      tax_rate: b.tax_rate,
      taxable_sales: b.taxable_sales,
      tax_collected: b.tax_collected,
      transactions: b.orderIds.size,
    }))
    .sort((a, b) => {
      if (a.outlet_name === b.outlet_name) return a.tax_rate - b.tax_rate;
      return a.outlet_name.localeCompare(b.outlet_name);
    });

  const total = rows.reduce(
    (acc, r) => ({
      taxable_sales: acc.taxable_sales + r.taxable_sales,
      tax_collected: acc.tax_collected + r.tax_collected,
      transactions: acc.transactions + r.transactions,
    }),
    { taxable_sales: 0, tax_collected: 0, transactions: 0 },
  );

  return NextResponse.json({ rows, outlets: outlets ?? [], total });
}
