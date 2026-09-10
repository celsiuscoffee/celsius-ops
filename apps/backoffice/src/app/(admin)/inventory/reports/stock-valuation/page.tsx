"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { ArrowLeft, Loader2, TrendingDown, TrendingUp, Package, DollarSign, AlertTriangle } from "lucide-react";
import { ReportTable, type ReportColumn } from "@/components/reports/report-table";

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

  const url = outletId
    ? `/api/inventory/reports/stock-valuation?outletId=${outletId}`
    : "/api/inventory/reports/stock-valuation";

  const { data, isLoading } = useFetch<ValuationData>(url);


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
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
        </div>
      )}

      {/* Table */}
      {data && (
        <ReportTable<ValuationItem>
          rows={data.items}
          rowKey={(it) => `${it.outletId}-${it.productId}`}
          csvFilename="stock-valuation"
          emptyMessage="No items found."
          searchPlaceholder="Search product, SKU or category…"
          searchText={(it) => `${it.name} ${it.sku} ${it.category} ${it.outletName}`}
          initialSort={{ key: "systemValue", dir: "desc" }}
          minWidth={860}
          facets={[
            { key: "outlet", label: "Outlets", value: (it) => it.outletName },
            { key: "category", label: "Categories", value: (it) => it.category },
          ]}
          toggles={[
            { key: "variance", label: "Variance only", predicate: (it) => it.variance !== null && it.variance !== 0 },
            { key: "uncounted", label: "Never counted", predicate: (it) => it.lastCountedQty === null },
          ]}
          columns={valuationColumns}
        />
      )}
    </div>
  );
}

const valuationColumns: ReportColumn<ValuationItem>[] = [
  {
    key: "name", header: "Product", sortValue: (it) => it.name, csv: (it) => it.name,
    render: (it) => (
      <>
        <p className="font-medium text-gray-900">{it.name}</p>
        <code className="text-xs text-gray-400">{it.sku}</code>
      </>
    ),
  },
  { key: "outletName", header: "Outlet", sortValue: (it) => it.outletName, render: (it) => <span className="text-gray-600">{it.outletName}</span> },
  {
    key: "category", header: "Category", sortValue: (it) => it.category,
    render: (it) => <Badge variant="outline" className="text-xs">{it.category}</Badge>,
  },
  {
    key: "systemQty", header: "System Qty", align: "right", sortValue: (it) => it.systemQty,
    render: (it) => <span className="font-mono text-gray-900">{fmt(it.systemQty)} <span className="text-xs text-gray-400">{it.baseUom}</span></span>,
  },
  {
    key: "lastCountedQty", header: "Counted Qty", align: "right", sortValue: (it) => it.lastCountedQty,
    render: (it) => it.lastCountedQty !== null
      ? <span className="font-mono text-gray-900">{fmt(it.lastCountedQty)} <span className="text-xs text-gray-400">{it.baseUom}</span></span>
      : <span className="text-gray-300">—</span>,
  },
  {
    key: "variance", header: "Variance", align: "right", sortValue: (it) => it.variance,
    render: (it) => it.variance !== null ? (
      <span className={`font-mono ${it.variance < 0 ? "text-red-600" : it.variance > 0 ? "text-green-600" : "text-gray-400"}`}>
        {it.variance > 0 ? "+" : ""}{fmt(it.variance)}
        {it.variance !== 0 && <AlertTriangle className="ml-1 inline h-3 w-3" />}
      </span>
    ) : <span className="text-gray-300">—</span>,
  },
  {
    key: "costPerUnit", header: "Cost/Unit", align: "right", sortValue: (it) => (it.costPerUnit > 0 ? it.costPerUnit : null),
    render: (it) => it.costPerUnit > 0
      ? <span className="font-mono text-gray-600">RM {fmt(it.costPerUnit)}<span className="text-xs text-gray-400">/{it.baseUom}</span></span>
      : <span className="text-gray-300">—</span>,
  },
  {
    key: "systemValue", header: "System Value", align: "right", sortValue: (it) => it.systemValue,
    render: (it) => <span className="font-mono text-gray-900">RM {fmt(it.systemValue)}</span>,
  },
  {
    key: "valueDiff", header: "Value Diff", align: "right", sortValue: (it) => it.valueDiff,
    render: (it) => it.valueDiff !== null && it.valueDiff !== 0 ? (
      <span className={`font-mono font-medium ${it.valueDiff < 0 ? "text-red-600" : "text-green-600"}`}>
        {it.valueDiff > 0 ? "+" : ""}RM {fmt(Math.abs(it.valueDiff))}
      </span>
    ) : <span className="text-gray-300">—</span>,
  },
];
