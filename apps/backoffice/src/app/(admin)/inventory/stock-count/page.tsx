"use client";

import { useState, useEffect, useMemo } from "react";
import { KeyNumber } from "@/components/ui/key-number";
import { countedInBase, summariseCounts, unresolvedIn } from "@/lib/inventory/count-summary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Loader2, Search,
  CheckCircle2, AlertTriangle, Save,
} from "lucide-react";

interface StockCountItem {
  id: string;
  product: string;
  sku: string;
  baseUom: string;
  package: string;
  packageConversion: number;
  expectedQty: number | null;
  countedQty: number | null;
  isConfirmed: boolean;
  varianceReason: string | null;
}

interface StockCount {
  id: string;
  outlet: string;
  outletCode: string;
  frequency: string;
  countedBy: string;
  countDate: string;
  status: string;
  notes: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  items: StockCountItem[];
}

const VARIANCE_REASONS = [
  "Wastage / Spillage",
  "Expired",
  "Breakage",
  "Unrecorded Usage",
  "Theft / Loss",
  "Receiving Error",
  "Transfer Not Recorded",
  "System Error",
  "Other",
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kuala_Lumpur" });
}

// A count was auto-approved when it went straight to REVIEWED at submit time —
// reviewedAt within a few seconds of submittedAt. A manual review happens
// minutes/hours later, so the gap reliably tells them apart without needing a
// dedicated DB column. Auto-approved counts can still carry discrepancies;
// those stay flagged until every one has a variance reason.
function isAutoApproved(sc: { status: string; submittedAt: string | null; reviewedAt: string | null }) {
  if (sc.status !== "REVIEWED" || !sc.submittedAt || !sc.reviewedAt) return false;
  return Math.abs(new Date(sc.reviewedAt).getTime() - new Date(sc.submittedAt).getTime()) < 3000;
}


export default function StockCountPage() {
  const [data, setData] = useState<StockCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "flagged" | "SUBMITTED" | "REVIEWED">("all");
  const [selected, setSelected] = useState<StockCount | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Review dialog defaults to discrepancies only; manager can expand to all items.
  const [showAllItems, setShowAllItems] = useState(false);

  // Editable variance reasons (per item id)
  const [editReasons, setEditReasons] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/inventory/stock-checks")
      .then((r) => { if (!r.ok) throw new Error("Failed to load stock counts"); return r.json(); })
      .then((d) => { setData(d); setError(null); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Opening a count loads its saved reasons into the editor.
  function openCount(sc: StockCount) {
    const reasons: Record<string, string> = {};
    sc.items.forEach((item) => { if (item.varianceReason) reasons[item.id] = item.varianceReason; });
    setEditReasons(reasons);
    setShowAllItems(false);
    setSelected(sc);
    window.scrollTo(0, 0);
  }

  const filtered = useMemo(() => {
    return data.filter((sc) => {
      if (statusFilter === "flagged") {
        if (unresolvedIn(sc) === 0) return false;
      } else if (statusFilter !== "all" && sc.status !== statusFilter) {
        return false;
      }
      if (search) {
        const q = search.toLowerCase();
        return sc.outlet.toLowerCase().includes(q) || sc.countedBy.toLowerCase().includes(q) || sc.frequency.toLowerCase().includes(q);
      }
      return true;
    });
  }, [data, search, statusFilter]);

  const [now] = useState(() => Date.now());
  const summary = useMemo(() => summariseCounts(data, now), [data, now]);

  const stats = useMemo(() => ({
    total: data.length,
    flagged: data.filter((s) => unresolvedIn(s) > 0).length,
    submitted: data.filter((s) => s.status === "SUBMITTED").length,
    reviewed: data.filter((s) => s.status === "REVIEWED").length,
  }), [data]);

  async function saveReasons(id: string) {
    setSaving(true);
    const items = Object.entries(editReasons).map(([itemId, reason]) => ({
      id: itemId,
      varianceReason: reason || null,
    }));
    await fetch(`/api/inventory/stock-checks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    // Update local data
    setData((prev) => prev.map((sc) => sc.id === id ? {
      ...sc,
      items: sc.items.map((item) => ({
        ...item,
        varianceReason: editReasons[item.id] ?? item.varianceReason,
      })),
    } : sc));
    setSelected((prev) => prev ? {
      ...prev,
      items: prev.items.map((item) => ({
        ...item,
        varianceReason: editReasons[item.id] ?? item.varianceReason,
      })),
    } : null);
    setSaving(false);
  }

  async function markReviewed(id: string) {
    setReviewing(true);
    // Save reasons + mark reviewed in one call
    const items = Object.entries(editReasons).map(([itemId, reason]) => ({
      id: itemId,
      varianceReason: reason || null,
    }));
    await fetch(`/api/inventory/stock-checks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "REVIEWED", items }),
    });
    setData((prev) => prev.map((sc) => sc.id === id ? {
      ...sc,
      status: "REVIEWED",
      reviewedAt: new Date().toISOString(),
      items: sc.items.map((item) => ({
        ...item,
        varianceReason: editReasons[item.id] ?? item.varianceReason,
      })),
    } : sc));
    setSelected((prev) => prev ? {
      ...prev,
      status: "REVIEWED",
      reviewedAt: new Date().toISOString(),
      items: prev.items.map((item) => ({
        ...item,
        varianceReason: editReasons[item.id] ?? item.varianceReason,
      })),
    } : null);
    setReviewing(false);
  }

  // Variance helpers
  function getVariance(item: StockCountItem) {
    if (item.countedQty == null || item.expectedQty == null) return null;
    // The two columns are stored in DIFFERENT units: expectedQty is
    // snapshotted from StockBalance (base UOM), countedQty is what staff keyed
    // (package units). Subtracting them directly compares grams against packs
    // — for Fresh Milk that would read 120 − 118,000. Convert the count to base
    // UOM first, the same way finalize does before writing balances.
    const cf = item.packageConversion && item.packageConversion > 0 ? item.packageConversion : 1;
    return item.countedQty * cf - item.expectedQty;
  }

  /**
   * Render a quantity held in BASE UOM (grams, ml, pcs) as packages.
   * `StockCountItem.expectedQty` is snapshotted from StockBalance, which is
   * base UOM everywhere, so it needs the divide.
   */
  function formatBaseQty(baseQty: number | null, conversion: number, baseUom: string, pkgLabel: string) {
    if (baseQty == null) return "—";
    if (conversion > 0 && conversion !== 1) {
      const pkgQty = Math.round((baseQty / conversion) * 100) / 100;
      return `${pkgQty} ${pkgLabel}`;
    }
    return `${baseQty.toLocaleString()} ${baseUom}`;
  }

  /**
   * Render a quantity that is ALREADY in package units — which is what staff
   * key in and what `StockCountItem.countedQty` stores ("22 packets"). The
   * finalize step is what multiplies by the conversion factor to reach base
   * UOM, so dividing here converts a second time: Tamarind's 7 Aug count read
   * "0.01 Pouch (700g)" for a counted 7 pouches, and 1 pack of Udang showed
   * as 0. The quantities were always right; only this column was wrong.
   */
  function formatPackageQty(pkgQty: number | null, baseUom: string, pkgLabel: string, conversion: number) {
    if (pkgQty == null) return "—";
    const rounded = Math.round(pkgQty * 100) / 100;
    return `${rounded.toLocaleString()} ${conversion > 0 && conversion !== 1 ? pkgLabel : baseUom}`;
  }


  // ── Review: a full page, not a modal (data-dense detail gets the room) ──
  if (selected) {
    const counted = selected.items.filter((i) => i.countedQty != null);
    const isOff = (i: StockCountItem) => { const v = getVariance(i); return v !== null && v !== 0; };
    const discrepancyItems = counted.filter(isOff);
    const checkedCount = counted.filter((i) => getVariance(i) !== null).length;
    const uncheckedCount = counted.length - checkedCount;
    // A count with no expectedQty was never compared. Observed 2026-08-12 at
    // Tamarind: 9 items, all expectedQty null, the old review said "None"
    // while the shelf was 32kg short on ICEHOT Foam. Silence about a missing
    // check has to look different from a clean check.
    const nothingChecked = checkedCount === 0 && counted.length > 0;
    const unresolvedCount = discrepancyItems.filter((i) => !(editReasons[i.id] || i.varianceReason)).length;
    // Exception-only: discrepancies first; the rest on request. When nothing
    // was checked there are no exceptions, so show everything counted.
    const rest = counted.filter((i) => !isOff(i));
    const visible = showAllItems || nothingChecked ? [...discrepancyItems, ...rest] : discrepancyItems;
    const editable = selected.status === "SUBMITTED" || selected.status === "REVIEWED";
    const banner = nothingChecked
      ? { cls: "bg-warn-soft text-warn-text", title: "Not checked", text: `No expected stock was recorded for any of these ${counted.length} items, so nothing was compared. The figures below are what was counted, not a checked result.` }
      : discrepancyItems.length === 0
        ? { cls: "bg-ok-soft text-ok-text", title: "Everything matched", text: `All ${checkedCount} checked items match the system.${uncheckedCount > 0 ? ` ${uncheckedCount} had no expected stock to compare.` : ""}` }
        : unresolvedCount > 0
          ? { cls: "bg-warn-soft text-warn-text", title: unresolvedCount === discrepancyItems.length ? `${unresolvedCount} ${unresolvedCount === 1 ? "gap needs" : "gaps need"} a reason` : `${unresolvedCount} of ${discrepancyItems.length} gaps still need a reason`, text: "Pick why the shelf differs from the system, then save." }
          : { cls: "bg-sunken text-text-2", title: `${discrepancyItems.length} ${discrepancyItems.length === 1 ? "gap" : "gaps"}, all explained`, text: uncheckedCount > 0 ? `${uncheckedCount} items had no expected stock to compare.` : "Nothing left to do on this count." };

    return (
      <div className="max-w-[960px] px-4 pt-6 pb-10 md:px-8">
        <button onClick={() => setSelected(null)} className="inline-flex items-center gap-1.5 text-sm text-text-2 hover:text-text">
          <ArrowLeft className="h-4 w-4" /> All stock counts
        </button>
        <h1 className="mt-3 text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">
          {selected.outlet} <span className="font-normal text-text-3">· {selected.frequency.toLowerCase()} count</span>
        </h1>
        <p className="mt-0.5 text-sm text-text-2">
          {formatDate(selected.countDate)} at {formatTime(selected.createdAt)} · counted by {selected.countedBy} · {counted.length} of {selected.items.length} items
        </p>

        <div className={`mt-5 flex gap-2.5 rounded-card px-4 py-3 ${banner.cls}`}>
          {nothingChecked || unresolvedCount > 0 ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
          <div>
            <p className="text-sm font-semibold">{banner.title}</p>
            <p className="text-[13px] opacity-90">{banner.text}</p>
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-card border border-line bg-surface">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <p className="text-sm font-semibold text-text">
              {showAllItems || nothingChecked ? `All ${counted.length} counted items` : `${discrepancyItems.length} ${discrepancyItems.length === 1 ? "gap" : "gaps"}`}
            </p>
            {rest.length > 0 && !nothingChecked && (
              <button onClick={() => setShowAllItems((v) => !v)} className="whitespace-nowrap text-[13px] font-medium text-brand-text hover:underline">
                {showAllItems ? "Show gaps only" : `Show all ${counted.length} items`}
              </button>
            )}
          </div>
          {visible.length === 0 && <p className="px-4 py-8 text-center text-sm text-text-3">No gaps on this count.</p>}
          {visible.map((item) => {
            const variance = getVariance(item);
            const off = variance !== null && variance !== 0;
            const cf = item.packageConversion || 1;
            const uom = item.package || item.baseUom;
            return (
              <div key={item.id} className="border-b border-line px-4 py-3 last:border-b-0">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text">{item.product}</p>
                    <p className="mt-0.5 text-[12px] text-text-3">
                      System <span className="font-mono text-text-2">{formatBaseQty(item.expectedQty, cf, item.baseUom, uom)}</span>
                      {" · "}Counted <span className="font-mono text-text-2">{formatPackageQty(item.countedQty, item.baseUom, uom, cf)}</span>
                    </p>
                  </div>
                  <p className={`shrink-0 font-mono text-sm font-semibold ${variance === null ? "text-text-3" : !off ? "text-ok-text" : variance < 0 ? "text-danger-text" : "text-warn-text"}`}>
                    {variance === null ? "Not checked" : !off ? "Matched" : `${variance > 0 ? "+" : ""}${formatBaseQty(variance, cf, item.baseUom, uom)}`}
                  </p>
                </div>
                {off && (
                  // Reasons stay editable after auto-approval: approval applies
                  // the balances; the reason is the manager's follow-up.
                  editable ? (
                    <select
                      aria-label={`Reason for ${item.product}`}
                      className="mt-2 h-10 w-full rounded-ctl border border-line bg-surface px-3 text-sm text-text sm:w-72"
                      value={editReasons[item.id] || item.varianceReason || ""}
                      onChange={(e) => setEditReasons((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    >
                      <option value="">Pick a reason…</option>
                      {VARIANCE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : (
                    <p className="mt-1 text-[13px] text-text-2">Reason: {item.varianceReason || "none given"}</p>
                  )
                )}
              </div>
            );
          })}
        </div>

        {editable && discrepancyItems.length > 0 && (
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => saveReasons(selected.id)} disabled={saving}>
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
              Save reasons
            </Button>
            {selected.status === "SUBMITTED" && (
              <Button onClick={() => markReviewed(selected.id)} disabled={reviewing || unresolvedCount > 0} className="bg-ink text-on-ink hover:bg-ink-hover">
                {reviewing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                Approve and close
              </Button>
            )}
          </div>
        )}
        {selected.status === "SUBMITTED" && discrepancyItems.length === 0 && (
          <div className="mt-4 flex justify-end">
            <Button onClick={() => markReviewed(selected.id)} disabled={reviewing} className="bg-ink text-on-ink hover:bg-ink-hover">
              {reviewing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
              Approve and close
            </Button>
          </div>
        )}
        {selected.status === "REVIEWED" && selected.reviewedAt && (
          <p className="mt-4 text-right text-[12px] text-text-3">
            {isAutoApproved(selected) ? "Auto-approved" : "Reviewed"} on {formatDate(selected.reviewedAt)} at {formatTime(selected.reviewedAt)}
          </p>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-text-3" />
      </div>
    );
  }

  return (
    <div className="px-4 pt-6 pb-10 md:px-8">
      <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Counts</h1>
      <p className="mt-0.5 text-sm text-text-2">Whether outlets count, whether the shelf matches the system, and every gap explained.</p>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KeyNumber label="Counts, last 7 days" value={String(summary.week.counts)}
          note={<><b className="font-semibold text-text-2">{summary.week.outlets}</b> {summary.week.outlets === 1 ? "outlet" : "outlets"} counted</>} />
        <KeyNumber label="Waiting for a reason" value={String(summary.waiting.counts)} tone={summary.waiting.counts > 0 ? "warn" : undefined}
          note={summary.waiting.counts > 0 ? <><b className="font-semibold text-text-2">{summary.waiting.items}</b> {summary.waiting.items === 1 ? "gap has" : "gaps have"} no reason yet</> : "every gap has a reason"} />
        <KeyNumber label="Matched the system, 30 days" value={summary.accuracy.share == null ? "–" : `${Math.round(summary.accuracy.share * 100)}%`}
          tone={summary.accuracy.share != null && summary.accuracy.share < 0.9 ? "warn" : undefined}
          note={<><b className="font-semibold text-text-2">{summary.accuracy.matched}</b> of {summary.accuracy.compared} items</>} />
        <KeyNumber label="Not checked, 30 days" value={String(summary.unchecked.items)} tone={summary.unchecked.items > 0 ? "warn" : undefined}
          note={summary.unchecked.items > 0 ? "counted, but no expected stock to compare" : "every counted item was compared"} />
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:max-w-sm sm:flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
          <Input placeholder="Search outlet or staff..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["all", "flagged", "SUBMITTED", "REVIEWED"] as const).map((t) => (
            <button key={t} onClick={() => setStatusFilter(t)} className={`rounded-full border px-3 py-1 text-xs capitalize transition-colors ${statusFilter === t ? "border-text bg-raised font-semibold text-text" : "border-line text-text-2"}`}>
              {t === "all" ? `All (${stats.total})`
                : t === "flagged" ? `Flagged (${stats.flagged})`
                : t === "SUBMITTED" ? `Pending (${stats.submitted})`
                : `Reviewed (${stats.reviewed})`}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-card bg-danger-soft px-4 py-3 text-sm text-danger-text">{error}</div>
      )}

      {/* One list: newest first, gaps waiting for a reason signalled */}
      <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface">
        {filtered.length === 0 && <p className="px-4 py-12 text-center text-sm text-text-3">No stock counts found</p>}
        {filtered.map((sc) => {
          const comparable = sc.items.filter((i) => i.countedQty != null && i.expectedQty != null);
          const countedItems = sc.items.filter((i) => i.countedQty != null).length;
          const discrepancies = comparable.filter((i) => countedInBase(i) !== i.expectedQty).length;
          const unresolved = unresolvedIn(sc);
          // Counted but never compared — distinct from "compared and clean".
          const uncheckedItems = countedItems - comparable.length;
          const signal = unresolved > 0
            ? { text: `${unresolved} need a reason`, cls: "bg-warn-soft text-warn-text" }
            : comparable.length === 0 && countedItems > 0
              ? { text: "Not checked", cls: "bg-warn-soft text-warn-text" }
              : discrepancies > 0
                ? { text: `${discrepancies} explained`, cls: "bg-sunken text-text-2" }
                : uncheckedItems > 0
                  ? { text: `${uncheckedItems} unchecked`, cls: "bg-warn-soft text-warn-text" }
                  : { text: "All matched", cls: "bg-ok-soft text-ok-text" };
          return (
            <button key={sc.id} onClick={() => openCount(sc)}
              className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-sunken/50">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text">
                  {sc.outlet} <span className="font-normal text-text-3">· {sc.frequency.toLowerCase()}</span>
                </p>
                <p className="mt-0.5 truncate text-[12px] text-text-3">
                  {formatDate(sc.countDate)} · {formatTime(sc.createdAt)} · by {sc.countedBy} · {countedItems} of {sc.items.length} items
                  {sc.status === "SUBMITTED" ? " · waiting for review" : isAutoApproved(sc) ? " · auto-approved" : ""}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] ${signal.cls}`}>{signal.text}</span>
            </button>
          );
        })}
      </div>

    </div>
  );
}
