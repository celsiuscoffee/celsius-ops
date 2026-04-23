"use client";

import { useState, useEffect, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ClipboardCheck, Loader2, Search,
  CheckCircle2, Clock, AlertTriangle, Eye, Save,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

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

const STATUS_STYLES: Record<string, string> = {
  SUBMITTED: "bg-yellow-50 text-yellow-700 border-yellow-200",
  REVIEWED: "bg-green-50 text-green-700 border-green-200",
  DRAFT: "bg-gray-50 text-gray-500 border-gray-200",
};

const STATUS_ICON: Record<string, typeof Clock> = {
  SUBMITTED: Clock,
  REVIEWED: CheckCircle2,
  DRAFT: AlertTriangle,
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" });
}

export default function StockCountPage() {
  const [data, setData] = useState<StockCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "SUBMITTED" | "REVIEWED">("all");
  const [selected, setSelected] = useState<StockCount | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editable variance reasons (per item id)
  const [editReasons, setEditReasons] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/inventory/stock-checks")
      .then((r) => { if (!r.ok) throw new Error("Failed to load stock counts"); return r.json(); })
      .then((d) => { setData(d); setError(null); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // When dialog opens, populate edit reasons from existing data
  useEffect(() => {
    if (selected) {
      const reasons: Record<string, string> = {};
      selected.items.forEach((item) => {
        if (item.varianceReason) reasons[item.id] = item.varianceReason;
      });
      setEditReasons(reasons);
    }
  }, [selected]);

  const filtered = useMemo(() => {
    return data.filter((sc) => {
      if (statusFilter !== "all" && sc.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return sc.outlet.toLowerCase().includes(q) || sc.countedBy.toLowerCase().includes(q) || sc.frequency.toLowerCase().includes(q);
      }
      return true;
    });
  }, [data, search, statusFilter]);

  const stats = useMemo(() => ({
    total: data.length,
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
    return item.countedQty - item.expectedQty;
  }

  function formatQty(baseQty: number | null, conversion: number, baseUom: string, pkgLabel: string) {
    if (baseQty == null) return "—";
    if (conversion > 0 && conversion !== 1) {
      const pkgQty = Math.round((baseQty / conversion) * 100) / 100;
      return `${pkgQty} ${pkgLabel}`;
    }
    return `${baseQty.toLocaleString()} ${baseUom}`;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Stock Count</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            {stats.total} counts — {stats.submitted} pending review, {stats.reviewed} reviewed
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Search outlet or staff..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1.5">
          {(["all", "SUBMITTED", "REVIEWED"] as const).map((t) => (
            <button key={t} onClick={() => setStatusFilter(t)} className={`rounded-full border px-3 py-1 text-xs capitalize transition-colors ${statusFilter === t ? "border-terracotta bg-terracotta/5 text-terracotta-dark" : "border-gray-200 text-gray-500"}`}>
              {t === "all" ? `All (${stats.total})` : t === "SUBMITTED" ? `Pending (${stats.submitted})` : `Reviewed (${stats.reviewed})`}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Table */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-white overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Outlet</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Type</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Counted By</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Items</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Discrepancies</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">No stock counts found</td></tr>
            )}
            {filtered.map((sc) => {
              const discrepancies = sc.items.filter((i) => {
                if (i.countedQty == null || i.expectedQty == null) return false;
                return i.countedQty !== i.expectedQty;
              }).length;
              const unresolvedDiscrepancies = sc.items.filter((i) => {
                if (i.countedQty == null || i.expectedQty == null) return false;
                return i.countedQty !== i.expectedQty && !i.varianceReason;
              }).length;
              const StatusIcon = STATUS_ICON[sc.status] ?? Clock;
              return (
                <tr key={sc.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{formatDate(sc.countDate)}</p>
                    <p className="text-[10px] text-gray-400">{formatTime(sc.createdAt)}</p>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">{sc.outlet}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="text-[10px] capitalize">{sc.frequency.toLowerCase()}</Badge>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{sc.countedBy}</td>
                  <td className="px-4 py-3">
                    <span className="text-gray-900 font-medium">{sc.items.filter((i) => i.countedQty != null).length}</span>
                    <span className="text-gray-400 text-xs ml-1">/ {sc.items.length}</span>
                  </td>
                  <td className="px-4 py-3">
                    {discrepancies > 0 ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-red-600 font-semibold">{discrepancies}</span>
                        {unresolvedDiscrepancies > 0 && (
                          <Badge variant="outline" className="text-[10px] border-red-200 bg-red-50 text-red-600">
                            {unresolvedDiscrepancies} unresolved
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-green-600 text-xs">All OK</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className={`text-[10px] ${STATUS_STYLES[sc.status] ?? ""}`}>
                      <StatusIcon className="h-3 w-3 mr-1" />
                      {sc.status === "SUBMITTED" ? "Pending" : sc.status.toLowerCase()}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSelected(sc)}>
                      <Eye className="h-3 w-3 mr-1" />{sc.status === "SUBMITTED" ? "Review" : "View"}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Review Dialog ── */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          {selected && (() => {
            const itemsWithVariance = selected.items
              .filter((i) => i.countedQty != null)
              .sort((a, b) => {
                // Show discrepancies first
                const va = getVariance(a);
                const vb = getVariance(b);
                if (va !== null && va !== 0 && (vb === null || vb === 0)) return -1;
                if (vb !== null && vb !== 0 && (va === null || va === 0)) return 1;
                return 0;
              });
            const discrepancyCount = itemsWithVariance.filter((i) => {
              const v = getVariance(i);
              return v !== null && v !== 0;
            }).length;
            const unresolvedCount = itemsWithVariance.filter((i) => {
              const v = getVariance(i);
              return v !== null && v !== 0 && !(editReasons[i.id] || i.varianceReason);
            }).length;

            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <ClipboardCheck className="h-5 w-5 text-terracotta" />
                    Stock Count — {selected.outlet}
                  </DialogTitle>
                </DialogHeader>

                {/* Meta cards */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-2">
                  <div className="rounded-lg border p-2.5">
                    <p className="text-[10px] text-gray-500 uppercase">Date</p>
                    <p className="text-sm font-semibold">{formatDate(selected.countDate)}</p>
                  </div>
                  <div className="rounded-lg border p-2.5">
                    <p className="text-[10px] text-gray-500 uppercase">Type</p>
                    <p className="text-sm font-semibold capitalize">{selected.frequency.toLowerCase()}</p>
                  </div>
                  <div className="rounded-lg border p-2.5">
                    <p className="text-[10px] text-gray-500 uppercase">Counted By</p>
                    <p className="text-sm font-semibold">{selected.countedBy}</p>
                  </div>
                  <div className="rounded-lg border p-2.5">
                    <p className="text-[10px] text-gray-500 uppercase">Items</p>
                    <p className="text-sm font-semibold">{itemsWithVariance.length}</p>
                  </div>
                  <div className={`rounded-lg border p-2.5 ${discrepancyCount > 0 ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"}`}>
                    <p className="text-[10px] text-gray-500 uppercase">Discrepancies</p>
                    <p className={`text-sm font-semibold ${discrepancyCount > 0 ? "text-red-600" : "text-green-600"}`}>
                      {discrepancyCount > 0 ? `${discrepancyCount} found` : "None"}
                    </p>
                  </div>
                </div>

                {/* Variance table */}
                <div className="mt-3 rounded-lg border overflow-hidden overflow-x-auto">
                  <table className="w-full text-xs min-w-[720px]">
                    <thead>
                      <tr className="bg-gray-50 border-b">
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Product</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500">Expected</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500">Counted</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500">Variance</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500 min-w-[180px]">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itemsWithVariance.map((item) => {
                        const variance = getVariance(item);
                        const hasVariance = variance !== null && variance !== 0;
                        const cf = item.packageConversion || 1;
                        const uom = item.package || item.baseUom;

                        return (
                          <tr key={item.id} className={`border-b border-gray-50 ${hasVariance ? "bg-red-50/30" : ""}`}>
                            <td className="px-3 py-2">
                              <p className="font-medium text-gray-900">{item.product}</p>
                              <p className="text-[10px] text-gray-400">{item.sku}</p>
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-gray-500">
                              {formatQty(item.expectedQty, cf, item.baseUom, uom)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-medium text-gray-900">
                              {formatQty(item.countedQty, cf, item.baseUom, uom)}
                            </td>
                            <td className={`px-3 py-2 text-right font-mono font-bold ${
                              !hasVariance ? "text-green-600" : variance! < 0 ? "text-red-600" : "text-amber-600"
                            }`}>
                              {variance === null ? "—" : variance === 0 ? "✓" : (
                                <>
                                  {variance > 0 ? "+" : ""}{formatQty(variance, cf, item.baseUom, uom)}
                                </>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {hasVariance ? (
                                selected.status === "SUBMITTED" ? (
                                  <select
                                    className="h-7 w-full rounded border border-gray-200 px-2 text-xs"
                                    value={editReasons[item.id] || item.varianceReason || ""}
                                    onChange={(e) => setEditReasons((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                  >
                                    <option value="">Select reason...</option>
                                    {VARIANCE_REASONS.map((r) => (
                                      <option key={r} value={r}>{r}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="text-gray-600">{item.varianceReason || "—"}</span>
                                )
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Actions */}
                {selected.status === "SUBMITTED" && (
                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-xs text-gray-500">
                      {unresolvedCount > 0
                        ? <span className="text-red-500 font-medium">{unresolvedCount} discrepancies need a reason before review</span>
                        : <span className="text-green-600">All discrepancies resolved ✓</span>
                      }
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => saveReasons(selected.id)}
                        disabled={saving}
                      >
                        {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                        Save
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => markReviewed(selected.id)}
                        disabled={reviewing || unresolvedCount > 0}
                        className="bg-green-600 hover:bg-green-700"
                      >
                        {reviewing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                        Approve &amp; Close
                      </Button>
                    </div>
                  </div>
                )}

                {selected.status === "REVIEWED" && selected.reviewedAt && (
                  <p className="mt-3 text-xs text-gray-400 text-right">
                    Reviewed on {formatDate(selected.reviewedAt)} at {formatTime(selected.reviewedAt)}
                  </p>
                )}
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
