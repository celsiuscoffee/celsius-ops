"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useFetch } from "@/lib/use-fetch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Search,
  Loader2,
  ArrowRightLeft,
  ArrowRight,
  Plus,
  Minus,
  X,
  CheckCircle2,
  Clock,
  Package,
  ChevronDown,
} from "lucide-react";

type TransferItem = {
  id: string;
  product: string;
  sku: string;
  package: string;
  quantity: number;
};

type Transfer = {
  id: string;
  fromOutlet: string;
  fromOutletCode: string;
  toOutlet: string;
  toOutletCode: string;
  status: string;
  transferredBy: string;
  notes: string | null;
  createdAt: string;
  completedAt: string | null;
  items: TransferItem[];
};

type Outlet = { id: string; name: string; code: string };
type Product = { id: string; name: string; sku: string; baseUom: string };

type NewItem = {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
};

export default function AdminTransfersPage() {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"" | "PENDING" | "COMPLETED" | "CANCELLED">("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Create dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [fromOutletId, setFromOutletId] = useState("");
  const [toOutletId, setToOutletId] = useState("");
  const [transferNotes, setTransferNotes] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [newItems, setNewItems] = useState<NewItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const { data: outlets = [] } = useFetch<Outlet[]>("/api/outlets");
  const { data: products = [] } = useFetch<Product[]>("/api/products/options");

  const loadTransfers = () => {
    fetch("/api/transfers")
      .then((r) => r.json())
      .then((data) => { setTransfers(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { loadTransfers(); }, []);

  const filtered = transfers.filter((t) => {
    const matchSearch =
      t.fromOutlet.toLowerCase().includes(search.toLowerCase()) ||
      t.toOutlet.toLowerCase().includes(search.toLowerCase()) ||
      t.transferredBy.toLowerCase().includes(search.toLowerCase());
    const matchFilter = !filter || t.status === filter;
    return matchSearch && matchFilter;
  });

  const statusCounts = {
    pending: transfers.filter((t) => t.status === "PENDING").length,
    completed: transfers.filter((t) => t.status === "COMPLETED").length,
    cancelled: transfers.filter((t) => t.status === "CANCELLED").length,
  };

  const completeTransfer = async (id: string) => {
    setUpdatingId(id);
    try {
      await fetch(`/api/transfers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "COMPLETED" }),
      });
      loadTransfers();
    } finally {
      setUpdatingId(null);
    }
  };

  const cancelTransfer = async (id: string) => {
    if (!confirm("Cancel this transfer?")) return;
    setUpdatingId(id);
    try {
      await fetch(`/api/transfers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELLED" }),
      });
      loadTransfers();
    } finally {
      setUpdatingId(null);
    }
  };

  // ── Create transfer ──

  const openCreate = () => {
    setFromOutletId("");
    setToOutletId("");
    setTransferNotes("");
    setProductSearch("");
    setNewItems([]);
    setDialogOpen(true);
  };

  const filteredProducts = products.filter(
    (p) =>
      (p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.sku.toLowerCase().includes(productSearch.toLowerCase())) &&
      !newItems.some((i) => i.productId === p.id),
  );

  const addItem = (p: Product) => {
    setNewItems((prev) => [...prev, { productId: p.id, productName: p.name, sku: p.sku, quantity: 1 }]);
    setProductSearch("");
  };

  const updateQty = (productId: string, delta: number) => {
    setNewItems((prev) =>
      prev.map((i) => i.productId === productId ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i),
    );
  };

  const removeItem = (productId: string) => {
    setNewItems((prev) => prev.filter((i) => i.productId !== productId));
  };

  const handleCreate = async () => {
    if (!fromOutletId || !toOutletId || newItems.length === 0) return;
    setSubmitting(true);
    try {
      // Get current user for transferredById
      const userRes = await fetch("/api/auth/me");
      const user = userRes.ok ? await userRes.json() : null;

      const res = await fetch("/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromOutletId,
          toOutletId,
          transferredById: user?.id ?? "",
          notes: transferNotes || null,
          items: newItems.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        }),
      });
      if (res.ok) {
        setDialogOpen(false);
        loadTransfers();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });

  const statusColor = (status: string) => {
    switch (status) {
      case "COMPLETED": return "bg-green-500";
      case "PENDING": return "bg-amber-500";
      case "CANCELLED": return "bg-gray-400";
      default: return "bg-gray-400";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Transfers</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            {transfers.length} transfers &mdash; {statusCounts.pending} pending, {statusCounts.completed} completed, {statusCounts.cancelled} cancelled
          </p>
        </div>
        <Button onClick={openCreate} className="bg-terracotta hover:bg-terracotta-dark">
          <Plus className="mr-1.5 h-4 w-4" />Create Transfer
        </Button>
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Search outlet or staff..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1.5">
          {([{ value: "", label: `All (${transfers.length})` }, { value: "PENDING", label: `Pending (${statusCounts.pending})` }, { value: "COMPLETED", label: `Completed (${statusCounts.completed})` }, { value: "CANCELLED", label: `Cancelled (${statusCounts.cancelled})` }] as const).map((f) => (
            <button key={f.value} onClick={() => setFilter(f.value as typeof filter)} className={`rounded-full border px-3 py-1 text-xs transition-colors ${filter === f.value ? "border-terracotta bg-terracotta/5 text-terracotta-dark" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="w-8 px-3 py-3"></th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Route</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Items</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Created By</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <ArrowRightLeft className="mx-auto h-8 w-8 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">No transfers found</p>
                </td>
              </tr>
            )}
            {filtered.map((t) => (
              <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-3 py-3">
                  <button onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}>
                    <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${expandedId === t.id ? "rotate-180" : ""}`} />
                  </button>
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">{formatDate(t.createdAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 text-sm">
                    <span className="font-medium text-gray-900">{t.fromOutlet}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-gray-400" />
                    <span className="font-medium text-gray-900">{t.toOutlet}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-gray-600">{t.items.length} item{t.items.length !== 1 ? "s" : ""}</td>
                <td className="px-4 py-3 text-xs text-gray-600">{t.transferredBy}</td>
                <td className="px-4 py-3">
                  <Badge className={`text-[10px] ${statusColor(t.status)}`}>{t.status.toLowerCase()}</Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  {t.status === "PENDING" && (
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => completeTransfer(t.id)}
                        disabled={updatingId === t.id}
                        className="rounded-md bg-green-500 px-2 py-1 text-[10px] font-medium text-white hover:bg-green-600 disabled:opacity-50"
                      >
                        {updatingId === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Complete"}
                      </button>
                      <button
                        onClick={() => cancelTransfer(t.id)}
                        disabled={updatingId === t.id}
                        className="rounded-md border border-red-200 px-2 py-1 text-[10px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  {t.status === "COMPLETED" && (
                    <CheckCircle2 className="ml-auto h-4 w-4 text-green-500" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Expanded items */}
      {expandedId && (() => {
        const t = transfers.find((t) => t.id === expandedId);
        if (!t) return null;
        return (
          <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-6 py-3">
            <p className="mb-2 text-xs font-semibold text-gray-500 uppercase">Transfer Items</p>
            <div className="space-y-1">
              {t.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-md bg-white px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium text-gray-900">{item.product}</span>
                    <code className="ml-2 text-xs text-gray-400">{item.sku}</code>
                    {item.package && <span className="ml-2 text-xs text-gray-400">{item.package}</span>}
                  </div>
                  <span className="font-medium text-gray-700">x {item.quantity}</span>
                </div>
              ))}
            </div>
            {t.notes && <p className="mt-2 text-xs text-gray-500">Notes: {t.notes}</p>}
            {t.completedAt && <p className="mt-1 text-xs text-green-600">Completed: {formatDate(t.completedAt)}</p>}
          </div>
        );
      })()}

      {/* Create Transfer Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Create Transfer</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700">From Outlet</label>
                <select
                  className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                  value={fromOutletId}
                  onChange={(e) => setFromOutletId(e.target.value)}
                >
                  <option value="">Select source...</option>
                  {outlets.filter((b) => b.id !== toOutletId).map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">To Outlet</label>
                <select
                  className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                  value={toOutletId}
                  onChange={(e) => setToOutletId(e.target.value)}
                >
                  <option value="">Select destination...</option>
                  {outlets.filter((b) => b.id !== fromOutletId).map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {fromOutletId && toOutletId && (
              <div className="flex items-center gap-2 rounded-lg bg-terracotta/5 px-3 py-2 text-xs text-terracotta-dark">
                <ArrowRightLeft className="h-3.5 w-3.5" />
                {outlets.find((b) => b.id === fromOutletId)?.name} → {outlets.find((b) => b.id === toOutletId)?.name}
              </div>
            )}

            <div>
              <label className="text-sm font-medium text-gray-700">Add Products</label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input placeholder="Search by name or SKU..." className="pl-9" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} />
              </div>
              {productSearch && (
                <div className="mt-1 max-h-36 overflow-y-auto rounded-md border bg-white shadow-sm">
                  {filteredProducts.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">No products found</p>}
                  {filteredProducts.slice(0, 8).map((p) => (
                    <button key={p.id} onClick={() => addItem(p)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50">
                      <span className="text-gray-900">{p.name}</span>
                      <span className="text-xs text-gray-400">{p.sku}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {newItems.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">{newItems.length} items</label>
                {newItems.map((item) => (
                  <div key={item.productId} className="flex items-center justify-between rounded-md border px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-gray-900">{item.productName}</p>
                      <p className="text-xs text-gray-400">{item.sku}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => updateQty(item.productId, -1)} className="flex h-6 w-6 items-center justify-center rounded bg-gray-100 text-gray-600">
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="min-w-[1.5rem] text-center text-sm font-medium">{item.quantity}</span>
                      <button onClick={() => updateQty(item.productId, 1)} className="flex h-6 w-6 items-center justify-center rounded bg-terracotta/10 text-terracotta-dark">
                        <Plus className="h-3 w-3" />
                      </button>
                      <button onClick={() => removeItem(item.productId)} className="ml-1 flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:text-red-500">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className="text-sm font-medium text-gray-700">Notes (optional)</label>
              <Input className="mt-1" placeholder="Transfer notes..." value={transferNotes} onChange={(e) => setTransferNotes(e.target.value)} />
            </div>

            <Button
              className="w-full bg-terracotta hover:bg-terracotta-dark"
              disabled={!fromOutletId || !toOutletId || newItems.length === 0 || submitting}
              onClick={handleCreate}
            >
              {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ArrowRightLeft className="mr-1.5 h-4 w-4" />}
              {submitting ? "Creating..." : "Create Transfer"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
