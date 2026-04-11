"use client";

import { useState, useEffect } from "react";
import { displayRM } from "@/types/database";
import { createClient } from "@/lib/supabase-browser";

type ReportTab = "sales" | "payments" | "products" | "staff";

type SalesRow = { date: string; orders: number; revenue: number; avgOrder: number };
type ProductRow = { name: string; qty: number; revenue: number; pct: number };
type StaffRow = { id: string; name: string; orders: number; revenue: number; avgOrder: number };
type PaymentRow = { method: string; count: number; total: number; pct: number };

export default function ReportsPage() {
  const [tab, setTab] = useState<ReportTab>("sales");
  const [salesData, setSalesData] = useState<SalesRow[]>([]);
  const [productData, setProductData] = useState<ProductRow[]>([]);
  const [staffData, setStaffData] = useState<StaffRow[]>([]);
  const [paymentData, setPaymentData] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      setLoading(true);

      // Fetch completed orders with payments
      const { data: orders } = await supabase
        .from("pos_orders")
        .select("id, total, status, created_at, employee_id, employee_name")
        .eq("status", "completed")
        .order("created_at", { ascending: false });

      const completedOrders = orders ?? [];

      // ── Sales by date ──
      const byDate: Record<string, { orders: number; revenue: number }> = {};
      for (const o of completedOrders) {
        const date = (o.created_at as string).split("T")[0];
        if (!byDate[date]) byDate[date] = { orders: 0, revenue: 0 };
        byDate[date].orders++;
        byDate[date].revenue += o.total ?? 0;
      }
      setSalesData(
        Object.entries(byDate)
          .map(([date, d]) => ({
            date,
            orders: d.orders,
            revenue: d.revenue,
            avgOrder: d.orders > 0 ? Math.round(d.revenue / d.orders) : 0,
          }))
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 14),
      );

      // ── Product mix ──
      const { data: items } = await supabase
        .from("pos_order_items")
        .select("product_name, quantity, item_total");
      const byProduct: Record<string, { qty: number; revenue: number }> = {};
      for (const i of items ?? []) {
        const name = i.product_name;
        if (!byProduct[name]) byProduct[name] = { qty: 0, revenue: 0 };
        byProduct[name].qty += i.quantity ?? 0;
        byProduct[name].revenue += i.item_total ?? 0;
      }
      const totalProdRev = Object.values(byProduct).reduce((s, p) => s + p.revenue, 0) || 1;
      setProductData(
        Object.entries(byProduct)
          .map(([name, d]) => ({
            name,
            qty: d.qty,
            revenue: d.revenue,
            pct: Math.round((d.revenue / totalProdRev) * 100),
          }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 15),
      );

      // ── Payment breakdown ──
      const orderIds = completedOrders.map((o) => o.id);
      const { data: payments } = orderIds.length > 0
        ? await supabase
            .from("pos_order_payments")
            .select("payment_method, amount")
            .in("order_id", orderIds)
        : { data: [] };
      const byPayment: Record<string, { count: number; total: number }> = {};
      for (const p of payments ?? []) {
        const method = p.payment_method ?? "Unknown";
        if (!byPayment[method]) byPayment[method] = { count: 0, total: 0 };
        byPayment[method].count++;
        byPayment[method].total += p.amount ?? 0;
      }
      const totalPayRev = Object.values(byPayment).reduce((s, p) => s + p.total, 0) || 1;
      setPaymentData(
        Object.entries(byPayment)
          .map(([method, d]) => ({
            method,
            count: d.count,
            total: d.total,
            pct: Math.round((d.total / totalPayRev) * 100),
          }))
          .sort((a, b) => b.total - a.total),
      );

      // ── Staff performance ──
      const byStaff: Record<string, { name: string; orders: number; revenue: number }> = {};
      for (const o of completedOrders) {
        const id = o.employee_id ?? "unknown";
        const name = (o as any).employee_name ?? "Unknown";
        if (!byStaff[id]) byStaff[id] = { name, orders: 0, revenue: 0 };
        byStaff[id].orders++;
        byStaff[id].revenue += o.total ?? 0;
      }
      setStaffData(
        Object.entries(byStaff)
          .map(([id, d]) => ({
            id,
            name: d.name,
            orders: d.orders,
            revenue: d.revenue,
            avgOrder: d.orders > 0 ? Math.round(d.revenue / d.orders) : 0,
          }))
          .sort((a, b) => b.revenue - a.revenue),
      );

      setLoading(false);
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalRevenue = salesData.reduce((s, d) => s + d.revenue, 0);
  const totalOrders = salesData.reduce((s, d) => s + d.orders, 0);
  const avgOrder = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;
  const topProduct = productData[0]?.name ?? "-";
  const topProductQty = productData[0]?.qty ?? 0;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="mt-1 text-sm text-text-muted">Business analytics and insights</p>
        </div>
        <div className="flex gap-2">
          <select className="h-9 rounded-lg border border-border bg-surface-raised px-3 text-sm text-text outline-none focus:border-brand">
            <option>All Branches</option>
            <option>Shah Alam</option>
            <option>IOI Conezion</option>
            <option>Tamarind</option>
          </select>
        </div>
      </div>

      {/* Summary cards */}
      <div className="mt-4 grid grid-cols-4 gap-4">
        {[
          { label: "Total Revenue", value: displayRM(totalRevenue) },
          { label: "Total Orders", value: String(totalOrders) },
          { label: "Avg Order Value", value: displayRM(avgOrder) },
          { label: "Top Product", value: topProduct, sub: `${topProductQty} sold` },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-surface-raised p-4">
            <p className="text-xs text-text-muted">{stat.label}</p>
            <p className="mt-1 text-xl font-bold">{stat.value}</p>
            {stat.sub && <p className="mt-0.5 text-[10px] text-brand">{stat.sub}</p>}
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="mt-6 flex gap-1 border-b border-border">
        {([
          ["sales", "Sales Summary"],
          ["payments", "Payment Methods"],
          ["products", "Product Mix"],
          ["staff", "Staff Performance"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === id ? "border-brand text-brand" : "border-transparent text-text-muted hover:text-text"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="mt-4">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand border-t-transparent" />
          </div>
        )}

        {!loading && tab === "sales" && (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface-raised text-left text-xs font-medium text-text-muted">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Orders</th>
                  <th className="px-4 py-3 text-right">Revenue</th>
                  <th className="px-4 py-3 text-right">Avg Order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {salesData.map((d) => (
                  <tr key={d.date} className="hover:bg-surface-hover">
                    <td className="px-4 py-3 text-sm font-medium">{d.date}</td>
                    <td className="px-4 py-3 text-right text-sm">{d.orders}</td>
                    <td className="px-4 py-3 text-right text-sm font-medium">{displayRM(d.revenue)}</td>
                    <td className="px-4 py-3 text-right text-sm text-text-muted">{displayRM(d.avgOrder)}</td>
                  </tr>
                ))}
                {salesData.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-text-dim">No sales data yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {!loading && tab === "payments" && (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface-raised text-left text-xs font-medium text-text-muted">
                  <th className="px-4 py-3">Payment Method</th>
                  <th className="px-4 py-3 text-right">Transactions</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">% of Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paymentData.map((p) => (
                  <tr key={p.method} className="hover:bg-surface-hover">
                    <td className="px-4 py-3 text-sm font-medium">{p.method}</td>
                    <td className="px-4 py-3 text-right text-sm">{p.count}</td>
                    <td className="px-4 py-3 text-right text-sm font-medium">{displayRM(p.total)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-16 rounded-full bg-surface">
                          <div className="h-1.5 rounded-full bg-brand" style={{ width: `${p.pct}%` }} />
                        </div>
                        <span className="text-xs text-text-muted">{p.pct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {paymentData.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-text-dim">No payment data yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {!loading && tab === "products" && (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface-raised text-left text-xs font-medium text-text-muted">
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3 text-right">Qty Sold</th>
                  <th className="px-4 py-3 text-right">Revenue</th>
                  <th className="px-4 py-3 text-right">% of Sales</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {productData.map((p, i) => (
                  <tr key={p.name} className="hover:bg-surface-hover">
                    <td className="px-4 py-3 text-xs text-text-dim">{i + 1}</td>
                    <td className="px-4 py-3 text-sm font-medium">{p.name}</td>
                    <td className="px-4 py-3 text-right text-sm">{p.qty}</td>
                    <td className="px-4 py-3 text-right text-sm font-medium">{displayRM(p.revenue)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-16 rounded-full bg-surface">
                          <div className="h-1.5 rounded-full bg-brand" style={{ width: `${p.pct}%` }} />
                        </div>
                        <span className="text-xs text-text-muted">{p.pct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {productData.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-text-dim">No product data yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {!loading && tab === "staff" && (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface-raised text-left text-xs font-medium text-text-muted">
                  <th className="px-4 py-3">Staff</th>
                  <th className="px-4 py-3 text-right">Orders</th>
                  <th className="px-4 py-3 text-right">Revenue</th>
                  <th className="px-4 py-3 text-right">Avg Order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {staffData.map((s) => (
                  <tr key={s.id} className="hover:bg-surface-hover">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/20 text-xs font-bold text-brand">
                          {s.name.charAt(0)}
                        </div>
                        <span className="text-sm font-medium">{s.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-sm">{s.orders}</td>
                    <td className="px-4 py-3 text-right text-sm font-medium">{displayRM(s.revenue)}</td>
                    <td className="px-4 py-3 text-right text-sm text-text-muted">{displayRM(s.avgOrder)}</td>
                  </tr>
                ))}
                {staffData.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-text-dim">No staff data yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
