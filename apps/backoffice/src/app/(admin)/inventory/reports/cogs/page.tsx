"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useFetch } from "@/lib/use-fetch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ReportTable, type ReportColumn } from "@/components/reports/report-table";
import {
  ArrowLeft,
  Loader2,
  DollarSign,
  TrendingUp,
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

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto space-y-6">
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
        <ReportTable<CogsItem>
          rows={data.items}
          rowKey={(it, i) => `${it.menuName}-${it.outletId}-${i}`}
          csvFilename="cogs"
          emptyMessage="No items found."
          searchPlaceholder="Search menu item, category or outlet…"
          searchText={(it) => `${it.menuName} ${it.category ?? ""} ${it.outletName}`}
          initialSort={{ key: "revenue", dir: "desc" }}
          minWidth={880}
          facets={[
            { key: "outlet", label: "Outlets", value: (it) => it.outletName },
            { key: "category", label: "Categories", value: (it) => it.category },
          ]}
          toggles={[
            { key: "thin", label: "Margin under 50%", predicate: (it) => it.marginPercent < 50 },
            { key: "loss", label: "Losing money", predicate: (it) => it.margin < 0 },
          ]}
          columns={cogsColumns}
        />
      )}
    </div>
  );
}

function getMarginBadge(marginPercent: number) {
  const tone =
    marginPercent >= 70 ? "bg-green-100 text-green-800 hover:bg-green-100"
    : marginPercent >= 50 ? "bg-yellow-100 text-yellow-800 hover:bg-yellow-100"
    : "bg-red-100 text-red-800 hover:bg-red-100";
  return <Badge className={tone}>{marginPercent.toFixed(1)}%</Badge>;
}

const cogsColumns: ReportColumn<CogsItem>[] = [
  {
    key: "menuName", header: "Menu Item", sortValue: (it) => it.menuName, csv: (it) => it.menuName,
    render: (it) => (
      <>
        <div className="font-medium">{it.menuName}</div>
        <div className="text-xs text-gray-400">{it.outletName}</div>
      </>
    ),
  },
  {
    key: "category", header: "Category", sortValue: (it) => it.category,
    render: (it) => it.category ? <Badge variant="outline">{it.category}</Badge> : <span className="text-gray-300">-</span>,
  },
  { key: "qtySold", header: "Qty Sold", align: "right", sortValue: (it) => it.qtySold, render: (it) => <span className="tabular-nums">{it.qtySold}</span> },
  { key: "revenue", header: "Revenue (RM)", align: "right", sortValue: (it) => it.revenue, render: (it) => <span className="tabular-nums">{formatCurrency(it.revenue)}</span> },
  { key: "expectedCogs", header: "COGS (RM)", align: "right", sortValue: (it) => it.expectedCogs, render: (it) => <span className="tabular-nums">{formatCurrency(it.expectedCogs)}</span> },
  { key: "margin", header: "Margin (RM)", align: "right", sortValue: (it) => it.margin, render: (it) => <span className="tabular-nums">{formatCurrency(it.margin)}</span> },
  { key: "marginPercent", header: "Margin %", align: "right", sortValue: (it) => it.marginPercent, render: (it) => getMarginBadge(it.marginPercent) },
];
