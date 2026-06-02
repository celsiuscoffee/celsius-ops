import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireAuth } from "@/lib/auth";

/**
 * GET /api/pos/reports
 *
 * Aggregated POS analytics. Returns 4 buckets used by the Reports page:
 *   sales    — last 14 days of completed orders (date, orders, revenue)
 *   payments — payment-method breakdown
 *   products — top 15 products by revenue
 *   staff    — per-cashier totals
 *
 * RLS-safe: runs under service-role from the BO admin context. Money
 * values are returned in sen (integer) — the client converts to RM for
 * display.
 */

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const supabase = getSupabaseAdmin();

  const { data: orders, error: ordersErr } = await supabase
    .from("pos_orders")
    .select("id, total, status, created_at, employee_id")
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(5000);

  if (ordersErr) {
    return NextResponse.json({ error: ordersErr.message }, { status: 500 });
  }

  const completedOrders = orders ?? [];

  // ── Sales by date (last 14) ────────────────────────────────
  const byDate: Record<string, { orders: number; revenue: number }> = {};
  for (const o of completedOrders) {
    const d = (o.created_at as string).split("T")[0];
    if (!byDate[d]) byDate[d] = { orders: 0, revenue: 0 };
    byDate[d].orders++;
    byDate[d].revenue += (o.total as number) ?? 0;
  }
  const sales = Object.entries(byDate)
    .map(([date, v]) => ({
      date,
      orders: v.orders,
      revenue: v.revenue,
      avg_order: v.orders > 0 ? Math.round(v.revenue / v.orders) : 0,
    }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 14);

  // ── Top products by revenue ────────────────────────────────
  const { data: items } = await supabase
    .from("pos_order_items")
    .select("product_name, quantity, item_total")
    .limit(20000);
  const byProduct: Record<string, { qty: number; revenue: number }> = {};
  for (const i of items ?? []) {
    const name = i.product_name as string;
    if (!byProduct[name]) byProduct[name] = { qty: 0, revenue: 0 };
    byProduct[name].qty += (i.quantity as number) ?? 0;
    byProduct[name].revenue += (i.item_total as number) ?? 0;
  }
  const totalProdRev = Object.values(byProduct).reduce((s, p) => s + p.revenue, 0) || 1;
  const products = Object.entries(byProduct)
    .map(([name, v]) => ({
      name,
      qty: v.qty,
      revenue: v.revenue,
      pct: Math.round((v.revenue / totalProdRev) * 100),
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 15);

  // ── Payment-method breakdown ───────────────────────────────
  const orderIds = completedOrders.map((o) => o.id as string);
  let payments: { method: string; count: number; total: number; pct: number }[] = [];
  if (orderIds.length > 0) {
    const { data: pays } = await supabase
      .from("pos_order_payments")
      .select("payment_method, amount")
      .in("order_id", orderIds);
    const byPayment: Record<string, { count: number; total: number }> = {};
    for (const p of pays ?? []) {
      const m = (p.payment_method as string) ?? "Unknown";
      if (!byPayment[m]) byPayment[m] = { count: 0, total: 0 };
      byPayment[m].count++;
      byPayment[m].total += (p.amount as number) ?? 0;
    }
    const totalPayRev = Object.values(byPayment).reduce((s, p) => s + p.total, 0) || 1;
    payments = Object.entries(byPayment)
      .map(([method, v]) => ({
        method,
        count: v.count,
        total: v.total,
        pct: Math.round((v.total / totalPayRev) * 100),
      }))
      .sort((a, b) => b.total - a.total);
  }

  // ── Staff performance ──────────────────────────────────────
  // pos_orders carries only employee_id (= User.id); the name lives in the User
  // table — resolve it here (same pattern as the Z-Report). Best-effort: a
  // lookup miss degrades to a generic label, never a 500.
  const empIds = [...new Set(completedOrders.map((o) => o.employee_id as string | null).filter(Boolean))] as string[];
  const nameById: Record<string, string> = {};
  if (empIds.length > 0) {
    const { data: users } = await supabase.from("User").select("id, name").in("id", empIds);
    for (const u of users ?? []) nameById[u.id as string] = (u.name as string) || "";
  }
  const byStaff: Record<string, { name: string; orders: number; revenue: number }> = {};
  for (const o of completedOrders) {
    const id = (o.employee_id as string) || "unknown";
    const name = nameById[id] || (id === "unknown" ? "Unassigned" : "Staff");
    if (!byStaff[id]) byStaff[id] = { name, orders: 0, revenue: 0 };
    byStaff[id].orders++;
    byStaff[id].revenue += (o.total as number) ?? 0;
  }
  const staff = Object.entries(byStaff)
    .map(([id, v]) => ({
      id,
      name: v.name,
      orders: v.orders,
      revenue: v.revenue,
      avg_order: v.orders > 0 ? Math.round(v.revenue / v.orders) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return NextResponse.json({ sales, products, payments, staff });
}
