"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  ShoppingCart,
  DollarSign,
  Search,
  TrendingUp,
  Package,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

type Outlet = { id: string; name: string };
type Supplier = { id: string; name: string };

type ProductBreakdown = {
  productName: string;
  sku: string;
  qtyOrdered: number;
  qtyReceived: number;
  amount: number;
};

type SupplierRow = {
  supplierId: string;
  supplierName: string;
  totalOrders: number;
  totalAmount: number;
  totalReceived: number;
  totalInvoiced: number;
  productCount: number;
  topProducts: string[];
  productBreakdown: ProductBreakdown[];
};

type PurchaseSummaryData = {
  summary: {
    totalSpend: number;
    totalOrders: number;
    totalSuppliers: number;
    avgOrderValue: number;
  };
  outlets: Outlet[];
  suppliers: Supplier[];
  items: SupplierRow[];
};

function fmt(n: number) {
  return n.toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function defaultFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().split("T")[0];
}

function defaultTo() {
  return new Date().toISOString().split("T")[0];
}

export default function PurchaseSummaryPage() {
  const [outletId, setOutletId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const queryParts: string[] = [];
  if (outletId) queryParts.push(`outletId=${outletId}`);
  if (supplierId) queryParts.push(`supplierId=${supplierId}`);
  if (from) queryParts.push(`from=${from}`);
  if (to) queryParts.push(`to=${to}`);
  const qs = queryParts.length > 0 ? `?${queryParts.join("&")}` : "";

  const { data, isLoading } = useFetch<PurchaseSummaryData>(
    `/api/inventory/reports/purchase-summary${qs}`
  );

  const filtered = (data?.items ?? []).filter((item) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      item.supplierName.toLowerCase().includes(q) ||
      item.topProducts.some((p) => p.toLowerCase().includes(q))
    );
  });

  function toggleExpand(supplierId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(supplierId)) {
        next.delete(supplierId);
      } else {
        next.add(supplierId);
      }
      return next;
    });
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/inventory/reports"
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h2 className="text-xl font-semibold text-gray-900">
            Purchase Summary
          </h2>
          <p className="text-sm text-gray-500">
            Spending by supplier within selected period
          </p>
        </div>
      </div>

      {/* Summary cards */}
      {data && (
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-green-50 p-2">
                <DollarSign className="h-4 w-4 text-green-600" />
              </div>
              <span className="text-sm text-gray-500">Total Spend</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-gray-900">
              RM {fmt(data.summary.totalSpend)}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-blue-50 p-2">
                <ShoppingCart className="h-4 w-4 text-blue-600" />
              </div>
              <span className="text-sm text-gray-500">Total Orders</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-gray-900">
              {data.summary.totalOrders}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-purple-50 p-2">
                <Package className="h-4 w-4 text-purple-600" />
              </div>
              <span className="text-sm text-gray-500">Suppliers</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-gray-900">
              {data.summary.totalSuppliers}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-amber-50 p-2">
                <TrendingUp className="h-4 w-4 text-amber-600" />
              </div>
              <span className="text-sm text-gray-500">Avg Order Value</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-gray-900">
              RM {fmt(data.summary.avgOrderValue)}
            </p>
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
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
        >
          <option value="">All Suppliers</option>
          {(data?.suppliers ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
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
            placeholder="Search supplier or product..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
        </div>
      )}

      {/* Table */}
      {data && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="w-8 px-4 py-3" />
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Supplier
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">
                  Orders
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">
                  Total Amount (RM)
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">
                  Received (RM)
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">
                  Products
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Top Products
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-sm text-gray-400"
                  >
                    No purchase data found
                  </td>
                </tr>
              )}
              {filtered.map((item, idx) => (
                <>
                  <tr
                    key={item.supplierId}
                    className={`cursor-pointer border-b border-gray-50 transition-colors hover:bg-gray-50 ${
                      idx % 2 === 0 ? "" : "bg-gray-50/30"
                    }`}
                    onClick={() => toggleExpand(item.supplierId)}
                  >
                    <td className="px-4 py-2.5 text-gray-400">
                      {expanded.has(item.supplierId) ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-gray-900">
                      {item.supplierName}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-900">
                      {item.totalOrders}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-900">
                      {fmt(item.totalAmount)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-900">
                      {fmt(item.totalReceived)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-600">
                      {item.productCount}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {item.topProducts.map((p) => (
                          <Badge
                            key={p}
                            variant="outline"
                            className="text-xs"
                          >
                            {p}
                          </Badge>
                        ))}
                      </div>
                    </td>
                  </tr>

                  {/* Expanded product breakdown */}
                  {expanded.has(item.supplierId) && (
                    <tr key={`${item.supplierId}-details`}>
                      <td colSpan={7} className="bg-gray-50 px-4 py-3">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-500">
                              <th className="px-3 py-1.5 text-left font-medium">
                                Product
                              </th>
                              <th className="px-3 py-1.5 text-left font-medium">
                                SKU
                              </th>
                              <th className="px-3 py-1.5 text-right font-medium">
                                Qty Ordered
                              </th>
                              <th className="px-3 py-1.5 text-right font-medium">
                                Qty Received
                              </th>
                              <th className="px-3 py-1.5 text-right font-medium">
                                Amount (RM)
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {item.productBreakdown.map((p) => (
                              <tr
                                key={p.sku}
                                className="border-t border-gray-100"
                              >
                                <td className="px-3 py-1.5 text-gray-900">
                                  {p.productName}
                                </td>
                                <td className="px-3 py-1.5 font-mono text-gray-400">
                                  {p.sku}
                                </td>
                                <td className="px-3 py-1.5 text-right font-mono text-gray-900">
                                  {fmt(p.qtyOrdered)}
                                </td>
                                <td className="px-3 py-1.5 text-right font-mono text-gray-900">
                                  {fmt(p.qtyReceived)}
                                </td>
                                <td className="px-3 py-1.5 text-right font-mono text-gray-900">
                                  {fmt(p.amount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
