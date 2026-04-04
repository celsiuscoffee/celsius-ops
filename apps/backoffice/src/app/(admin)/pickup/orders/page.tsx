"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Search, ChevronRight, RefreshCw, Download, X } from "lucide-react";
import { getSupabaseClient } from "@/lib/pickup/supabase";
import type { OrderRow } from "@/lib/pickup/types";
import { adminFetch } from "@/lib/pickup/admin-fetch";

const STATUS_COLOUR: Record<string, string> = {
  pending:   "bg-gray-100 text-gray-600",
  paid:      "bg-blue-100 text-blue-600",
  preparing: "bg-amber-100 text-amber-700",
  ready:     "bg-green-100 text-green-700",
  completed: "bg-gray-100 text-gray-500",
  failed:    "bg-red-100 text-red-600",
};

const STORES = ["all", "shah-alam", "conezion", "tamarind"];
const STATUSES = ["all", "pending", "paid", "preparing", "ready", "completed", "failed"];

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

export default function PickupOrders() {
  const [orders,      setOrders]      = useState<OrderRow[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState("");
  const [store,       setStore]       = useState("all");
  const [status,      setStatus]      = useState("all");
  const [dateFrom,    setDateFrom]    = useState("");
  const [dateTo,      setDateTo]      = useState("");
  const [showExport,  setShowExport]  = useState(false);
  const [exportFrom,  setExportFrom]  = useState(todayString);
  const [exportTo,    setExportTo]    = useState(todayString);
  const [exportStore, setExportStore] = useState("all");
  const [exporting,   setExporting]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    let query = supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (store  !== "all") query = query.eq("store_id", store);
    if (status !== "all") query = query.eq("status", status);
    if (dateFrom) query = query.gte("created_at", new Date(dateFrom).toISOString());
    if (dateTo)   query = query.lte("created_at", new Date(dateTo + "T23:59:59").toISOString());

    const { data } = await query;
    setOrders((data ?? []) as OrderRow[]);
    setLoading(false);
  }, [store, status, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  // Realtime — auto-refresh list on any order change
  useEffect(() => {
    const supabase = getSupabaseClient();
    const channel  = supabase
      .channel("orders-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        load();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  async function handleExport() {
    setExporting(true);
    const params = new URLSearchParams({ from: exportFrom, to: exportTo });
    if (exportStore !== "all") params.set("store", exportStore);
    const url = `/api/pickup/orders/export?${params.toString()}`;
    try {
      const res  = await adminFetch(url);
      const blob = await res.blob();
      const a    = document.createElement("a");
      a.href     = URL.createObjectURL(blob);
      a.download = `orders-${exportFrom}-${exportTo}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      setShowExport(false);
    } finally {
      setExporting(false);
    }
  }

  const filtered = orders.filter((o) =>
    !search ||
    o.order_number.toLowerCase().includes(search.toLowerCase()) ||
    (o.customer_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (o.customer_phone ?? "").includes(search)
  );

  const totalRevenue = filtered
    .filter((o) => !["pending", "failed"].includes(o.status))
    .reduce((s, o) => s + o.total, 0);

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#160800]">Pickup Orders</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filtered.length} orders · RM {(totalRevenue / 100).toFixed(2)} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowExport(true)}
            className="flex items-center gap-1.5 text-sm font-medium bg-[#160800] text-white px-3 py-1.5 rounded-xl hover:bg-[#160800]/90 transition-colors"
          >
            <Download className="h-4 w-4" strokeWidth={1.75} />
            Export CSV
          </button>
          <button
            onClick={load}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-[#160800] transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl p-4 space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search order number, customer name or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {/* Row 2: filters */}
        <div className="flex flex-wrap gap-2">
          {/* Store filter */}
          <select
            value={store}
            onChange={(e) => setStore(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            {STORES.map((s) => (
              <option key={s} value={s}>{s === "all" ? "All outlets" : s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>
            ))}
          </select>

          {/* Status filter */}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s === "all" ? "All statuses" : s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>

          {/* Date range */}
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <span className="self-center text-muted-foreground text-sm">-</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />

          {(store !== "all" || status !== "all" || dateFrom || dateTo) && (
            <button
              onClick={() => { setStore("all"); setStatus("all"); setDateFrom(""); setDateTo(""); }}
              className="text-sm text-primary font-medium"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">No orders found</div>
        ) : (
          <>
            {/* Header */}
            <div className="hidden md:grid grid-cols-[1fr_1.2fr_1fr_1fr_0.8fr_0.8fr_40px] gap-3 px-5 py-3 border-b bg-muted/30 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              <span>Order</span>
              <span>Customer</span>
              <span>Outlet</span>
              <span>Date / Time</span>
              <span>Total</span>
              <span>Status</span>
              <span />
            </div>

            <div className="divide-y">
              {filtered.map((order) => (
                <Link
                  key={order.id}
                  href={`/pickup/orders/${order.id}`}
                  className="flex flex-col md:grid md:grid-cols-[1fr_1.2fr_1fr_1fr_0.8fr_0.8fr_40px] gap-1 md:gap-3 items-start md:items-center px-5 py-3.5 hover:bg-muted/20 transition-colors"
                >
                  <span className="font-semibold text-sm">#{order.order_number}</span>
                  <span className="text-sm text-muted-foreground truncate">
                    {order.customer_name ?? "—"}{order.customer_phone ? ` · ${order.customer_phone}` : ""}
                  </span>
                  <span className="text-sm capitalize">{order.store_id.replace(/-/g, " ")}</span>
                  <span className="text-sm text-muted-foreground">
                    {new Date(order.created_at).toLocaleDateString("en-MY", { day: "numeric", month: "short" })}
                    {" "}
                    {new Date(order.created_at).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="text-sm font-semibold">RM {(order.total / 100).toFixed(2)}</span>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full w-fit ${STATUS_COLOUR[order.status]}`}>
                    {order.status}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground hidden md:block" />
                </Link>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Export CSV Modal */}
      {showExport && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-[#160800]">Export Orders</h2>
              <button onClick={() => setShowExport(false)} className="text-muted-foreground hover:text-[#160800]">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">From</label>
                <input
                  type="date"
                  value={exportFrom}
                  onChange={(e) => setExportFrom(e.target.value)}
                  className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">To</label>
                <input
                  type="date"
                  value={exportTo}
                  onChange={(e) => setExportTo(e.target.value)}
                  className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Outlet</label>
                <select
                  value={exportStore}
                  onChange={(e) => setExportStore(e.target.value)}
                  className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {STORES.map((s) => (
                    <option key={s} value={s}>
                      {s === "all" ? "All outlets" : s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              onClick={handleExport}
              disabled={exporting || !exportFrom || !exportTo}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#160800] text-white text-sm font-semibold rounded-xl hover:bg-[#160800]/90 transition-colors disabled:opacity-50"
            >
              <Download className="h-4 w-4" strokeWidth={1.75} />
              {exporting ? "Downloading..." : "Download CSV"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
