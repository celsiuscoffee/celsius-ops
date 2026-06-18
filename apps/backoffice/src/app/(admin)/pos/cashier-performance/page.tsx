"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Loader2, Target, Users, UserPlus, Repeat, AlertTriangle, Search, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { adminFetch } from "@/lib/pickup/admin-fetch";
import { toast } from "@celsius/ui";

/**
 * POS Cashier Performance — phone-collection effectiveness per cashier.
 * v1: collection rate (the ungameable loyalty-DB metric). new/repeat split +
 * upsell + per-staff HR view are Phase B (see docs/design/
 * cashier-performance-dashboard.md). Scope: cashier-rung (source=pos) orders.
 *
 * Filtering: outlet + period drive the server query (KPIs recompute for the
 * selection); search / quick-filter / column sort refine the table client-side.
 */

type Cashier = {
  id: string;
  name: string;
  orders: number;
  collected: number;
  collectedNew: number;
  collectedRepeat: number;
  rate: number;
  pairAdds: number;
  upsellOrders: number;
  upsellRate: number | null;
  maxSamePhone: number;
  suspicious: boolean;
};
type Data = {
  days: number;
  target: number;
  overall: { orders: number; collected: number; newMembers: number; repeatMembers: number; rate: number; pairAdds: number; upsellOrders: number; upsellRate: number | null };
  cashiers: Cashier[];
};
// `id` here is the POS outlet identifier (Outlet.loyaltyOutletId), which is what
// pos_orders.outlet_id / pos_pair_events.outlet_id store — NOT the Prisma Outlet
// CUID. Filtering by the CUID matches nothing, so we key the dropdown on this.
type Outlet = { id: string; name: string };

const DAYS_OPTIONS = [7, 30, 90];
type QuickFilter = "all" | "below" | "flagged";
type SortKey = "name" | "orders" | "collected" | "collectedNew" | "rate" | "pairAdds" | "upsellRate";

export default function CashierPerformancePage() {
  const [days, setDays] = useState(30);
  const [outletId, setOutletId] = useState("all");
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  // Client-side table refinements (don't hit the server / don't move the KPIs).
  const [search, setSearch] = useState("");
  const [quick, setQuick] = useState<QuickFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("rate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Outlet list for the filter dropdown (loaded once). We key options on
  // loyaltyOutletId — the POS outlet id stored on pos_orders/pos_pair_events —
  // and drop outlets without one (they have no counter-rung POS data to filter).
  useEffect(() => {
    adminFetch("/api/settings/outlets")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ id: string; name: string; loyaltyOutletId?: string | null }>) =>
        setOutlets(
          (rows ?? [])
            .filter((o) => o.loyaltyOutletId)
            .map((o) => ({ id: o.loyaltyOutletId as string, name: o.name }))
        ))
      .catch(() => setOutlets([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (outletId !== "all") params.set("outletId", outletId);
      const res = await adminFetch(`/api/pos/cashier-performance?${params.toString()}`);
      if (!res.ok) throw new Error("Load failed");
      setData((await res.json()) as Data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [days, outletId]);

  useEffect(() => {
    load();
  }, [load]);

  const overall = data?.overall;
  const allCashiers = useMemo(() => data?.cashiers ?? [], [data]);
  const target = data?.target ?? 70;

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      // Text sorts ascending by default; numeric sorts descending (rank order).
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  const cashiers = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = allCashiers.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q)) return false;
      if (quick === "below" && c.rate >= target) return false;
      if (quick === "flagged" && !c.suspicious) return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    rows = [...rows].sort((x, y) => {
      if (sortKey === "name") return x.name.localeCompare(y.name) * dir;
      const xv = (x[sortKey] ?? -1) as number;
      const yv = (y[sortKey] ?? -1) as number;
      return (xv - yv || y.orders - x.orders) * dir;
    });
    return rows;
  }, [allCashiers, search, quick, sortKey, sortDir, target]);

  const filtersActive = search.trim() !== "" || quick !== "all";

  return (
    <div className="p-3 sm:p-6 space-y-5 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#160800]">Cashier Performance</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Phone-number collection per cashier — the loyalty top-of-funnel. Counter-rung
            orders only (Grab / pickup / QR self-orders excluded). Target {target}%.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={outletId}
            onChange={(e) => setOutletId(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-[#160800]"
          >
            <option value="all">All outlets</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-[#160800]"
          >
            {DAYS_OPTIONS.map((d) => (
              <option key={d} value={d}>Last {d} days</option>
            ))}
          </select>
        </div>
      </div>

      {/* Headline KPIs — reflect the outlet + period selection (server totals). */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-2xl bg-white p-4 border border-gray-100">
          <div className="flex items-center gap-2 mb-1.5">
            <Target className="h-4 w-4 text-[#A2492C]" />
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Collection Rate</p>
          </div>
          <p className={`text-2xl font-bold ${rateColor(overall?.rate ?? 0, target)}`}>
            {overall ? `${overall.rate}%` : "—"}
          </p>
          <p className="mt-0.5 text-[11px] text-gray-500">
            {overall ? `${overall.collected.toLocaleString()} / ${overall.orders.toLocaleString()} orders · target ${target}%` : " "}
          </p>
        </div>
        <KpiCard Icon={UserPlus} label="New Members" value={overall ? overall.newMembers.toLocaleString() : "—"} sub="fresh enrolments" />
        <KpiCard Icon={Repeat} label="Returning" value={overall ? overall.repeatMembers.toLocaleString() : "—"} sub="existing members" />
        <KpiCard Icon={Users} label="Cashiers Tracked" value={String(allCashiers.length)} sub={`last ${days} days`} />
      </div>

      {/* Table toolbar: search + quick filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search cashier…"
            className="w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 py-1.5 text-sm text-[#160800] placeholder:text-gray-400"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1">
          {([
            { key: "all", label: "All" },
            { key: "below", label: "Below target" },
            { key: "flagged", label: "Flagged" },
          ] as { key: QuickFilter; label: string }[]).map((t) => (
            <button
              key={t.key}
              onClick={() => setQuick(t.key)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                quick === t.key ? "bg-white text-[#160800] shadow-sm" : "text-gray-500 hover:text-[#160800]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Per-cashier leaderboard */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-700">
              <th className="px-4 py-3 w-10">#</th>
              <SortableTh label="Cashier" col="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortableTh label="Orders" col="orders" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
              <SortableTh label="Collected" col="collected" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
              <SortableTh label="New" col="collectedNew" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
              <SortableTh label="Collection Rate" col="rate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" className="w-40" />
              <SortableTh label="Pair Adds" col="pairAdds" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" title="Pair-with-a-Bite suggestions added by this cashier (raw count)" />
              <SortableTh label="Upsell %" col="upsellRate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" title="Share of this cashier's orders that included an upsold pair — several pairs in one order count once (coaching-only)" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center"><Loader2 className="inline h-5 w-5 animate-spin text-gray-400" /></td></tr>
            ) : cashiers.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-500">
                {allCashiers.length === 0 ? "No counter-rung orders in this period yet." : "No cashiers match these filters."}
              </td></tr>
            ) : (
              cashiers.map((c, i) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-400">{i + 1}</td>
                  <td className="px-4 py-3 text-sm text-[#160800]">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#FBEBE8] text-xs font-bold text-[#A2492C]">
                        {c.name.charAt(0)}
                      </div>
                      <span className="font-medium">{c.name}</span>
                      {c.suspicious && (
                        <span title={`One number appears on ${c.maxSamePhone} of this cashier's orders — review for fake/own-number entry.`}>
                          <AlertTriangle className="h-4 w-4 text-amber-500" />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-gray-600">{c.orders.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium text-[#160800]">{c.collected.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium text-emerald-700" title="New members enrolled (fresh acquisitions)">{c.collectedNew.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-24 rounded-full bg-gray-200 overflow-hidden">
                        <div className={`h-1.5 rounded-full ${rateBar(c.rate, target)}`} style={{ width: `${Math.min(c.rate, 100)}%` }} />
                      </div>
                      <span className={`text-sm font-semibold w-10 text-right ${rateColor(c.rate, target)}`}>{c.rate}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-gray-600">{c.pairAdds.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium text-[#160800]" title={`${c.upsellOrders.toLocaleString()} of ${c.orders.toLocaleString()} orders had an upsold pair`}>{c.upsellRate == null ? "—" : `${c.upsellRate}%`}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {!loading && filtersActive && allCashiers.length > 0 && (
          <div className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-500">
            Showing {cashiers.length} of {allCashiers.length} cashiers
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Collection rate + new/repeat (New = enrolled at/around the order). Pair Adds = how many
        Pair-with-a-Bite suggestions the cashier added. Upsell % = share of the cashier&apos;s orders that
        ended up including an upsold pair (orders with an upsell ÷ total orders; several pairs in one
        order still count once) — order-based + success-based, so button-spam can&apos;t inflate it.
        Per-staff HR view is Phase B.
        <AlertTriangle className="inline h-3 w-3 text-amber-500" />
        flags a cashier where one number recurs across many tickets (possible fake/own-number entry).
      </p>
    </div>
  );
}

function SortableTh({
  label, col, sortKey, sortDir, onSort, align = "left", className = "", title,
}: {
  label: string; col: SortKey; sortKey: SortKey; sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void; align?: "left" | "right"; className?: string; title?: string;
}) {
  const active = sortKey === col;
  return (
    <th className={`px-4 py-3 ${align === "right" ? "text-right" : "text-left"} ${className}`} title={title}>
      <button
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 hover:text-[#160800] ${align === "right" ? "flex-row-reverse" : ""} ${active ? "text-[#160800]" : ""}`}
      >
        <span>{label}</span>
        {active ? (
          sortDir === "desc" ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 text-gray-300" />
        )}
      </button>
    </th>
  );
}

function rateColor(rate: number, target: number): string {
  if (rate >= target) return "text-emerald-600";
  if (rate >= target * 0.6) return "text-amber-600";
  return "text-red-600";
}
function rateBar(rate: number, target: number): string {
  if (rate >= target) return "bg-emerald-500";
  if (rate >= target * 0.6) return "bg-amber-500";
  return "bg-red-500";
}

function KpiCard({ Icon, label, value, sub }: { Icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 border border-gray-100">
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="h-4 w-4 text-[#A2492C]" />
        <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">{label}</p>
      </div>
      <p className="text-2xl font-bold text-[#160800]">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-gray-500">{sub}</p>}
    </div>
  );
}
