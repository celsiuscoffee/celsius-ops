"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Search, RefreshCw, Download, X } from "lucide-react";
import { KeyNumber } from "@/components/ui/key-number";
import { DateRangePicker } from "@/components/date-range-picker";
import { summariseOrders } from "@/lib/orders-summary";
import type { OrderRow } from "@/lib/pickup/types";
import { adminFetch } from "@/lib/pickup/admin-fetch";
import { storeLabel } from "@/lib/pickup/store-label";

const STATUS_COLOUR: Record<string, string> = {
  pending:   "bg-sunken text-text-2",
  paid:      "bg-info-soft text-info-text",
  preparing: "bg-warn-soft text-warn-text",
  ready:     "bg-ok-soft text-ok-text",
  completed: "bg-sunken text-text-2",
  failed:    "bg-danger-soft text-danger-text",
};

const STORES = ["all", "shah-alam", "conezion", "tamarind"];
const STATUSES = ["all", "pending", "paid", "preparing", "ready", "completed", "failed"];
const CHANNELS = ["all", "pickup", "qr", "pos", "grab"];
const CHANNEL_LABEL: Record<string, string> = { all: "All channels", pickup: "Pickup", qr: "Table QR", pos: "In-store", grab: "Grab" };

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

export default function PickupOrders() {
  // Filters are mirrored into the URL query string so they survive navigating
  // into an order and back (the list unmounts on a Link navigation; without
  // this, Back would remount it with default filters). Also makes a filtered
  // view shareable/bookmarkable. Lazy initializers read the URL once on mount.
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [orders,      setOrders]      = useState<OrderRow[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState(() => searchParams.get("q") ?? "");
  const [store,       setStore]       = useState(() => searchParams.get("store") ?? "all");
  const [status,      setStatus]      = useState(() => searchParams.get("status") ?? "all");
  const [channel,     setChannel]     = useState(() => searchParams.get("channel") ?? "all");
  const [dateFrom,    setDateFrom]    = useState(() => searchParams.get("from") ?? "");
  const [dateTo,      setDateTo]      = useState(() => searchParams.get("to") ?? "");
  const [showExport,  setShowExport]  = useState(false);
  const [exportFrom,  setExportFrom]  = useState(todayString);
  const [exportTo,    setExportTo]    = useState(todayString);
  const [exportStore, setExportStore] = useState("all");
  const [exporting,   setExporting]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // Service-role-backed list endpoint — anon SELECT on orders was
    // revoked by security lockdown A3.
    const params = new URLSearchParams({ limit: "200" });
    if (store    !== "all") params.set("store",   store);
    if (status   !== "all") params.set("status",  status);
    params.set("channel", channel); // always explicit; endpoint defaults to pickup-only
    if (dateFrom)           params.set("from",    new Date(dateFrom).toISOString());
    if (dateTo)             params.set("to",      dateTo);
    try {
      const res  = await fetch(`/api/pickup/orders?${params.toString()}`, { cache: "no-store" });
      const data = res.ok ? await res.json() : [];
      setOrders((Array.isArray(data) ? data : []) as OrderRow[]);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [store, status, channel, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  // Mirror filters → URL (replace, no history spam, no scroll jump). Only
  // non-default values are written so an unfiltered view keeps a clean URL.
  // On Back-navigation the component remounts and the lazy initializers above
  // read these back, restoring the filtered view.
  useEffect(() => {
    const p = new URLSearchParams();
    if (search)            p.set("q",       search);
    if (store    !== "all") p.set("store",   store);
    if (status   !== "all") p.set("status",  status);
    if (channel  !== "all") p.set("channel", channel);
    if (dateFrom)          p.set("from",    dateFrom);
    if (dateTo)            p.set("to",      dateTo);
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [search, store, status, channel, dateFrom, dateTo, pathname, router]);

  // Polling refresh — was a Supabase Realtime channel on the orders
  // table; switched to a 15s poll since anon SELECT (and therefore the
  // realtime subscription) is no longer permitted on this table.
  useEffect(() => {
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
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

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { setNow(Date.now()); }, [orders]);
  const summary = summariseOrders(filtered, now);
  const rm = (sen: number) => `RM ${(sen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kuala_Lumpur" });
  const dateOf = (iso: string) => new Date(iso).toLocaleDateString("en-MY", { day: "numeric", month: "short", timeZone: "Asia/Kuala_Lumpur" });
  const ctl = "h-10 rounded-ctl border border-line bg-surface px-3 text-sm text-text focus:border-ink focus:outline-none";

  return (
    <div className="max-w-[1100px] space-y-5 px-4 pt-6 pb-10 md:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Orders</h1>
          <p className="mt-0.5 text-sm text-text-2">Every app, table QR and Grab order: what sold, what customers are waiting for, what failed.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} aria-label="Refresh" className="flex h-10 w-10 items-center justify-center rounded-ctl border border-line text-text-2 hover:text-text">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button onClick={() => setShowExport((v) => !v)} className="inline-flex h-10 items-center gap-1.5 rounded-ctl bg-ink px-4 text-sm font-semibold text-on-ink hover:bg-ink-hover">
            <Download className="h-4 w-4" strokeWidth={1.75} /> Export CSV
          </button>
        </div>
      </div>

      {showExport && (
        // Export: a full-width inline panel (several fields), not a modal.
        <div className="rounded-card border border-line bg-surface p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-text">Export orders</p>
            <button onClick={() => setShowExport(false)} aria-label="Close export" className="flex h-9 w-9 items-center justify-center rounded-ctl text-text-3 hover:bg-sunken hover:text-text"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-[13px] font-medium text-text-2">Dates</span>
              <DateRangePicker className="mt-1" start={exportFrom} end={exportTo} onChange={(a, b) => { setExportFrom(a); setExportTo(b); }} />
            </label>
            <label className="block">
              <span className="text-[13px] font-medium text-text-2">Outlet</span>
              <select value={exportStore} onChange={(e) => setExportStore(e.target.value)} className={`mt-1 block ${ctl}`}>
                {STORES.map((s) => <option key={s} value={s}>{s === "all" ? "All outlets" : storeLabel(s)}</option>)}
              </select>
            </label>
            <button onClick={handleExport} disabled={exporting || !exportFrom || !exportTo}
              className="inline-flex h-10 items-center gap-1.5 rounded-ctl bg-ink px-4 text-sm font-semibold text-on-ink hover:bg-ink-hover disabled:opacity-50">
              <Download className="h-4 w-4" strokeWidth={1.75} />{exporting ? "Downloading…" : "Download CSV"}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KeyNumber label="Sales" value={loading ? null : rm(summary.paid.sales)}
          note={<><b className="font-semibold text-text-2">{summary.paid.count}</b> orders{summary.paid.average != null ? <>, {rm(summary.paid.average)} each</> : null}</>} />
        <KeyNumber label="Being made" value={loading ? null : String(summary.inProgress.count)} tone={(summary.inProgress.oldestMinutes ?? 0) > 15 ? "warn" : undefined}
          note={summary.inProgress.count ? <>oldest <b className="font-semibold text-text-2">{summary.inProgress.oldestMinutes} min</b></> : "nobody waiting"} />
        <KeyNumber label="Ready to collect" value={loading ? null : String(summary.ready)}
          note={summary.ready ? "waiting at the counter" : "nothing on the counter"} />
        <KeyNumber label="Payment failed" value={loading ? null : String(summary.failed.count)} tone={summary.failed.count > 0 ? "warn" : undefined}
          note={<>of <b className="font-semibold text-text-2">{summary.failed.of}</b> orders shown</>} />
      </div>

      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
          <input type="text" placeholder="Search order number, customer name or phone…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-full rounded-ctl border border-line bg-surface pl-9 pr-3 text-sm text-text focus:border-ink focus:outline-none" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={store} onChange={(e) => setStore(e.target.value)} className={ctl} aria-label="Outlet">
            {STORES.map((s) => <option key={s} value={s}>{s === "all" ? "All outlets" : storeLabel(s)}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={ctl} aria-label="Status">
            {STATUSES.map((s) => <option key={s} value={s}>{s === "all" ? "All statuses" : s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
          <select value={channel} onChange={(e) => setChannel(e.target.value)} className={ctl} aria-label="Channel">
            {CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
          </select>
          <DateRangePicker start={dateFrom} end={dateTo} onChange={(a, b) => { setDateFrom(a); setDateTo(b); }} />
          {(store !== "all" || status !== "all" || channel !== "all" || dateFrom || dateTo) && (
            <button onClick={() => { setStore("all"); setStatus("all"); setChannel("all"); setDateFrom(""); setDateTo(""); }}
              className="h-10 px-2 text-sm font-medium text-brand-text hover:underline">Clear filters</button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-card border border-line bg-surface">
        {loading ? (
          <p className="py-12 text-center text-sm text-text-3">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-text-3">No orders match.</p>
        ) : filtered.map((order) => {
          const ch = order.channel ?? "pickup";
          return (
            <Link key={order.id} href={`/pickup/orders/${order.id}`} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 hover:bg-sunken/50">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text">
                  #{order.order_number}
                  <span className="font-normal text-text-2"> · {order.customer_name ?? "No name"}</span>
                  {order.order_type === "dine_in" && order.table_number && <span className="font-normal text-text-3"> · Table {order.table_number}</span>}
                </p>
                <p className="mt-0.5 truncate text-[12px] text-text-3">
                  {storeLabel(order.store_id)} · {CHANNEL_LABEL[ch] ?? ch} · {dateOf(order.created_at)}, {timeOf(order.created_at)}{order.customer_phone ? ` · ${order.customer_phone}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="font-mono text-sm font-semibold text-text">{rm(order.total)}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] capitalize ${STATUS_COLOUR[order.status] ?? "bg-sunken text-text-2"}`}>{order.status}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
