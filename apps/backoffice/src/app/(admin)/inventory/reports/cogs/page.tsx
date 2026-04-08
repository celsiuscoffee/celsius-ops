"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useFetch } from "@/lib/use-fetch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  Loader2,
  DollarSign,
  TrendingUp,
  Search,
  ShoppingCart,
  Percent,
} from "lucide-react";

interface CogsItem {
  menuName: string;
  category: string | null;
  qtySold: number;
  revenue: number;
  expectedCogs: number;
  margin: number;
  marginPercent: number;
  outletId: string;
  outletName: string;
}

interface CogsData {
  summary: {
    totalRevenue: number;
    totalCogs: number;
    grossMargin: number;
    grossMarginPercent: number;
    menuItemCount: number;
  };
  outlets: Array<{ id: string; name: string }>;
  items: CogsItem[];
}

function formatCurrency(n: number) {
  return n.toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getDefaultDateRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString().split("T")[0],
    to: to.toISOString().split("T")[0],
  };
}

export default function CogsReportPage() {
  const defaults = getDefaultDateRange();
  const [outletId, setOutletId] = useState("");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (outletId) params.set("outletId", outletId);
    if (fromDate) params.set("from", new Date(fromDate).toISOString());
    if (toDate) params.set("to", new Date(toDate + "T23:59:59").toISOString());
    return `/api/inventory/reports/cogs?${params.toString()}`;
  }, [outletId, fromDate, toDate]);

  const { data, error, isLoading: loading } = useFetch<CogsData>(url);

  const filteredItems = useMemo(() => {
    if (!data?.items) return [];
    if (!search.trim()) return data.items;
    const q = search.toLowerCase();
    return data.items.filter(
      (item) =>
        item.menuName.toLowerCase().includes(q) ||
        (item.category && item.category.toLowerCase().includes(q))
    );
  }, [data?.items, search]);

  function getMarginBadge(marginPercent: number) {
    if (marginPercent >= 70) {
      return (
        <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
          {marginPercent.toFixed(1)}%
        </Badge>
      );
    }
    if (marginPercent >= 50) {
      return (
        <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
          {marginPercent.toFixed(1)}%
        </Badge>
      );
    }
    return (
      <Badge className="bg-red-100 text-red-800 hover:bg-red-100">
        {marginPercent.toFixed(1)}%
      </Badge>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/inventory/reports"
          className="p-2 hover:bg-gray-100 rounded-lg transition"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">COGS Report</h1>
          <p className="text-sm text-gray-500">
            Cost of Goods Sold analysis by menu item
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      {data?.summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border rounded-xl p-4 space-y-1">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <DollarSign className="w-4 h-4" />
              Total Revenue
            </div>
            <p className="text-2xl font-bold">
              RM {formatCurrency(data.summary.totalRevenue)}
            </p>
          </div>
          <div className="bg-white border rounded-xl p-4 space-y-1">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <ShoppingCart className="w-4 h-4" />
              Total COGS
            </div>
            <p className="text-2xl font-bold">
              RM {formatCurrency(data.summary.totalCogs)}
            </p>
          </div>
          <div className="bg-white border rounded-xl p-4 space-y-1">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <TrendingUp className="w-4 h-4" />
              Gross Margin (RM)
            </div>
            <p className="text-2xl font-bold">
              RM {formatCurrency(data.summary.grossMargin)}
            </p>
          </div>
          <div className="bg-white border rounded-xl p-4 space-y-1">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Percent className="w-4 h-4" />
              Gross Margin (%)
            </div>
            <p className="text-2xl font-bold">
              {data.summary.grossMarginPercent.toFixed(1)}%
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">
            Outlet
          </label>
          <select
            value={outletId}
            onChange={(e) => setOutletId(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm bg-white min-w-[180px]"
          >
            <option value="">All Outlets</option>
            {data?.outlets?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">
            From
          </label>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-[160px]"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">
            To
          </label>
          <Input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="w-[160px]"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs font-medium text-gray-500 mb-1 block">
            Search
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search menu item..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-500">Loading COGS data...</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          Failed to load COGS report. Please try again.
        </div>
      )}

      {/* Table */}
      {!loading && data && (
        <div className="bg-white border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left p-3 font-medium text-gray-600">
                    Menu Item
                  </th>
                  <th className="text-left p-3 font-medium text-gray-600">
                    Category
                  </th>
                  <th className="text-right p-3 font-medium text-gray-600">
                    Qty Sold
                  </th>
                  <th className="text-right p-3 font-medium text-gray-600">
                    Revenue (RM)
                  </th>
                  <th className="text-right p-3 font-medium text-gray-600">
                    COGS (RM)
                  </th>
                  <th className="text-right p-3 font-medium text-gray-600">
                    Margin (RM)
                  </th>
                  <th className="text-right p-3 font-medium text-gray-600">
                    Margin %
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="text-center py-10 text-gray-400"
                    >
                      No items found
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item, i) => (
                    <tr
                      key={`${item.menuName}-${item.outletId}-${i}`}
                      className="border-b last:border-b-0 hover:bg-gray-50 transition"
                    >
                      <td className="p-3">
                        <div className="font-medium">{item.menuName}</div>
                        <div className="text-xs text-gray-400">
                          {item.outletName}
                        </div>
                      </td>
                      <td className="p-3">
                        {item.category ? (
                          <Badge variant="outline">{item.category}</Badge>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {item.qtySold}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {formatCurrency(item.revenue)}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {formatCurrency(item.expectedCogs)}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {formatCurrency(item.margin)}
                      </td>
                      <td className="p-3 text-right">
                        {getMarginBadge(item.marginPercent)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {filteredItems.length > 0 && (
            <div className="border-t px-4 py-3 text-xs text-gray-500">
              Showing {filteredItems.length} of {data.items.length} items
            </div>
          )}
        </div>
      )}
    </div>
  );
}
