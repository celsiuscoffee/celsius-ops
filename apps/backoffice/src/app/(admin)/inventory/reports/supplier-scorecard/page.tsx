"use client";

import { useState, useMemo } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Truck,
  Star,
  Search,
  TrendingUp,
  TrendingDown,
  Clock,
  Package,
  DollarSign,
  AlertTriangle,
} from "lucide-react";

type SupplierScore = {
  id: string;
  name: string;
  score: number | null;
  totalOrders: number;
  completedOrders: number;
  onTimeRate: number | null;
  fulfillmentRate: number | null;
  shortDeliveries: number;
  priceChanges: number;
  avgPriceChange: number;
  totalSpend: number;
  leadTimeDays: number;
};

type ScorecardData = {
  summary: {
    totalSuppliers: number;
    avgScore: number | null;
    topPerformer: string | null;
    totalSpend: number;
  };
  suppliers: SupplierScore[];
};

type SortOption = "score" | "spend" | "name";

function fmt(n: number) {
  return n.toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function scoreBadge(score: number | null) {
  if (score === null)
    return (
      <Badge variant="outline" className="text-xs text-gray-400">
        N/A
      </Badge>
    );
  if (score >= 80)
    return (
      <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
        {score}
      </Badge>
    );
  if (score >= 60)
    return (
      <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">
        {score}
      </Badge>
    );
  return (
    <Badge className="bg-red-100 text-red-700 hover:bg-red-100">{score}</Badge>
  );
}

function rateBar(rate: number | null, color: string) {
  if (rate === null)
    return <span className="text-xs text-gray-300">No data</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 rounded-full bg-gray-100">
        <div
          className={`h-2 rounded-full ${color}`}
          style={{ width: `${Math.min(rate, 100)}%` }}
        />
      </div>
      <span className="text-xs font-medium text-gray-700">{fmt(rate)}%</span>
    </div>
  );
}

export default function SupplierScorecardPage() {
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const [from, setFrom] = useState(ninetyDaysAgo.toISOString().split("T")[0]);
  const [to, setTo] = useState(now.toISOString().split("T")[0]);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("score");

  const url = `/api/inventory/reports/supplier-scorecard?from=${from}T00:00:00.000Z&to=${to}T23:59:59.999Z`;

  const { data, isLoading } = useFetch<ScorecardData>(url);

  const filtered = useMemo(() => {
    let list = data?.suppliers ?? [];

    if (search) {
      const q = search.toLowerCase();
      list = list.filter((s) => s.name.toLowerCase().includes(q));
    }

    if (sortBy === "score") {
      list = [...list].sort((a, b) => {
        if (a.score === null && b.score === null) return 0;
        if (a.score === null) return 1;
        if (b.score === null) return -1;
        return b.score - a.score;
      });
    } else if (sortBy === "spend") {
      list = [...list].sort((a, b) => b.totalSpend - a.totalSpend);
    } else if (sortBy === "name") {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    }

    return list;
  }, [data, search, sortBy]);

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
            Supplier Scorecard
          </h2>
          <p className="text-sm text-gray-500">
            Delivery performance, fulfillment accuracy, and pricing stability
          </p>
        </div>
      </div>

      {/* Summary cards */}
      {data && (
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-blue-50 p-2">
                <Truck className="h-4 w-4 text-blue-600" />
              </div>
              <span className="text-sm text-gray-500">Suppliers Rated</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-gray-900">
              {data.summary.totalSuppliers}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-yellow-50 p-2">
                <Star className="h-4 w-4 text-yellow-600" />
              </div>
              <span className="text-sm text-gray-500">Avg Score</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-gray-900">
              {data.summary.avgScore !== null ? data.summary.avgScore : "--"}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-green-50 p-2">
                <TrendingUp className="h-4 w-4 text-green-600" />
              </div>
              <span className="text-sm text-gray-500">Top Performer</span>
            </div>
            <p className="mt-2 text-lg font-bold text-gray-900 truncate">
              {data.summary.topPerformer ?? "--"}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-purple-50 p-2">
                <DollarSign className="h-4 w-4 text-purple-600" />
              </div>
              <span className="text-sm text-gray-500">Total Spend</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-gray-900">
              RM {fmt(data.summary.totalSpend)}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Search supplier..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
        >
          <option value="score">Sort by Score</option>
          <option value="spend">Sort by Spend</option>
          <option value="name">Sort by Name</option>
        </select>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
        </div>
      )}

      {/* Supplier cards */}
      {data && (
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.length === 0 && (
            <div className="col-span-full rounded-xl border border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-400">
              No suppliers found
            </div>
          )}
          {filtered.map((s) => (
            <div
              key={s.id}
              className="rounded-xl border border-gray-200 bg-white p-5"
            >
              {/* Header row */}
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-base font-semibold text-gray-900">
                    {s.name}
                  </h3>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {s.totalOrders} orders &middot; {s.completedOrders}{" "}
                    completed
                  </p>
                </div>
                <div className="ml-3 flex flex-col items-end gap-1">
                  {scoreBadge(s.score)}
                  <Badge
                    variant="outline"
                    className="text-xs text-gray-500"
                  >
                    <Clock className="mr-1 h-3 w-3" />
                    {s.leadTimeDays}d lead
                  </Badge>
                </div>
              </div>

              {/* Metrics grid */}
              <div className="mt-4 grid grid-cols-2 gap-3">
                {/* On-Time Rate */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5 text-blue-500" />
                    <span className="text-xs font-medium text-gray-500">
                      On-Time Rate
                    </span>
                  </div>
                  {rateBar(
                    s.onTimeRate,
                    s.onTimeRate !== null && s.onTimeRate >= 80
                      ? "bg-green-500"
                      : s.onTimeRate !== null && s.onTimeRate >= 60
                        ? "bg-yellow-500"
                        : "bg-red-500"
                  )}
                </div>

                {/* Fulfillment Rate */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Truck className="h-3.5 w-3.5 text-indigo-500" />
                    <span className="text-xs font-medium text-gray-500">
                      Fulfillment
                    </span>
                  </div>
                  {rateBar(
                    s.fulfillmentRate,
                    s.fulfillmentRate !== null && s.fulfillmentRate >= 80
                      ? "bg-green-500"
                      : s.fulfillmentRate !== null && s.fulfillmentRate >= 60
                        ? "bg-yellow-500"
                        : "bg-red-500"
                  )}
                </div>

                {/* Price Changes */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    {s.avgPriceChange > 0 ? (
                      <TrendingUp className="h-3.5 w-3.5 text-red-500" />
                    ) : s.avgPriceChange < 0 ? (
                      <TrendingDown className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-gray-400" />
                    )}
                    <span className="text-xs font-medium text-gray-500">
                      Price Changes
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-gray-900">
                    {s.priceChanges}
                    {s.priceChanges > 0 && (
                      <span
                        className={`ml-1.5 text-xs font-normal ${s.avgPriceChange > 0 ? "text-red-500" : s.avgPriceChange < 0 ? "text-green-500" : "text-gray-400"}`}
                      >
                        {s.avgPriceChange > 0 ? "+" : ""}
                        {fmt(s.avgPriceChange)}%
                      </span>
                    )}
                  </p>
                </div>

                {/* Total Spend */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <DollarSign className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="text-xs font-medium text-gray-500">
                      Total Spend
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-gray-900">
                    RM {fmt(s.totalSpend)}
                  </p>
                </div>
              </div>

              {/* Short deliveries warning */}
              {s.shortDeliveries > 0 && (
                <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                  <span className="text-xs text-amber-700">
                    {s.shortDeliveries} short{" "}
                    {s.shortDeliveries === 1 ? "delivery" : "deliveries"}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
