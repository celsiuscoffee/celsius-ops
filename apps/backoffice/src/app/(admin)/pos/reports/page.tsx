"use client";

import { useEffect, useState } from "react";
import { Loader2, TrendingUp, ShoppingBag, Wallet, Trophy } from "lucide-react";
import { adminFetch } from "@/lib/pickup/admin-fetch";
import { toast } from "@celsius/ui";

/**
 * POS Reports — analytics over pos_orders + pos_order_items +
 * pos_order_payments. Ported from POS-local /backoffice/reports as part
 * of the BO-canonical migration. Money is sent in sen; format() does
 * the sen→RM conversion at display time.
 */

type Sales    = { date: string; orders: number; revenue: number; avg_order: number };
type Product  = { name: string; qty: number; revenue: number; pct: number };
type Payment  = { method: string; count: number; total: number; pct: number };
type Staff    = { id: string; name: string; orders: number; revenue: number; avg_order: number };
type Reports  = { sales: Sales[]; products: Product[]; payments: Payment[]; staff: Staff[] };

const formatRM = (sen: number) =>
  `RM ${(sen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const TABS = [
  { id: "sales",    label: "Sales Summary"     },
  { id: "payments", label: "Payment Methods"   },
  { id: "products", label: "Product Mix"       },
  { id: "staff",    label: "Staff Performance" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function POSReportsPage() {
  const [tab, setTab] = useState<TabId>("sales");
  const [data, setData] = useState<Reports | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await adminFetch("/api/pos/reports");
        if (!res.ok) throw new Error("Load failed");
        const json = (await res.json()) as Reports;
        if (!cancelled) setData(json);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load reports");
      } finally {
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const sales    = data?.sales    ?? [];
  const payments = data?.payments ?? [];
  const products = data?.products ?? [];
  const staff    = data?.staff    ?? [];

  const totalRevenue = sales.reduce((s, d) => s + d.revenue, 0);
  const totalOrders  = sales.reduce((s, d) => s + d.orders,  0);
  const avgOrder     = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;
  const topProduct   = products[0]?.name ?? "—";
  const topProductQty = products[0]?.qty ?? 0;

  return (
    <div className="p-3 sm:p-6 space-y-5 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-[#160800]">POS Reports</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Last 14 days of completed POS orders — sales, payment methods, product mix, staff performance.
        </p>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard Icon={Wallet}      label="Total Revenue"   value={formatRM(totalRevenue)} />
        <KpiCard Icon={ShoppingBag} label="Total Orders"    value={String(totalOrders)} />
        <KpiCard Icon={TrendingUp}  label="Avg Order Value" value={formatRM(avgOrder)} />
        <KpiCard Icon={Trophy}      label="Top Product"     value={topProduct} sub={topProductQty > 0 ? `${topProductQty} sold` : undefined} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-[#160800] text-[#160800]"
                : "border-transparent text-muted-foreground hover:text-[#160800]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      )}

      {!loading && tab === "sales" && (
        <Table cols={["Date", "Orders", "Revenue", "Avg Order"]} empty="No sales data yet">
          {sales.map((d) => (
            <tr key={d.date} className="hover:bg-gray-50">
              <Td>{d.date}</Td>
              <Td align="right">{d.orders}</Td>
              <Td align="right" bold>{formatRM(d.revenue)}</Td>
              <Td align="right" muted>{formatRM(d.avg_order)}</Td>
            </tr>
          ))}
        </Table>
      )}

      {!loading && tab === "payments" && (
        <Table cols={["Payment Method", "Transactions", "Total", "% of Revenue"]} empty="No payment data yet">
          {payments.map((p) => (
            <tr key={p.method} className="hover:bg-gray-50">
              <Td>{p.method}</Td>
              <Td align="right">{p.count}</Td>
              <Td align="right" bold>{formatRM(p.total)}</Td>
              <Td align="right"><PctBar pct={p.pct} /></Td>
            </tr>
          ))}
        </Table>
      )}

      {!loading && tab === "products" && (
        <Table cols={["#", "Product", "Qty Sold", "Revenue", "% of Sales"]} empty="No product data yet">
          {products.map((p, i) => (
            <tr key={p.name} className="hover:bg-gray-50">
              <Td muted>{i + 1}</Td>
              <Td>{p.name}</Td>
              <Td align="right">{p.qty}</Td>
              <Td align="right" bold>{formatRM(p.revenue)}</Td>
              <Td align="right"><PctBar pct={p.pct} /></Td>
            </tr>
          ))}
        </Table>
      )}

      {!loading && tab === "staff" && (
        <Table cols={["Staff", "Orders", "Revenue", "Avg Order"]} empty="No staff data yet">
          {staff.map((s) => (
            <tr key={s.id} className="hover:bg-gray-50">
              <Td>
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#FBEBE8] text-xs font-bold text-[#A2492C]">
                    {s.name.charAt(0)}
                  </div>
                  <span>{s.name}</span>
                </div>
              </Td>
              <Td align="right">{s.orders}</Td>
              <Td align="right" bold>{formatRM(s.revenue)}</Td>
              <Td align="right" muted>{formatRM(s.avg_order)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function KpiCard({
  Icon, label, value, sub,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-4 border border-gray-100">
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="h-4 w-4 text-[#A2492C]" />
        <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">{label}</p>
      </div>
      <p className="text-xl font-bold text-[#160800]">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-[#A2492C]">{sub}</p>}
    </div>
  );
}

function Table({ cols, empty, children }: { cols: string[]; empty: string; children: React.ReactNode }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-700">
            {cols.map((c, i) => (
              <th key={c} className={`px-4 py-3 ${i === 0 ? "" : "text-right"}`}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {hasRows ? children : (
            <tr><td colSpan={cols.length} className="px-4 py-10 text-center text-sm text-gray-500">{empty}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Td({
  children, align, bold, muted,
}: {
  children: React.ReactNode;
  align?: "right" | "left";
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <td className={`px-4 py-3 text-sm ${align === "right" ? "text-right" : ""} ${bold ? "font-medium" : ""} ${muted ? "text-gray-500" : "text-[#160800]"}`}>
      {children}
    </td>
  );
}

function PctBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-16 rounded-full bg-gray-200">
        <div className="h-1.5 rounded-full bg-[#A2492C]" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
    </div>
  );
}
