"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  RefreshCw,
  Power,
  PauseCircle,
  AlertTriangle,
  Clock,
  Search,
} from "lucide-react";
import { adminFetch } from "@/lib/pickup/admin-fetch";

/**
 * Store / Menu Status — live operational board (see /api/pos/store-menu-status).
 * Benchmarked on Hubbo's report: which outlets are open/paused, are they
 * actually selling today (vs the same-weekday norm), and what's "86'd". The
 * headline alarm is an OPEN outlet with zero orders today.
 */

type StoreCard = {
  outletId: string;
  name: string;
  storeId: string | null;
  isOpen: boolean;
  manualPause: boolean;
  openTime: string | null;
  closeTime: string | null;
  openToday: boolean;
  todayOrders: number;
  avgWeekday: number;
  lastOrderAt: string | null;
  snoozed: number;
  menuTotal: number;
  alert: "open-no-orders" | "quiet" | "manual-pause" | "none";
};
type SnoozedItem = {
  storeId: string;
  outletName: string;
  category: string;
  item: string;
  reason: string | null;
  since: string;
};
type Data = {
  generatedAt: string;
  mytToday: string;
  menuTotal: number;
  stores: StoreCard[];
  snoozedItems: SnoozedItem[];
};

const relTime = (iso: string | null): string => {
  if (!iso) return "—";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};
const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kuala_Lumpur",
  });

function StatusBadge({ s }: { s: StoreCard }) {
  if (s.manualPause)
    return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800"><PauseCircle className="h-3.5 w-3.5" />Paused</span>;
  if (s.isOpen)
    return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800"><Power className="h-3.5 w-3.5" />Open</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-semibold text-gray-600"><Power className="h-3.5 w-3.5" />{s.openToday ? "Closed" : "Closed today"}</span>;
}

function AlertBanner({ alert }: { alert: StoreCard["alert"] }) {
  if (alert === "none") return null;
  const map = {
    "open-no-orders": { cls: "bg-red-50 text-red-700 border-red-200", txt: "Open · 0 orders today" },
    quiet: { cls: "bg-amber-50 text-amber-800 border-amber-200", txt: "Quiet · running below usual" },
    "manual-pause": { cls: "bg-amber-50 text-amber-800 border-amber-200", txt: "Manually paused — won't auto-reopen" },
  } as const;
  const m = map[alert];
  return (
    <div className={`mt-3 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${m.cls}`}>
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      {m.txt}
    </div>
  );
}

export default function StoreMenuStatusPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await adminFetch("/api/pos/store-menu-status");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredSnoozed = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.snoozedItems;
    return data.snoozedItems.filter(
      (i) =>
        i.item.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q) ||
        i.outletName.toLowerCase().includes(q),
    );
  }, [data, search]);

  const totalSnoozed = data?.snoozedItems.length ?? 0;

  return (
    <div className="p-3 sm:p-6 space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#160800]">Store / Menu Status</h1>
          <p className="text-sm text-gray-500">
            Live: who&rsquo;s open, who&rsquo;s selling, and what&rsquo;s 86&rsquo;d — across all outlets.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data && (
            <span className="text-xs text-gray-400">as of {clockTime(data.generatedAt)}</span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-[#160800] hover:bg-gray-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : data ? (
        <>
          {/* ── Store status ──────────────────────────────────────────── */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Store status</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.stores.map((s) => {
                const delta = s.todayOrders - s.avgWeekday;
                return (
                  <div key={s.outletId} className="rounded-2xl bg-white p-4 border border-gray-100 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-[#160800] leading-tight">{s.name}</h3>
                      <StatusBadge s={s} />
                    </div>

                    <div className="mt-4 flex items-end justify-between">
                      <div>
                        <p className="text-3xl font-bold text-[#160800] leading-none">{s.todayOrders}</p>
                        <p className="mt-1 text-xs text-gray-500">orders today</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-gray-600">
                          {s.avgWeekday > 0 ? (
                            <span className={delta >= 0 ? "text-emerald-600" : "text-amber-600"}>
                              {delta >= 0 ? "+" : ""}
                              {Math.round(delta)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </p>
                        <p className="text-xs text-gray-400">vs {s.avgWeekday} avg (this weekday)</p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-2 text-xs text-gray-500">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {s.openTime ?? "—"}&ndash;{s.closeTime ?? "—"}
                      </span>
                      <span>Last order {relTime(s.lastOrderAt)}</span>
                    </div>

                    <div className="mt-1.5 text-xs text-gray-500">
                      {s.snoozed > 0 ? (
                        <span className="font-medium text-amber-700">{s.snoozed} item{s.snoozed === 1 ? "" : "s"} snoozed</span>
                      ) : (
                        <span className="text-emerald-600">Full menu live</span>
                      )}
                    </div>

                    <AlertBanner alert={s.alert} />
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Menu status ───────────────────────────────────────────── */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                Menu status &mdash; snoozed items ({totalSnoozed})
              </h2>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search item, category, outlet"
                  className="w-64 rounded-lg border border-gray-300 bg-white pl-9 pr-3 py-1.5 text-sm text-[#160800] placeholder:text-gray-400"
                />
              </div>
            </div>

            {/* Per-outlet snooze/live bars */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.stores.map((s) => {
                const live = Math.max(0, s.menuTotal - s.snoozed);
                const pct = s.menuTotal > 0 ? (s.snoozed / s.menuTotal) * 100 : 0;
                return (
                  <div key={s.outletId} className="rounded-2xl bg-white p-4 border border-gray-100">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-[#160800]">{s.name}</span>
                      <span className="text-gray-500">
                        <span className="font-semibold text-amber-700">{s.snoozed}</span> / {s.menuTotal}
                      </span>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-emerald-100">
                      <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-1.5 text-xs text-gray-400">{live} live · {s.snoozed} snoozed</p>
                  </div>
                );
              })}
            </div>

            {/* Snoozed detail table */}
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-700">
                    <th className="px-4 py-3">Outlet</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Item</th>
                    <th className="px-4 py-3">Reason</th>
                    <th className="px-4 py-3 text-right">Snoozed since</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSnoozed.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500">
                        {totalSnoozed === 0 ? "Nothing snoozed — full menu live everywhere. 🎉" : "No matches."}
                      </td>
                    </tr>
                  ) : (
                    filteredSnoozed.map((i, idx) => (
                      <tr key={`${i.storeId}-${i.item}-${idx}`} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-[#160800]">{i.outletName}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{i.category}</td>
                        <td className="px-4 py-3 text-sm font-medium text-[#160800]">{i.item}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{i.reason || "—"}</td>
                        <td className="px-4 py-3 text-sm text-right text-gray-500" title={new Date(i.since).toLocaleString("en-MY")}>
                          {relTime(i.since)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-gray-400">
              Snoozed = an item turned off (&ldquo;86&rdquo;) at an outlet that is otherwise on the live menu. Snoozing on the
              register also hides the item on GrabFood within seconds.
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}
