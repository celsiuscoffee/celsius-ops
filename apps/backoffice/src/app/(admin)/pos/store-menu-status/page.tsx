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
import { KeyNumber } from "@/components/ui/key-number";

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
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ${mins % 60} min ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
};
const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kuala_Lumpur",
  });

function StatusBadge({ s }: { s: StoreCard }) {
  if (s.manualPause)
    return <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2.5 py-0.5 text-[12px] text-warn-text"><PauseCircle className="h-3.5 w-3.5" />Paused</span>;
  if (s.isOpen)
    return <span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2.5 py-0.5 text-[12px] text-ok-text"><Power className="h-3.5 w-3.5" />Open</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-sunken px-2.5 py-0.5 text-[12px] text-text-2"><Power className="h-3.5 w-3.5" />{s.openToday ? "Closed" : "Closed today"}</span>;
}

function AlertBanner({ alert }: { alert: StoreCard["alert"] }) {
  if (alert === "none") return null;
  const map = {
    "open-no-orders": { cls: "bg-danger-soft text-danger-text", txt: "Open but no orders today" },
    quiet: { cls: "bg-warn-soft text-warn-text", txt: "Quieter than usual" },
    "manual-pause": { cls: "bg-warn-soft text-warn-text", txt: "Paused by hand; clears before opening tomorrow" },
  } as const;
  const m = map[alert];
  return (
    <div className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] ${m.cls}`}>
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

  const stores = data?.stores ?? [];
  const openNow = stores.filter((x) => x.isOpen && !x.manualPause).length;
  const silent = stores.filter((x) => x.alert === "open-no-orders").length;
  const todayOrders = stores.reduce((n, x) => n + x.todayOrders, 0);
  const usual = Math.round(stores.reduce((n, x) => n + x.avgWeekday, 0));
  const paused = stores.filter((x) => x.manualPause).length;

  return (
    <div className="max-w-[1100px] space-y-5 px-4 pt-6 pb-10 md:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Menu status</h1>
          <p className="mt-0.5 text-sm text-text-2">Right now: which outlets are open, whether they are selling, and what is switched off.</p>
        </div>
        <div className="flex items-center gap-3">
          {data && <span className="text-[12px] text-text-3">As of {clockTime(data.generatedAt)}</span>}
          <button onClick={load} disabled={loading} aria-label="Refresh"
            className="flex h-10 w-10 items-center justify-center rounded-ctl border border-line text-text-2 hover:text-text disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {err && <div className="rounded-card bg-danger-soft px-4 py-3 text-sm text-danger-text">{err}</div>}

      {loading && !data ? (
        <div className="flex items-center justify-center py-20 text-text-3"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KeyNumber label="Open now" value={`${openNow} of ${stores.length}`} word tone={silent > 0 ? "warn" : undefined}
              note={silent > 0 ? <><b className="font-semibold text-text-2">{silent}</b> open with no orders yet</> : "every open outlet is selling"} />
            <KeyNumber label="Orders today" value={String(todayOrders)}
              note={usual > 0 ? <>usual for this weekday: <b className="font-semibold text-text-2">{usual}</b></> : "no usual to compare yet"} />
            <KeyNumber label="Items switched off" value={String(totalSnoozed)} tone={totalSnoozed > 0 ? "warn" : undefined}
              note={totalSnoozed > 0 ? <>of <b className="font-semibold text-text-2">{data.menuTotal}</b> on the menu</> : "full menu live everywhere"} />
            <KeyNumber label="Paused by hand" value={String(paused)} tone={paused > 0 ? "warn" : undefined}
              note={paused > 0 ? "not taking app orders" : "no outlet paused"} />
          </div>

          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <p className="border-b border-line px-4 py-3 text-sm font-semibold text-text">Outlets</p>
            {stores.map((st) => {
              const delta = st.todayOrders - st.avgWeekday;
              return (
                <div key={st.outletId} className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">{st.name} <StatusBadge s={st} /></p>
                    <p className="mt-0.5 text-[12px] text-text-3">
                      <Clock className="mr-1 inline h-3 w-3" />{st.openTime ?? "–"} – {st.closeTime ?? "–"} · last order {relTime(st.lastOrderAt)} · {st.snoozed > 0 ? `${st.snoozed} of ${st.menuTotal} items off` : "full menu live"}
                    </p>
                    <AlertBanner alert={st.alert} />
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-lg font-semibold text-text">{st.todayOrders}</p>
                    <p className="text-[12px] text-text-3">
                      {st.avgWeekday > 0 ? <><span className={delta >= 0 ? "text-ok-text" : "text-warn-text"}>{delta >= 0 ? "+" : ""}{Math.round(delta)}</span> vs usual</> : "orders today"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <p className="text-sm font-semibold text-text">Switched off ({totalSnoozed})</p>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item, category, outlet"
                  className="h-10 w-full rounded-ctl border border-line bg-surface pl-9 pr-3 text-sm text-text placeholder:text-text-3 focus:border-ink focus:outline-none" />
              </div>
            </div>
            {filteredSnoozed.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-text-3">{totalSnoozed === 0 ? "Nothing switched off. The full menu is live everywhere." : "No matches."}</p>
            ) : filteredSnoozed.map((i, idx) => (
              <div key={`${i.storeId}-${i.item}-${idx}`} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text">{i.item}</p>
                  <p className="mt-0.5 truncate text-[12px] text-text-3">{i.outletName} · {i.category}{i.reason ? ` · ${i.reason}` : ""}</p>
                </div>
                <span className="shrink-0 text-[12px] text-text-2" title={new Date(i.since).toLocaleString("en-MY")}>{relTime(i.since)}</span>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-text-3">Switched off means an item turned off at one outlet while it stays on the menu elsewhere. Switching it off on the register also hides it on GrabFood within seconds.</p>
        </>
      ) : null}
    </div>
  );
}
