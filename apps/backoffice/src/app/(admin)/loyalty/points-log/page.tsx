"use client";

import { useState, useEffect } from "react";
import { Coins, Search, Download, Loader2, ArrowUpCircle, ArrowDownCircle, Star, Clock, Wrench } from "lucide-react";
import { fetchPointsLog } from "@/lib/loyalty/api";
import type { PointTransactionWithDetails } from "@/lib/loyalty/api";
import { cn } from "@/lib/utils";
import { formatPoints } from "@/lib/loyalty/utils";
import { exportToCSV } from "@/lib/loyalty/export";

const typeConfig: Record<string, { label: string; color: string; icon: typeof Coins }> = {
  earn: {
    label: "Earn",
    color: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    icon: ArrowUpCircle,
  },
  redeem: {
    label: "Redeem",
    color: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    icon: ArrowDownCircle,
  },
  bonus: {
    label: "Bonus",
    color: "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    icon: Star,
  },
  expire: {
    label: "Expired",
    color: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500",
    icon: Clock,
  },
  adjust: {
    label: "Adjust",
    color: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    icon: Wrench,
  },
};

type TypeFilter = "all" | "earn" | "redeem" | "bonus" | "expire" | "adjust";

export default function PointsLogPage() {
  const [transactions, setTransactions] = useState<PointTransactionWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  useEffect(() => {
    loadTransactions();
  }, []);

  const loadTransactions = async () => {
    setLoading(true);
    const data = await fetchPointsLog();
    setTransactions(data);
    setLoading(false);
  };

  const filtered = transactions.filter((t) => {
    if (typeFilter !== "all" && t.type !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const memberName = t.members?.name?.toLowerCase() || "";
      const memberPhone = t.members?.phone?.toLowerCase() || "";
      const description = t.description?.toLowerCase() || "";
      const outletName = t.outlets?.name?.toLowerCase() || "";
      if (
        !memberName.includes(q) &&
        !memberPhone.includes(q) &&
        !description.includes(q) &&
        !outletName.includes(q)
      )
        return false;
    }
    return true;
  });

  const totalEarned = transactions
    .filter((t) => t.type === "earn" || t.type === "bonus")
    .reduce((sum, t) => sum + t.points, 0);
  const totalRedeemed = transactions
    .filter((t) => t.type === "redeem")
    .reduce((sum, t) => sum + Math.abs(t.points), 0);
  const totalBonuses = transactions
    .filter((t) => t.type === "bonus")
    .reduce((sum, t) => sum + t.points, 0);

  const exportColumns = [
    { key: "date", label: "Date" },
    { key: "customer_name", label: "Customer Name" },
    { key: "phone", label: "Phone" },
    { key: "type", label: "Type" },
    { key: "points", label: "Points" },
    { key: "balance_after", label: "Balance After" },
    { key: "description", label: "Description" },
    { key: "outlet", label: "Outlet" },
    { key: "multiplier", label: "Multiplier" },
    { key: "reference_id", label: "Reference" },
  ];

  const handleExport = () => {
    const rows = filtered.map((t) => ({
      date: new Date(t.created_at).toLocaleString("en-MY"),
      customer_name: t.members?.name || "-",
      phone: t.members?.phone || "-",
      type: t.type,
      points: t.points,
      balance_after: t.balance_after,
      description: t.description,
      outlet: t.outlets?.name || "-",
      multiplier: t.multiplier > 1 ? `${t.multiplier}x` : "-",
      reference_id: t.reference_id || "-",
    }));
    exportToCSV(rows, exportColumns, `points-log-${new Date().toISOString().slice(0, 10)}`);
  };

  return (
    <div className="p-3 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Points Log
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-neutral-500">
            Complete history of all points awarded, redeemed, and adjusted
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={filtered.length === 0}
          className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
          <p className="text-sm text-gray-500 dark:text-neutral-500">Total Transactions</p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
            {transactions.length.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
          <p className="text-sm text-green-600 dark:text-green-400">Points Earned</p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
            {formatPoints(totalEarned)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
          <p className="text-sm text-red-600 dark:text-red-400">Points Redeemed</p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
            {formatPoints(totalRedeemed)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
          <p className="text-sm text-purple-600 dark:text-purple-400">Bonus Points</p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
            {formatPoints(totalBonuses)}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-neutral-500" />
          <input
            type="text"
            placeholder="Search by name, phone, description, or outlet..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 pl-10 pr-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-[#C2452D]/40 focus:border-[#C2452D] transition-colors"
          />
        </div>

        {/* Type filter tabs */}
        <div className="flex gap-1 rounded-xl bg-gray-100 dark:bg-neutral-800 p-1 overflow-x-auto">
          {(["all", "earn", "redeem", "bonus", "adjust", "expire"] as TypeFilter[]).map(
            (t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap",
                  typeFilter === t
                    ? "bg-white dark:bg-neutral-700 text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-500 dark:text-neutral-400 hover:text-gray-700 dark:hover:text-neutral-200"
                )}
              >
                {t === "all" ? "All" : typeConfig[t]?.label || t}
              </button>
            )
          )}
        </div>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-[#C2452D]" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-neutral-500">
            <Coins className="h-10 w-10 mb-2" />
            <p className="text-sm font-medium">No transactions found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-neutral-800 bg-gray-50 dark:bg-neutral-800/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wider whitespace-nowrap">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wider whitespace-nowrap">
                    Customer
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wider whitespace-nowrap">
                    Type
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wider whitespace-nowrap">
                    Points
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wider whitespace-nowrap">
                    Balance
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wider whitespace-nowrap">
                    Description
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wider whitespace-nowrap">
                    Outlet
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-neutral-800">
                {filtered.map((t) => {
                  const config = typeConfig[t.type] || typeConfig.adjust;
                  const isPositive = t.points > 0;
                  return (
                    <tr
                      key={t.id}
                      className="hover:bg-gray-50 dark:hover:bg-neutral-800/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-gray-500 dark:text-neutral-400 text-xs whitespace-nowrap">
                        {new Date(t.created_at).toLocaleDateString("en-MY", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                        <br />
                        <span className="text-gray-400 dark:text-neutral-500">
                          {new Date(t.created_at).toLocaleTimeString("en-MY", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">
                            {t.members?.name || "-"}
                          </p>
                          <p className="text-xs text-gray-400 dark:text-neutral-500">
                            {t.members?.phone || "-"}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                            config.color
                          )}
                        >
                          {config.label}
                          {t.multiplier > 1 && (
                            <span className="text-[10px] opacity-75">
                              {t.multiplier}x
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={cn(
                            "font-bold font-mono text-sm",
                            isPositive
                              ? "text-green-600 dark:text-green-400"
                              : "text-red-500 dark:text-red-400"
                          )}
                        >
                          {isPositive ? "+" : ""}
                          {formatPoints(t.points)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-600 dark:text-neutral-300">
                        {formatPoints(t.balance_after)}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-neutral-300 max-w-[200px] truncate">
                        {t.description}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-neutral-400 text-xs whitespace-nowrap">
                        {t.outlets?.name || "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Count */}
      {!loading && filtered.length > 0 && (
        <p className="mt-3 text-xs text-gray-400 dark:text-neutral-500 text-right">
          Showing {filtered.length.toLocaleString()} transaction{filtered.length !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}
