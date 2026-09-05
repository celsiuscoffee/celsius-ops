"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { ArrowLeft, Loader2, Trash2, DollarSign, AlertTriangle, Package } from "lucide-react";
import { ReportTable, type ReportColumn } from "@/components/reports/report-table";

type Outlet = { id: string; name: string };

type WastageItem = {
  id: string;
  date: string;
  outletId: string;
  outletName: string;
  productId: string;
  productName: string;
  sku: string;
  category: string;
  baseUom: string;
  type: string;
  quantity: number;
  cost: number;
  reason: string | null;
  adjustedBy: string;
};

type ByProduct = {
  productName: string;
  sku: string;
  totalQty: number;
  totalCost: number;
  count: number;
};

type WastageData = {
  summary: {
    totalWasteQty: number;
    totalWasteCost: number;
    adjustmentCount: number;
    affectedProducts: number;
  };
  outlets: Outlet[];
  byOutlet: { outletName: string; totalQty: number; totalCost: number; adjustmentCount: number }[];
  byType: { type: string; totalQty: number; totalCost: number; count: number }[];
  byProduct: ByProduct[];
  items: WastageItem[];
};

const TYPE_COLORS: Record<string, string> = {
  WASTAGE: "bg-red-100 text-red-700 border-red-200",
  EXPIRED: "bg-orange-100 text-orange-700 border-orange-200",
  BREAKAGE: "bg-yellow-100 text-yellow-700 border-yellow-200",
  SPILLAGE: "bg-blue-100 text-blue-700 border-blue-200",
  THEFT: "bg-purple-100 text-purple-700 border-purple-200",
  USED_NOT_RECORDED: "bg-gray-100 text-gray-700 border-gray-200",
};

function fmt(n: number) {
  return n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
}

function toInputDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function WastageReportPage() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [outletId, setOutletId] = useState("");
  const [from, setFrom] = useState(toInputDate(thirtyDaysAgo));
  const [to, setTo] = useState(toInputDate(now));
  const [tab, setTab] = useState<"product" | "detail">("product");

  const params = new URLSearchParams();
  if (outletId) params.set("outletId", outletId);
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const url = `/api/inventory/reports/wastage?${params.toString()}`;
  const { data, isLoading } = useFetch<WastageData>(url);

  // Filter items
  const avgCost =
    data && data.summary.adjustmentCount > 0
      ? data.summary.totalWasteCost / data.summary.adjustmentCount
      : 0;

  return (
    <div className="p-3 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/inventory/reports" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Wastage Report</h2>
          <p className="text-sm text-gray-500">Waste, breakage, expired, spillage &amp; theft tracking</p>
        </div>
      </div>

      {/* Summary cards */}
      {data && (
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-red-50 p-2"><DollarSign className="h-4 w-4 text-red-600" /></div>
              <span className="text-sm text-gray-500">Total Waste Cost</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-red-600">RM {fmt(data.summary.totalWasteCost)}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-orange-50 p-2"><Trash2 className="h-4 w-4 text-orange-600" /></div>
              <span className="text-sm text-gray-500">Adjustments</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-gray-900">{data.summary.adjustmentCount}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-blue-50 p-2"><Package className="h-4 w-4 text-blue-600" /></div>
              <span className="text-sm text-gray-500">Affected Products</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-gray-900">{data.summary.affectedProducts}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-purple-50 p-2"><AlertTriangle className="h-4 w-4 text-purple-600" /></div>
              <span className="text-sm text-gray-500">Avg Cost/Adjustment</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-gray-900">RM {fmt(avgCost)}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <select
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
          value={outletId}
          onChange={(e) => setOutletId(e.target.value)}
        >
          <option value="">All Outlets</option>
          {(data?.outlets ?? []).map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        <input
          type="date"
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input
          type="date"
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>

      {/* Tab toggle */}
      <div className="mt-4 flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 w-fit">
        <button
          onClick={() => setTab("product")}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
            tab === "product" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          By Product
        </button>
        <button
          onClick={() => setTab("detail")}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
            tab === "detail" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Detail
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
        </div>
      )}

      {/* By Product table */}
      {data && tab === "product" && (
        <ReportTable<ByProduct>
          rows={data.byProduct}
          rowKey={(p) => p.sku}
          csvFilename="wastage-by-product"
          emptyMessage="No wastage records found."
          searchPlaceholder="Search product or SKU…"
          searchText={(p) => `${p.productName} ${p.sku}`}
          initialSort={{ key: "totalCost", dir: "desc" }}
          minWidth={640}
          columns={wastageProductColumns}
        />
      )}

      {/* Detail table */}
      {data && tab === "detail" && (
        <ReportTable<WastageItem>
          rows={data.items}
          rowKey={(it) => it.id}
          csvFilename="wastage-detail"
          emptyMessage="No wastage records found."
          searchPlaceholder="Search product, SKU, reason or staff…"
          searchText={(it) => `${it.productName} ${it.sku} ${it.category} ${it.outletName} ${it.type} ${it.reason ?? ""} ${it.adjustedBy}`}
          initialSort={{ key: "cost", dir: "desc" }}
          minWidth={940}
          facets={[
            { key: "outlet", label: "Outlets", value: (it) => it.outletName },
            { key: "type", label: "Types", value: (it) => it.type.replace(/_/g, " ") },
            { key: "category", label: "Categories", value: (it) => it.category },
            { key: "staff", label: "Staff", value: (it) => it.adjustedBy },
          ]}
          toggles={[{ key: "noReason", label: "No reason given", predicate: (it) => !it.reason }]}
          columns={wastageDetailColumns}
        />
      )}
    </div>
  );
}

const wastageProductColumns: ReportColumn<ByProduct>[] = [
  {
    key: "productName", header: "Product", sortValue: (p) => p.productName, csv: (p) => p.productName,
    render: (p) => (
      <>
        <p className="font-medium text-gray-900">{p.productName}</p>
        <code className="text-xs text-gray-400">{p.sku}</code>
      </>
    ),
  },
  { key: "totalQty", header: "Total Waste Qty", align: "right", sortValue: (p) => p.totalQty, render: (p) => <span className="font-mono text-gray-900">{fmt(p.totalQty)}</span> },
  { key: "totalCost", header: "Total Cost", align: "right", sortValue: (p) => p.totalCost, render: (p) => <span className="font-mono font-medium text-red-600">RM {fmt(p.totalCost)}</span> },
  { key: "count", header: "Adjustments", align: "right", sortValue: (p) => p.count, render: (p) => <span className="font-mono text-gray-600">{p.count}</span> },
];

const wastageDetailColumns: ReportColumn<WastageItem>[] = [
  { key: "date", header: "Date", sortValue: (it) => it.date, csv: (it) => it.date, render: (it) => <span className="whitespace-nowrap text-gray-600">{formatDate(it.date)}</span> },
  { key: "outletName", header: "Outlet", sortValue: (it) => it.outletName, render: (it) => <span className="text-gray-600">{it.outletName}</span> },
  {
    key: "productName", header: "Product", sortValue: (it) => it.productName, csv: (it) => it.productName,
    render: (it) => (
      <>
        <p className="font-medium text-gray-900">{it.productName}</p>
        <code className="text-xs text-gray-400">{it.sku}</code>
      </>
    ),
  },
  {
    key: "type", header: "Type", sortValue: (it) => it.type,
    render: (it) => <Badge variant="outline" className={`text-xs ${TYPE_COLORS[it.type] ?? ""}`}>{it.type.replace(/_/g, " ")}</Badge>,
  },
  {
    key: "quantity", header: "Qty", align: "right", sortValue: (it) => it.quantity,
    render: (it) => <span className="font-mono text-gray-900">{fmt(it.quantity)} <span className="text-xs text-gray-400">{it.baseUom}</span></span>,
  },
  { key: "cost", header: "Cost", align: "right", sortValue: (it) => it.cost, render: (it) => <span className="font-mono font-medium text-red-600">RM {fmt(it.cost)}</span> },
  { key: "reason", header: "Reason", sortValue: (it) => it.reason, render: (it) => <span className="block max-w-[220px] truncate text-xs text-gray-500">{it.reason || "—"}</span> },
  { key: "adjustedBy", header: "Adjusted By", sortValue: (it) => it.adjustedBy, render: (it) => <span className="text-xs text-gray-600">{it.adjustedBy}</span> },
];
