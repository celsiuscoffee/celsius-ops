"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { ArrowLeft, Loader2, TrendingDown, TrendingUp, Package, DollarSign, AlertTriangle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

type Outlet = { id: string; name: string };

type ValuationItem = {
  productId: string;
  name: string;
  sku: string;
  category: string;
  baseUom: string;
  outletId: string;
  outletName: string;
  systemQty: number;
  lastCountedQty: number | null;
  variance: number | null;
  costPerUnit: number;
  systemValue: number;
  countedValue: number | null;
  valueDiff: number | null;
};

type ValuationData = {
  summary: {
    totalProducts: number;
    totalSystemValue: number;
    totalCountedValue: number | null;
    valueDifference: number | null;
    itemsWithVariance: number;
    hasAnyCounts: boolean;
  };
  outlets: Outlet[];
  items: ValuationItem[];
};

function fmt(n: number) {
  return n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function StockValuationPage() {
  const [outletId, setOutletId] = useState("");
  const [search, setSearch] = useState("");
  const [showVarianceOnly, setShowVarianceOnly] = useState(false);

  const url = outletId
    ? `/api/inventory/reports/stock-valuation?outletId=${outletId}`
    : "/api/inventory/reports/stock-valuation";

  const { data, isLoading } = useFetch<ValuationData>(url);

  const filtered = (data?.items ?? []).filter((item) => {
    if (showVarianceOnly && (item.variance === null || item.variance === 0)) return false;
    if (search) {
      const q = search.toLowerCase();
      return item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="p-3 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/inventory/reports" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Stock Valuation</h2>
          <p className="text-sm text-gray-500">System qty vs last count, with RM values</p>
        </div>
      </div>

      {/* Summary cards */}
      {data && (
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-blue-50 p-2"><Package className="h-4 w-4 text-blue-600" /></div>
              <span className="text-sm text-gray-500">Products Tracked</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-gray-900">{data.summary.totalProducts}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-green-50 p-2"><DollarSign className="h-4 w-4 text-green-600" /></div>
              <span className="text-sm text-gray-500">System Value</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-gray-900">RM {fmt(data.summary.totalSystemValue)}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-purple-50 p-2"><DollarSign className="h-4 w-4 text-purple-600" /></div>
              <span className="text-sm text-gray-500">Counted Value</span>
            </div>
            {data.summary.hasAnyCounts ? (
              <p className="mt-2 text-2xl font-bold text-gray-900">RM {fmt(data.summary.totalCountedValue!)}</p>
            ) : (
              <p className="mt-2 text-lg font-medium text-gray-400">No counts yet</p>
            )}
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2">
              {data.summary.hasAnyCounts ? (
                <div className={`rounded-lg p-2 ${data.summary.valueDifference! < 0 ? "bg-red-50" : "bg-green-50"}`}>
                  {data.summary.valueDifference! < 0
                    ? <TrendingDown className="h-4 w-4 text-red-600" />
                    : <TrendingUp className="h-4 w-4 text-green-600" />}
                </div>
              ) : (
                <div className="rounded-lg bg-gray-50 p-2"><AlertTriangle className="h-4 w-4 text-gray-400" /></div>
              )}
              <span className="text-sm text-gray-500">Variance</span>
            </div>
            {data.summary.hasAnyCounts ? (
              <>
                <p className={`mt-2 text-2xl font-bold ${data.summary.valueDifference! < 0 ? "text-red-600" : "text-green-600"}`}>
                  {data.summary.valueDifference! < 0 ? "-" : "+"}RM {fmt(Math.abs(data.summary.valueDifference!))}
                </p>
                {data.summary.itemsWithVariance > 0 && (
                  <p className="mt-0.5 text-xs text-gray-500">{data.summary.itemsWithVariance} {data.summary.itemsWithVariance === 1 ? 'item' : 'items'} with variance</p>
                )}
              </>
            ) : (
              <p className="mt-2 text-lg font-medium text-gray-400">No counts yet</p>
            )}
          </div>
        </div>
      )}

      {/* No counts banner */}
      {data && !data.summary.hasAnyCounts && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
          <div>
            <p className="text-sm font-medium text-amber-800">No stock counts recorded</p>
            <p className="text-xs text-amber-600">Perform a stock count to see counted values and variance against system quantities.</p>
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
          {(data?.outlets ?? []).map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Search product..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showVarianceOnly}
            onChange={(e) => setShowVarianceOnly(e.target.checked)}
            className="h-4 w-4 rounded accent-terracotta"
          />
          Variance only
        </label>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
        </div>
      )}

      {/* Table */}
      {data && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left font-medium text-gray-500">Product</th>
                {!outletId && <th className="px-4 py-3 text-left font-medium text-gray-500">Outlet</th>}
                <th className="px-4 py-3 text-left font-medium text-gray-500">Category</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">System Qty</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Counted Qty</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Variance</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Cost/Unit</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">System Value</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Value Diff</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-400">
                    No items found
                  </td>
                </tr>
              )}
              {filtered.map((item, idx) => (
                <tr key={`${item.outletId}-${item.productId}`} className={`border-b border-gray-50 ${idx % 2 === 0 ? "" : "bg-gray-50/30"}`}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-gray-900">{item.name}</p>
                    <code className="text-xs text-gray-400">{item.sku}</code>
                  </td>
                  {!outletId && <td className="px-4 py-2.5 text-gray-600">{item.outletName}</td>}
                  <td className="px-4 py-2.5">
                    <Badge variant="outline" className="text-xs">{item.category}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-900">
                    {fmt(item.systemQty)} <span className="text-xs text-gray-400">{item.baseUom}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-900">
                    {item.lastCountedQty !== null ? (
                      <>{fmt(item.lastCountedQty)} <span className="text-xs text-gray-400">{item.baseUom}</span></>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {item.variance !== null ? (
                      <span className={item.variance < 0 ? "text-red-600" : item.variance > 0 ? "text-green-600" : "text-gray-400"}>
                        {item.variance > 0 ? "+" : ""}{fmt(item.variance)}
                        {item.variance !== 0 && (
                          <AlertTriangle className="ml-1 inline h-3 w-3" />
                        )}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-600">
                    {item.costPerUnit > 0 ? (
                      <>RM {fmt(item.costPerUnit)}<span className="text-xs text-gray-400">/{item.baseUom}</span></>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-900">
                    RM {fmt(item.systemValue)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {item.valueDiff !== null && item.valueDiff !== 0 ? (
                      <span className={item.valueDiff < 0 ? "text-red-600 font-medium" : "text-green-600 font-medium"}>
                        {item.valueDiff > 0 ? "+" : ""}RM {fmt(Math.abs(item.valueDiff))}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
