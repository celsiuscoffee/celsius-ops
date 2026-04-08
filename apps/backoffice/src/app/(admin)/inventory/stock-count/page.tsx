"use client";

import { useState, useEffect, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ClipboardCheck, Loader2, Search, ChevronDown, ChevronRight,
  CheckCircle2, Clock, AlertTriangle, Eye,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface StockCountItem {
  id: string;
  product: string;
  sku: string;
  package: string;
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/inventory/stock-checks")
      .then((r) => { if (!r.ok) throw new Error("Failed to load stock counts"); return r.json(); })
      .then((d) => { setData(d); setError(null); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

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

  async function markReviewed(id: string) {
    setReviewing(true);
    await fetch(`/api/inventory/stock-checks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "REVIEWED" }),
    });
    setData((prev) => prev.map((sc) => sc.id === id ? { ...sc, status: "REVIEWED", reviewedAt: new Date().toISOString() } : sc));
    setSelected((prev) => prev ? { ...prev, status: "REVIEWED", reviewedAt: new Date().toISOString() } : null);
    setReviewing(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
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
      <div className="mt-4 rounded-xl border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Outlet</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Type</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Counted By</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Items</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Adjustments</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">No stock counts found</td></tr>
            )}
            {filtered.map((sc) => {
              const adjustments = sc.items.filter((i) => i.countedQty !== null && !i.isConfirmed).length;
              const confirmed = sc.items.filter((i) => i.isConfirmed).length;
              const StatusIcon = STATUS_ICON[sc.status] ?? Clock;
              return (
                <tr key={sc.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{formatDate(sc.countDate)}</p>
                    <p className="text-[10px] text-gray-400">{formatTime(sc.createdAt)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-900">{sc.outlet}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="text-[10px] capitalize">{sc.frequency.toLowerCase()}</Badge>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{sc.countedBy}</td>
                  <td className="px-4 py-3">
                    <span className="text-gray-900 font-medium">{sc.items.length}</span>
                    <span className="text-gray-400 text-xs ml-1">({confirmed} OK)</span>
                  </td>
                  <td className="px-4 py-3">
                    {adjustments > 0 ? (
                      <span className="text-terracotta font-medium">{adjustments} adjusted</span>
                    ) : (
                      <span className="text-green-600 text-xs">All confirmed</span>
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
                      <Eye className="h-3 w-3 mr-1" />View
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ClipboardCheck className="h-5 w-5 text-terracotta" />
                  Stock Count — {selected.outlet}
                </DialogTitle>
              </DialogHeader>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
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
                  <p className="text-[10px] text-gray-500 uppercase">Status</p>
                  <Badge variant="outline" className={`text-[10px] ${STATUS_STYLES[selected.status] ?? ""}`}>
                    {selected.status === "SUBMITTED" ? "Pending Review" : selected.status}
                  </Badge>
                </div>
              </div>

              {selected.notes && (
                <p className="text-xs text-gray-500 mt-2 bg-gray-50 rounded-lg px-3 py-2">Note: {selected.notes}</p>
              )}

              <div className="mt-3 rounded-lg border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Product</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">SKU</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Counted</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Status</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.items.map((item) => (
                      <tr key={item.id} className="border-b border-gray-50">
                        <td className="px-3 py-2 font-medium text-gray-900">{item.product}</td>
                        <td className="px-3 py-2 text-gray-500">{item.sku}</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {item.countedQty !== null ? item.countedQty : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {item.isConfirmed ? (
                            <span className="text-green-600 flex items-center gap-0.5"><CheckCircle2 className="h-3 w-3" />OK</span>
                          ) : item.countedQty !== null ? (
                            <span className="text-terracotta font-medium">Adjusted</span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-500">{item.varianceReason || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selected.status === "SUBMITTED" && (
                <div className="mt-4 flex justify-end">
                  <Button
                    onClick={() => markReviewed(selected.id)}
                    disabled={reviewing}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {reviewing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                    Mark as Reviewed
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
