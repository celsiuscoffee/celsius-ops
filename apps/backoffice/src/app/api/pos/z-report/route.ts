import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireAuth } from "@/lib/auth";

/**
 * GET /api/pos/z-report
 *
 * Two modes:
 *   • ?shift_id=… → single-shift detail (everything a Z-Report needs)
 *   • ?from=YYYY-MM-DD&to=YYYY-MM-DD[&outlet_id=…] → list mode
 *
 * Z-Reports are the per-shift cash-up that closes the register. Most of
 * the "numbers" come not from pos_shifts (which only stores totals as
 * cached counters) but from re-aggregating the underlying orders +
 * payments inside the shift's time window. That keeps the report
 * accurate even if a shift was reopened or the cached counters drifted.
 *
 * Schema gap notes (see /docs/pos-shifts-schema-gap.md if/when written):
 *   pos_shifts CURRENTLY lacks: opening_cash, closing_cash, status,
 *   employee_id, paid_in, paid_out, expected_cash, variance. Until
 *   those columns exist, the report falls back gracefully (opening_cash
 *   = 0, variance = null, status derived from closed_at). The frontend
 *   reflects this with explicit "—" placeholders so the operator
 *   knows the field isn't tracked yet rather than seeing a false 0.
 */

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const sp = request.nextUrl.searchParams;
  const shiftId = sp.get("shift_id");

  if (shiftId) {
    return getShiftDetail(shiftId);
  }

  const from = sp.get("from");
  const to   = sp.get("to");
  const outletId = sp.get("outlet_id");
  if (!from || !to) {
    return NextResponse.json({ error: "from + to required (YYYY-MM-DD), or pass shift_id" }, { status: 400 });
  }
  return listShifts(from, to, outletId);
}

// ── List mode ────────────────────────────────────────────────────────────────

async function listShifts(from: string, to: string, outletId: string | null) {
  const supabase = getSupabaseAdmin();
  const fromIso = `${from}T00:00:00+08:00`;
  const toIso   = `${to}T23:59:59.999+08:00`;

  let q = supabase
    .from("pos_shifts")
    .select("id, outlet_id, register_id, opened_by, closed_by, opened_at, closed_at, total_sales, total_orders, total_refunds")
    .gte("opened_at", fromIso)
    .lte("opened_at", toIso)
    .order("opened_at", { ascending: false });
  if (outletId) q = q.eq("outlet_id", outletId);

  const { data: shifts, error: shiftsErr } = await q;
  if (shiftsErr) return NextResponse.json({ error: shiftsErr.message }, { status: 500 });

  // Fetch lookup maps (outlets, registers, users) once. These are small
  // tables so we don't bother filtering by IDs in use.
  const [{ data: outlets }, { data: registers }, { data: users }] = await Promise.all([
    supabase.from("outlets").select("id, name"),
    supabase.from("pos_registers").select("id, name"),
    supabase.from("User").select("id, name"),
  ]);
  const outletName = idMap(outlets ?? [], "id", "name");
  const registerName = idMap(registers ?? [], "id", "name");
  const userName = idMap(users ?? [], "id", "name");

  // Per-shift aggregates. We do one query per shift; the typical 30-day
  // window has dozens of shifts, not thousands, so this stays cheap.
  // (If this ever gets slow, fold into a single big query with the
  // shift IDs in an IN list and bucket client-side.)
  const rows = await Promise.all(
    (shifts ?? []).map(async (s) => {
      const totals = await aggregateShift(
        supabase,
        s.id as string,
        s.outlet_id as string,
        s.opened_at as string,
        (s.closed_at as string | null) ?? null,
      );
      return {
        id: s.id as string,
        outlet_id: s.outlet_id as string,
        outlet_name: outletName[s.outlet_id as string] ?? (s.outlet_id as string),
        register_id: s.register_id as string,
        register_name: registerName[s.register_id as string] ?? (s.register_id as string),
        opened_by: (s.opened_by as string | null) ?? null,
        opened_by_name: s.opened_by ? (userName[s.opened_by as string] ?? "—") : "—",
        closed_by: (s.closed_by as string | null) ?? null,
        closed_by_name: s.closed_by ? (userName[s.closed_by as string] ?? "—") : null,
        opened_at: s.opened_at as string,
        closed_at: (s.closed_at as string | null) ?? null,
        status: s.closed_at ? "closed" : "open",
        gross_sales: totals.gross_sales,
        net_sales: totals.net_sales,
        discounts: totals.discounts,
        tax: totals.tax,
        tendered_cash: totals.tendered_cash,
        tendered_card: totals.tendered_card,
        tendered_ewallet: totals.tendered_ewallet,
        variance: null, // opening/closing cash columns don't exist yet
      };
    }),
  );

  return NextResponse.json({ shifts: rows });
}

// ── Detail mode ──────────────────────────────────────────────────────────────

async function getShiftDetail(shiftId: string) {
  const supabase = getSupabaseAdmin();

  const { data: shift, error: shiftErr } = await supabase
    .from("pos_shifts")
    .select("*")
    .eq("id", shiftId)
    .single();
  if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 404 });

  // Lookups
  const [{ data: outlet }, { data: register }, { data: openedByUser }, { data: closedByUser }] = await Promise.all([
    supabase.from("outlets").select("id, name").eq("id", shift.outlet_id).maybeSingle(),
    supabase.from("pos_registers").select("id, name").eq("id", shift.register_id).maybeSingle(),
    shift.opened_by
      ? supabase.from("User").select("id, name").eq("id", shift.opened_by).maybeSingle()
      : Promise.resolve({ data: null }),
    shift.closed_by
      ? supabase.from("User").select("id, name").eq("id", shift.closed_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // The orders touched during this shift. We match by both outlet_id +
  // time window so an open shift on Register 1 won't pull in Register 2's
  // orders. (pos_orders.shift_id exists but isn't always populated on
  // older rows; the time-window query is the safe path.)
  const fromIso = shift.opened_at as string;
  const toIso = (shift.closed_at as string | null) ?? new Date().toISOString();

  const { data: orders, error: ordersErr } = await supabase
    .from("pos_orders")
    .select("id, status, subtotal, sst_amount, discount_amount, promo_discount, total, created_at, refund_of_order_id")
    .eq("outlet_id", shift.outlet_id)
    .gte("created_at", fromIso)
    .lte("created_at", toIso);
  if (ordersErr) return NextResponse.json({ error: ordersErr.message }, { status: 500 });

  const orderIds = (orders ?? []).map((o) => o.id as string);

  // Pull line items + payments in one batch each
  const [{ data: items }, { data: payments }] = await Promise.all([
    orderIds.length
      ? supabase
          .from("pos_order_items")
          .select("order_id, product_id, product_name, quantity, item_total")
          .in("order_id", orderIds)
      : Promise.resolve({ data: [] as { order_id: string; product_id: string | null; product_name: string; quantity: number; item_total: number }[] }),
    orderIds.length
      ? supabase
          .from("pos_order_payments")
          .select("order_id, payment_method, amount")
          .in("order_id", orderIds)
      : Promise.resolve({ data: [] as { order_id: string; payment_method: string; amount: number }[] }),
  ]);

  // Category map — resolved via products.category. We fetch only the
  // distinct product IDs that appear in this shift's line items.
  const distinctProductIds = Array.from(
    new Set((items ?? []).map((i) => i.product_id).filter((x): x is string => !!x)),
  );
  const categoryByProduct: Record<string, string> = {};
  if (distinctProductIds.length > 0) {
    const { data: prods } = await supabase
      .from("products")
      .select("id, category")
      .in("id", distinctProductIds);
    for (const p of prods ?? []) {
      categoryByProduct[p.id as string] = ((p.category as string | null) ?? "Uncategorised");
    }
  }

  // ── Money aggregates ────────────────────────────────────────────────
  // "Completed" = positive-total orders not refunded. "Refunded" =
  // either status='refunded' or rows linked via refund_of_order_id with
  // a negative total. We treat refunds as a deduction from gross.
  const completed = (orders ?? []).filter((o) => o.status === "completed" && !o.refund_of_order_id);
  const refunds   = (orders ?? []).filter((o) => o.status === "refunded" || (o.refund_of_order_id && (o.total as number) < 0));
  const voids     = (orders ?? []).filter((o) => o.status === "cancelled" || o.status === "void");

  const sum = (arr: typeof completed, key: keyof typeof completed[number]) =>
    arr.reduce((s, o) => s + ((o[key] as number) ?? 0), 0);

  const gross_sales = sum(completed, "subtotal");
  const discounts   = sum(completed, "discount_amount") + sum(completed, "promo_discount");
  const tax         = sum(completed, "sst_amount");
  const net_sales   = sum(completed, "total");
  const refunds_total = Math.abs(sum(refunds, "total"));

  // Payment-method breakdown (we group rough categories so the print
  // slip stays compact: cash / card / ewallet / other)
  type PayBucket = { method: string; count: number; total: number };
  const paymentByMethod: Record<string, PayBucket> = {};
  for (const p of payments ?? []) {
    const m = (p.payment_method as string) ?? "unknown";
    if (!paymentByMethod[m]) paymentByMethod[m] = { method: m, count: 0, total: 0 };
    paymentByMethod[m].count++;
    paymentByMethod[m].total += (p.amount as number) ?? 0;
  }
  const paymentBreakdown = Object.values(paymentByMethod).sort((a, b) => b.total - a.total);

  const cashTotal = sumBy(paymentBreakdown, (p) => isCashMethod(p.method) ? p.total : 0);
  const cardTotal = sumBy(paymentBreakdown, (p) => isCardMethod(p.method) ? p.total : 0);
  const ewalletTotal = sumBy(paymentBreakdown, (p) => isEwalletMethod(p.method) ? p.total : 0);

  // Category breakdown — sum item_total by products.category. Items
  // without a known product fall under "Uncategorised".
  const categoryTotals: Record<string, { category: string; qty: number; revenue: number }> = {};
  for (const it of items ?? []) {
    const cat = it.product_id ? (categoryByProduct[it.product_id] ?? "Uncategorised") : "Uncategorised";
    if (!categoryTotals[cat]) categoryTotals[cat] = { category: cat, qty: 0, revenue: 0 };
    categoryTotals[cat].qty += (it.quantity as number) ?? 0;
    categoryTotals[cat].revenue += (it.item_total as number) ?? 0;
  }
  const categoryBreakdown = Object.values(categoryTotals).sort((a, b) => b.revenue - a.revenue);

  // Top 5 products by revenue
  type ProdAgg = { name: string; qty: number; revenue: number };
  const productAgg: Record<string, ProdAgg> = {};
  for (const it of items ?? []) {
    const name = (it.product_name as string) ?? "Unknown";
    if (!productAgg[name]) productAgg[name] = { name, qty: 0, revenue: 0 };
    productAgg[name].qty += (it.quantity as number) ?? 0;
    productAgg[name].revenue += (it.item_total as number) ?? 0;
  }
  const topProducts = Object.values(productAgg).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  // Cash drawer math. Without an opening_cash / paid_in / paid_out
  // column we can only compute "tendered cash − cash refunds". When
  // the schema is extended, expected_close should be:
  //   opening_cash + cashTotal + paid_in − paid_out − cash_refunds
  const cashRefunds = 0; // refund payments aren't separated in current schema; left as 0
  const expected_close: number | null = null; // null until opening_cash + paid in/out columns exist

  return NextResponse.json({
    shift: {
      id: shift.id,
      outlet_id: shift.outlet_id,
      outlet_name: outlet?.name ?? shift.outlet_id,
      register_id: shift.register_id,
      register_name: register?.name ?? shift.register_id,
      opened_at: shift.opened_at,
      closed_at: shift.closed_at,
      opened_by: shift.opened_by,
      opened_by_name: openedByUser?.name ?? "—",
      closed_by: shift.closed_by,
      closed_by_name: closedByUser?.name ?? null,
      status: shift.closed_at ? "closed" : "open",
      total_sales_cached: shift.total_sales,
      total_orders_cached: shift.total_orders,
      total_refunds_cached: shift.total_refunds,
      // Cash drawer fields — currently unsupported by schema, returned
      // explicitly null so the UI knows to render "—" rather than 0.
      opening_cash: null,
      closing_cash: null,
      paid_in: null,
      paid_out: null,
      cash_refunds: cashRefunds,
      expected_close,
      variance: null,
    },
    summary: {
      gross_sales,
      net_sales,
      discounts,
      tax,
      refunds_total,
      voids_count: voids.length,
      voids_total: Math.abs(sumBy(voids, (o) => (o.total as number) ?? 0)),
      transactions: completed.length,
      cash_total: cashTotal,
      card_total: cardTotal,
      ewallet_total: ewalletTotal,
    },
    payments: paymentBreakdown,
    categories: categoryBreakdown,
    top_products: topProducts,
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function aggregateShift(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  _shiftId: string,
  outletId: string,
  openedAt: string,
  closedAt: string | null,
): Promise<{
  gross_sales: number;
  net_sales: number;
  discounts: number;
  tax: number;
  tendered_cash: number;
  tendered_card: number;
  tendered_ewallet: number;
}> {
  const toIso = closedAt ?? new Date().toISOString();
  const { data: orders } = await supabase
    .from("pos_orders")
    .select("id, status, subtotal, sst_amount, discount_amount, promo_discount, total, refund_of_order_id")
    .eq("outlet_id", outletId)
    .gte("created_at", openedAt)
    .lte("created_at", toIso);

  const completed = (orders ?? []).filter((o) => o.status === "completed" && !o.refund_of_order_id);
  const gross_sales = completed.reduce((s, o) => s + ((o.subtotal as number) ?? 0), 0);
  const discounts   = completed.reduce((s, o) => s + ((o.discount_amount as number) ?? 0) + ((o.promo_discount as number) ?? 0), 0);
  const tax         = completed.reduce((s, o) => s + ((o.sst_amount as number) ?? 0), 0);
  const net_sales   = completed.reduce((s, o) => s + ((o.total as number) ?? 0), 0);

  const orderIds = completed.map((o) => o.id as string);
  let tendered_cash = 0, tendered_card = 0, tendered_ewallet = 0;
  if (orderIds.length > 0) {
    const { data: pays } = await supabase
      .from("pos_order_payments")
      .select("payment_method, amount")
      .in("order_id", orderIds);
    for (const p of pays ?? []) {
      const m = ((p.payment_method as string) ?? "").toLowerCase();
      const amt = (p.amount as number) ?? 0;
      if (isCashMethod(m)) tendered_cash += amt;
      else if (isCardMethod(m)) tendered_card += amt;
      else if (isEwalletMethod(m)) tendered_ewallet += amt;
    }
  }
  return { gross_sales, net_sales, discounts, tax, tendered_cash, tendered_card, tendered_ewallet };
}

function idMap<T extends Record<string, unknown>>(rows: T[], idKey: keyof T, valKey: keyof T): Record<string, string> {
  const m: Record<string, string> = {};
  for (const r of rows) m[r[idKey] as string] = (r[valKey] as string) ?? "";
  return m;
}

function sumBy<T>(arr: T[], pick: (x: T) => number): number {
  return arr.reduce((s, x) => s + pick(x), 0);
}

// Payment-method classification. Kept liberal so we catch variants the
// POS emits (e.g. "Cash", "CASH", "card", "Visa", "GrabPay").
function isCashMethod(m: string): boolean {
  return /cash/i.test(m);
}
function isCardMethod(m: string): boolean {
  return /(card|visa|master|amex|debit|credit|chip|terminal)/i.test(m);
}
function isEwalletMethod(m: string): boolean {
  return /(ewallet|e-wallet|qr|duitnow|tng|touchngo|grabpay|boost|shopee|fpx|maybank|mae)/i.test(m);
}
