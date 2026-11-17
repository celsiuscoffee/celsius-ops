"use client";

import { useState, useEffect } from "react";
import { TicketCheck, Search, Download, Loader2 } from "lucide-react";
import { fetchAllRedemptions } from "@/lib/loyalty/api";
import type { RedemptionWithDetails } from "@/lib/loyalty/api";
import { cn } from "@/lib/utils";
import { formatPoints } from "@/lib/loyalty/utils";
import { exportToCSV } from "@/lib/loyalty/export";

const statusColors: Record<string, string> = {
  confirmed:
    "bg-ok-soft text-ok-text",
  used: "bg-ok-soft text-ok-text",
  pending:
    "bg-warn-soft text-warn-text",
  cancelled:
    "bg-sunken text-text-2",
};

type StatusFilter = "all" | "pending" | "confirmed" | "cancelled";

export default function AdminRedemptionsPage() {
  const [redemptions, setRedemptions] = useState<RedemptionWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const loadRedemptions = async () => {
    setLoading(true);
    const data = await fetchAllRedemptions();
    setRedemptions(data);
    setLoading(false);
  };

  useEffect(() => {
    loadRedemptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    <div className="px-4 pt-6 pb-10 md:px-8">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">
            Redemptions
          </h1>
          <p className="mt-1 text-sm text-text-2">
            Points spent in the points shop: what was redeemed, by whom, and whether it was handed over.
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={filtered.length === 0}
          className="flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-medium text-text-2 hover:bg-sunken transition-colors disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-sm text-text-2">Total</p>
          <p className="mt-1 text-2xl font-bold text-text">
            {redemptions.length}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-sm text-warn-text">
            Pending
          </p>
          <p className="mt-1 text-2xl font-bold text-text">
            {pendingCount}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-sm text-ok-text">
            Confirmed
          </p>
          <p className="mt-1 text-2xl font-bold text-text">
            {confirmedCount}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-3" />
          <input
            type="text"
            placeholder="Search by code, customer, or reward..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface pl-10 pr-4 py-2.5 text-sm text-text placeholder:text-text-3 focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-ink transition-colors"
          />
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-1 rounded-xl bg-sunken p-1">
          {(["all", "pending", "confirmed", "cancelled"] as StatusFilter[]).map(
            (s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  "min-h-9 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  statusFilter === s
                    ? "bg-surface text-text shadow-sm"
                    : "text-text-2 hover:text-text-2"
                )}
              >
                {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            )
          )}
        </div>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-hidden rounded-xl border border-line bg-surface">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-brand-text" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-3">
            <TicketCheck className="h-10 w-10 mb-2" />
            <p className="text-sm font-medium">No redemptions found</p>
          </div>
        ) : (
          <div>
            {filtered.map((r) => (
              <div key={r.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                <span className="hidden shrink-0 rounded bg-sunken px-2 py-0.5 font-mono text-xs font-bold tracking-wider text-text sm:inline-block">{r.code}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text">{r.rewards?.name || "Reward"} <span className="font-normal text-text-3">· {formatPoints(r.points_spent)} pts</span></p>
                  <p className="mt-0.5 truncate text-[12px] text-text-3">
                    <span className="font-mono sm:hidden">{r.code} · </span>{r.members?.name || "No name"} · {r.members?.phone || "-"} · {new Date(r.created_at).toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kuala_Lumpur" })}
                    {r.confirmed_at ? ` · confirmed ${new Date(r.confirmed_at).toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kuala_Lumpur" })}` : ""}
                  </p>
                </div>
                <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-medium", statusColors[r.status] || statusColors.cancelled)}>
                  {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
