"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { ReportTable, type ReportColumn } from "@/components/reports/report-table";
import {
  ArrowLeft,
  Loader2,
  ShoppingCart,
  DollarSign,
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
    <div className="p-3 sm:p-6">
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
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
        </div>
      )}

      {/* Table */}
      {data && (
        <ReportTable<SupplierRow>
          rows={data.items}
          rowKey={(it) => it.supplierId}
          csvFilename="purchase-summary"
          emptyMessage="No purchase data found."
          searchPlaceholder="Search supplier or product…"
          searchText={(it) => `${it.supplierName} ${it.topProducts.join(" ")} ${it.productBreakdown.map((p) => `${p.productName} ${p.sku}`).join(" ")}`}
          initialSort={{ key: "totalAmount", dir: "desc" }}
          minWidth={880}
          toggles={[
            { key: "underReceived", label: "Under-received", predicate: (it) => it.totalReceived < it.totalAmount - 0.01 },
            { key: "underInvoiced", label: "Not fully invoiced", predicate: (it) => it.totalInvoiced < it.totalAmount - 0.01 },
          ]}
          onRowClick={(it) => toggleExpand(it.supplierId)}
          columns={purchaseColumns(expanded)}
          subRow={(it) => expanded.has(it.supplierId) ? <ProductBreakdownTable rows={it.productBreakdown} /> : null}
        />
      )}
    </div>
  );
}

const purchaseColumns = (expanded: Set<string>): ReportColumn<SupplierRow>[] => [
  {
    key: "supplierName", header: "Supplier", sortValue: (it) => it.supplierName, csv: (it) => it.supplierName,
    render: (it) => (
      <span className="flex items-center gap-1.5 font-medium text-gray-900">
        {expanded.has(it.supplierId) ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
        {it.supplierName}
      </span>
    ),
  },
  { key: "totalOrders", header: "Orders", align: "right", sortValue: (it) => it.totalOrders, render: (it) => <span className="font-mono text-gray-900">{it.totalOrders}</span> },
  { key: "totalAmount", header: "Total Amount (RM)", align: "right", sortValue: (it) => it.totalAmount, render: (it) => <span className="font-mono text-gray-900">{fmt(it.totalAmount)}</span> },
  { key: "totalReceived", header: "Received (RM)", align: "right", sortValue: (it) => it.totalReceived, render: (it) => <span className="font-mono text-gray-900">{fmt(it.totalReceived)}</span> },
  { key: "totalInvoiced", header: "Invoiced (RM)", align: "right", sortValue: (it) => it.totalInvoiced, render: (it) => <span className="font-mono text-gray-900">{fmt(it.totalInvoiced)}</span> },
  { key: "productCount", header: "Products", align: "right", sortValue: (it) => it.productCount, render: (it) => <span className="font-mono text-gray-600">{it.productCount}</span> },
  {
    key: "topProducts", header: "Top Products", sortValue: (it) => it.topProducts[0] ?? null,
    csv: (it) => it.topProducts.join(" | "),
    render: (it) => (
      <div className="flex flex-wrap gap-1">
        {it.topProducts.map((p) => <Badge key={p} variant="outline" className="text-xs">{p}</Badge>)}
      </div>
    ),
  },
];

function ProductBreakdownTable({ rows }: { rows: ProductBreakdown[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-gray-500">
          <th className="px-3 py-1.5 text-left font-medium">Product</th>
          <th className="px-3 py-1.5 text-left font-medium">SKU</th>
          <th className="px-3 py-1.5 text-right font-medium">Qty Ordered</th>
          <th className="px-3 py-1.5 text-right font-medium">Qty Received</th>
          <th className="px-3 py-1.5 text-right font-medium">Amount (RM)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.sku} className="border-t border-gray-100">
            <td className="px-3 py-1.5 text-gray-900">{p.productName}</td>
            <td className="px-3 py-1.5 font-mono text-gray-400">{p.sku}</td>
            <td className="px-3 py-1.5 text-right font-mono text-gray-900">{fmt(p.qtyOrdered)}</td>
            <td className="px-3 py-1.5 text-right font-mono text-gray-900">{fmt(p.qtyReceived)}</td>
            <td className="px-3 py-1.5 text-right font-mono text-gray-900">{fmt(p.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
