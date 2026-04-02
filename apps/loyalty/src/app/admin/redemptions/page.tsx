"use client";

import { useState, useEffect } from "react";
import { TicketCheck, Search, Download, Loader2 } from "lucide-react";
import { fetchAllRedemptions } from "@/lib/api";
import type { RedemptionWithDetails } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatPoints } from "@/lib/utils";
import { exportToCSV } from "@/lib/export";

const statusColors: Record<string, string> = {
  confirmed:
    "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  used: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  pending:
    "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  cancelled:
    "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500",
};

type StatusFilter = "all" | "pending" | "confirmed" | "cancelled";

export default function AdminRedemptionsPage() {
  const [redemptions, setRedemptions] = useState<RedemptionWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    loadRedemptions();
  }, []);

  const loadRedemptions = async () => {
    setLoading(true);
    const data = await fetchAllRedemptions();
    setRedemptions(data);
    setLoading(false);
  };

  const filtered = redemptions.filter((r) => {
    // Status filter
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    // Search filter
    if (search) {
      const q = search.toLowerCase();
      const memberName = r.members?.name?.toLowerCase() || "";
      const memberPhone = r.members?.phone?.toLowerCase() || "";
      const rewardName = r.rewards?.name?.toLowerCase() || "";
      const code = r.code.toLowerCase();
      if (
        !memberName.includes(q) &&
        !memberPhone.includes(q) &&
        !rewardName.includes(q) &&
        !code.includes(q)
      )
        return false;
    }
    return true;
  });

  const exportColumns = [
    { key: "code", label: "Code" },
    { key: "customer_name", label: "Customer Name" },
    { key: "phone", label: "Phone" },
    { key: "reward", label: "Reward" },
    { key: "points_spent", label: "Points Spent" },
    { key: "status", label: "Status" },
    { key: "created_at", label: "Created At" },
    { key: "confirmed_at", label: "Confirmed At" },
  ];

  const handleExport = () => {
    const rows = filtered.map((r) => ({
      code: r.code,
      customer_name: r.members?.name || "-",
      phone: r.members?.phone || "-",
      reward: r.rewards?.name || "-",
      points_spent: r.points_spent,
      status: r.status,
      created_at: new Date(r.created_at).toLocaleString("en-MY"),
      confirmed_at: r.confirmed_at
        ? new Date(r.confirmed_at).toLocaleString("en-MY")
        : "-",
    }));
    exportToCSV(rows, exportColumns, `redemptions-${new Date().toISOString().slice(0, 10)}`);
  };

  const pendingCount = redemptions.filter((r) => r.status === "pending").length;
  const confirmedCount = redemptions.filter(
    (r) => r.status === "confirmed" || r.status === "used"
  ).length;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Redemptions
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-neutral-500">
            View all reward redemptions and their verification codes
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
      <div className="mt-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
          <p className="text-sm text-gray-500 dark:text-neutral-500">Total</p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
            {redemptions.length}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
          <p className="text-sm text-yellow-600 dark:text-yellow-400">
            Pending
          </p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
            {pendingCount}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
          <p className="text-sm text-green-600 dark:text-green-400">
            Confirmed
          </p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
            {confirmedCount}
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
            placeholder="Search by code, customer, or reward..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 pl-10 pr-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-[#C2452D]/40 focus:border-[#C2452D] transition-colors"
          />
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-1 rounded-xl bg-gray-100 dark:bg-neutral-800 p-1">
          {(["all", "pending", "confirmed", "cancelled"] as StatusFilter[]).map(
            (s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  statusFilter === s
                    ? "bg-white dark:bg-neutral-700 text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-500 dark:text-neutral-400 hover:text-gray-700 dark:hover:text-neutral-200"
                )}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
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
            <TicketCheck className="h-10 w-10 mb-2" />
            <p className="text-sm font-medium">No redemptions found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-neutral-800 bg-gray-50 dark:bg-neutral-800/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wider whitespace-nowrap">
                    Code
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wider whitespace-nowrap">
                    Customer
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wider whitespace-nowrap">
                    Reward
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wider whitespace-nowrap">
                    Points
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wider whitespace-nowrap">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wider whitespace-nowrap">
                    Created
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wider whitespace-nowrap">
                    Confirmed
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-neutral-800">
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="hover:bg-gray-50 dark:hover:bg-neutral-800/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className="inline-block rounded bg-gray-100 dark:bg-neutral-700 px-2 py-0.5 text-xs font-bold font-mono tracking-wider text-gray-800 dark:text-neutral-200">
                        {r.code}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">
                          {r.members?.name || "-"}
                        </p>
                        <p className="text-xs text-gray-400 dark:text-neutral-500">
                          {r.members?.phone || "-"}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-neutral-300">
                      {r.rewards?.name || "-"}
                    </td>
                    <td className="px-4 py-3 font-medium font-mono text-gray-900 dark:text-white">
                      {formatPoints(r.points_spent)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                          statusColors[r.status] || statusColors.cancelled
                        )}
                      >
                        {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-neutral-400 text-xs whitespace-nowrap">
                      {new Date(r.created_at).toLocaleDateString("en-MY", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                      <br />
                      <span className="text-gray-400 dark:text-neutral-500">
                        {new Date(r.created_at).toLocaleTimeString("en-MY", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-neutral-400 text-xs whitespace-nowrap">
                      {r.confirmed_at
                        ? (
                            <>
                              {new Date(r.confirmed_at).toLocaleDateString(
                                "en-MY",
                                {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                }
                              )}
                              <br />
                              <span className="text-gray-400 dark:text-neutral-500">
                                {new Date(r.confirmed_at).toLocaleTimeString(
                                  "en-MY",
                                  {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  }
                                )}
                              </span>
                            </>
                          )
                        : (
                            <span className="text-gray-300 dark:text-neutral-600">
                              -
                            </span>
                          )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
