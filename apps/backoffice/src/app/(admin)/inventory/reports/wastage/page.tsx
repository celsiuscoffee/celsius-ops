"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { ArrowLeft, Loader2, Trash2, DollarSign, Search, AlertTriangle, Package } from "lucide-react";

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

const ALL_TYPES = ["WASTAGE", "EXPIRED", "BREAKAGE", "SPILLAGE", "THEFT", "USED_NOT_RECORDED"];

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
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [tab, setTab] = useState<"product" | "detail">("product");

  const params = new URLSearchParams();
  if (outletId) params.set("outletId", outletId);
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const url = `/api/inventory/reports/wastage?${params.toString()}`;
  const { data, isLoading } = useFetch<WastageData>(url);

  // Filter items
  const filteredItems = (data?.items ?? []).filter((item) => {
    if (typeFilter && item.type !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return item.productName.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q);
    }
    return true;
  });

  // Filter byProduct
  const filteredProducts = (data?.byProduct ?? []).filter((p) => {
    if (search) {
      const q = search.toLowerCase();
      return p.productName.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
    }
    return true;
  });

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
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Search product..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Type filter buttons */}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => setTypeFilter("")}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
            typeFilter === "" ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
          }`}
        >
          All
        </button>
        {ALL_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(typeFilter === t ? "" : t)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              typeFilter === t ? "border-gray-900 bg-gray-900 text-white" : `border-gray-200 bg-white text-gray-600 hover:bg-gray-50`
            }`}
          >
            {t.replace(/_/g, " ")}
          </button>
        ))}
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
        <div className="mt-4 rounded-xl border border-gray-200 bg-white overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left font-medium text-gray-500">Product</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Total Waste Qty</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Total Cost</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Adjustments</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">
                    No wastage records found
                  </td>
                </tr>
              )}
              {filteredProducts.map((p, idx) => (
                <tr key={p.sku} className={`border-b border-gray-50 ${idx % 2 === 0 ? "" : "bg-gray-50/30"}`}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-gray-900">{p.productName}</p>
                    <code className="text-xs text-gray-400">{p.sku}</code>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-900">{fmt(p.totalQty)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-red-600 font-medium">RM {fmt(p.totalCost)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-600">{p.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail table */}
      {data && tab === "detail" && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Outlet</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Product</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Type</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Qty</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Cost</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Reason</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Adjusted By</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">
                    No wastage records found
                  </td>
                </tr>
              )}
              {filteredItems.map((item, idx) => (
                <tr key={item.id} className={`border-b border-gray-50 ${idx % 2 === 0 ? "" : "bg-gray-50/30"}`}>
                  <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{formatDate(item.date)}</td>
                  <td className="px-4 py-2.5 text-gray-600">{item.outletName}</td>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-gray-900">{item.productName}</p>
                    <code className="text-xs text-gray-400">{item.sku}</code>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant="outline" className={`text-xs ${TYPE_COLORS[item.type] ?? ""}`}>
                      {item.type.replace(/_/g, " ")}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-900">
                    {fmt(item.quantity)} <span className="text-xs text-gray-400">{item.baseUom}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-red-600 font-medium">RM {fmt(item.cost)}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs max-w-[200px] truncate">{item.reason || "—"}</td>
                  <td className="px-4 py-2.5 text-gray-600 text-xs">{item.adjustedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
