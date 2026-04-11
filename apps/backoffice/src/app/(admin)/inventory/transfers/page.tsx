"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeftRight, Loader2, Search, ArrowRight,
  CheckCircle2, Package, Eye, Truck, Plus, X, Ban, Trash2,
  Clock, ShieldCheck, Send, PackageCheck,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { AIInsightBanner } from "@/components/ai-insight-banner";

interface TransferItem {
  id: string;
  product: string;
  sku: string;
  package: string;
  quantity: number;
}

interface Transfer {
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
  approvedBy?: string;
  approvedAt?: string;
  receivedBy?: string;
  receivedAt?: string;
  rejectionReason?: string;
}

type Outlet = { id: string; name: string; code: string };
type ProductPackage = { id: string; name: string; label: string; conversionFactor: number; isDefault: boolean };
type Product = { id: string; name: string; sku: string; baseUom: string; category: string; packages: ProductPackage[] };
type CartItem = { productId: string; name: string; sku: string; uom: string; quantity: number; productPackageId: string | null; conversionFactor: number; availableStock: number };

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-50 text-gray-600 border-gray-200",
  PENDING_APPROVAL: "bg-amber-50 text-amber-700 border-amber-200",
  APPROVED: "bg-blue-50 text-blue-700 border-blue-200",
  IN_TRANSIT: "bg-purple-50 text-purple-700 border-purple-200",
  RECEIVED: "bg-green-50 text-green-700 border-green-200",
  COMPLETED: "bg-green-50 text-green-700 border-green-200",
  CANCELLED: "bg-red-50 text-red-500 border-red-200",
  PENDING: "bg-yellow-50 text-yellow-700 border-yellow-200",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending Approval",
  APPROVED: "Approved",
  IN_TRANSIT: "In Transit",
  RECEIVED: "Received",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  PENDING: "Pending",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" });
}

export default function TransfersPage() {
  const [data, setData] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Transfer | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Reject dialog state
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectTransferId, setRejectTransferId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [fromOutletId, setFromOutletId] = useState("");
  const [toOutletId, setToOutletId] = useState("");
  const [transferNotes, setTransferNotes] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [user, setUser] = useState<{ id: string; name: string } | null>(null);
  const [stockBalances, setStockBalances] = useState<Record<string, number>>({}); // from outlet: productId → base qty
  const [toStockBalances, setToStockBalances] = useState<Record<string, number>>({}); // to outlet: productId → base qty

  const reload = useCallback(() => {
    fetch("/api/inventory/transfers")
      .then((r) => r.json())
      .then(setData);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/inventory/transfers").then((r) => r.json()),
      fetch("/api/auth/me").then((r) => r.ok ? r.json() : null),
    ]).then(([transfers, userData]) => {
      setData(transfers);
      setUser(userData);
    }).finally(() => setLoading(false));
  }, []);

  const loadCreateData = useCallback(async () => {
    const [outletsRes, productsRes] = await Promise.all([
      fetch("/api/settings/outlets?status=ACTIVE"),
      fetch("/api/inventory/products"),
    ]);
    setOutlets(await outletsRes.json());
    setProducts(await productsRes.json());
  }, []);

  // Fetch stock levels for an outlet
  const fetchStockForOutlet = useCallback(async (outletId: string, setter: (m: Record<string, number>) => void) => {
    if (!outletId) { setter({}); return; }
    try {
      const res = await fetch(`/api/inventory/stock-levels?outletId=${outletId}`);
      if (res.ok) {
        const data = await res.json();
        const items: { productId: string; currentQty: number }[] = data.items || data;
        const map: Record<string, number> = {};
        for (const item of items) map[item.productId] = item.currentQty;
        setter(map);
      }
    } catch { /* ignore */ }
  }, []);

  const openCreate = () => {
    setCreateOpen(true);
    setFromOutletId("");
    setToOutletId("");
    setTransferNotes("");
    setCart([]);
    setProductSearch("");
    setStockBalances({});
    setToStockBalances({});
    loadCreateData();
  };

  const filteredProducts = products.filter(
    (p) => (p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.sku.toLowerCase().includes(productSearch.toLowerCase()))
      && !cart.some((c) => c.productId === p.id)
      && (stockBalances[p.id] ?? 0) > 0 // only show products with stock at source outlet
  );

  const addToCart = (product: Product) => {
    const pkg = product.packages.find((p) => p.isDefault) || product.packages[0] || null;
    const conv = pkg?.conversionFactor || 1;
    const baseStock = stockBalances[product.id] ?? 0;
    const pkgStock = Math.floor(baseStock / conv);
    setCart((prev) => [...prev, {
      productId: product.id,
      name: product.name,
      sku: product.sku,
      uom: pkg?.label || pkg?.name || product.baseUom,
      quantity: Math.min(1, pkgStock),
      productPackageId: pkg?.id || null,
      conversionFactor: conv,
      availableStock: pkgStock,
    }]);
    setProductSearch("");
  };

  const updateCartQty = (idx: number, qty: number) => {
    setCart((prev) => prev.map((c, i) => i === idx ? { ...c, quantity: Math.max(0, Math.min(qty, c.availableStock)) } : c));
  };

  const removeFromCart = (idx: number) => {
    setCart((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleCreate = async () => {
    if (!fromOutletId || !toOutletId || cart.length === 0 || !user) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/inventory/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromOutletId,
          toOutletId,
          transferredById: user.id,
          notes: transferNotes || null,
          items: cart.filter((c) => c.quantity > 0).map((c) => ({
            productId: c.productId,
            productPackageId: c.productPackageId || undefined,
            quantity: c.quantity,
          })),
        }),
      });
      if (res.ok) {
        setCreateOpen(false);
        reload();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = useMemo(() => {
    return data.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return t.fromOutlet.toLowerCase().includes(q) || t.toOutlet.toLowerCase().includes(q) || t.transferredBy.toLowerCase().includes(q);
      }
      return true;
    });
  }, [data, search, statusFilter]);

  const stats = useMemo(() => ({
    total: data.length,
    draft: data.filter((t) => t.status === "DRAFT").length,
    pendingApproval: data.filter((t) => t.status === "PENDING_APPROVAL").length,
    approved: data.filter((t) => t.status === "APPROVED").length,
    inTransit: data.filter((t) => t.status === "IN_TRANSIT").length,
    received: data.filter((t) => t.status === "RECEIVED" || t.status === "COMPLETED").length,
    cancelled: data.filter((t) => t.status === "CANCELLED").length,
    pending: data.filter((t) => t.status === "PENDING").length,
  }), [data]);

  async function updateTransferStatus(id: string, status: string, extra?: { rejectionReason?: string }) {
    if (status === "RECEIVED") {
      if (!confirm("Confirm received? Stock will be added to the destination outlet.")) return;
    }
    if (status === "APPROVED") {
      if (!confirm("Approve this transfer? Stock will be subtracted from the source outlet.")) return;
    }
    if (status === "COMPLETED") {
      if (!confirm("Complete this transfer? Stock will be moved between outlets.")) return;
    }
    setActionLoading(true);
    try {
      const res = await fetch(`/api/inventory/transfers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...extra }),
      });
      if (!res.ok) { alert("Failed to update transfer status."); return; }
      // Reload to get fresh data with user names
      reload();
      if (selected?.id === id) {
        const updated = await res.json();
        setSelected((prev) => prev ? { ...prev, ...updated, status } : null);
      }
    } finally {
      setActionLoading(false);
    }
  }

  const openRejectDialog = (transferId: string) => {
    setRejectTransferId(transferId);
    setRejectionReason("");
    setRejectDialogOpen(true);
  };

  const handleReject = async () => {
    if (!rejectTransferId || !rejectionReason.trim()) return;
    setRejectDialogOpen(false);
    await updateTransferStatus(rejectTransferId, "CANCELLED", { rejectionReason: rejectionReason.trim() });
    setRejectTransferId(null);
    setRejectionReason("");
  };

  const renderActionButtons = (t: Transfer, size: "sm" | "md" = "sm") => {
    const iconSize = size === "sm" ? "h-3 w-3" : "h-4 w-4";

    switch (t.status) {
      case "DRAFT":
        return (
          <button
            onClick={() => updateTransferStatus(t.id, "PENDING_APPROVAL")}
            disabled={actionLoading}
            className="rounded-md px-2 py-1 text-[10px] font-medium text-white bg-amber-500 hover:bg-amber-600"
            title="Submit for Approval"
          >
            <Send className={iconSize} />
          </button>
        );
      case "PENDING_APPROVAL":
        return (
          <>
            <button
              onClick={() => updateTransferStatus(t.id, "APPROVED")}
              disabled={actionLoading}
              className="rounded-md px-2 py-1 text-[10px] font-medium text-white bg-green-500 hover:bg-green-600"
              title="Approve"
            >
              <ShieldCheck className={iconSize} />
            </button>
            <button
              onClick={() => openRejectDialog(t.id)}
              disabled={actionLoading}
              className="rounded-md px-2 py-1 text-[10px] font-medium text-red-600 border border-red-200 hover:bg-red-50"
              title="Reject"
            >
              <Ban className={iconSize} />
            </button>
          </>
        );
      case "APPROVED":
        return (
          <button
            onClick={() => updateTransferStatus(t.id, "IN_TRANSIT")}
            disabled={actionLoading}
            className="rounded-md px-2 py-1 text-[10px] font-medium text-white bg-purple-500 hover:bg-purple-600"
            title="Mark In Transit"
          >
            <Truck className={iconSize} />
          </button>
        );
      case "IN_TRANSIT":
        return (
          <button
            onClick={() => updateTransferStatus(t.id, "RECEIVED")}
            disabled={actionLoading}
            className="rounded-md px-2 py-1 text-[10px] font-medium text-white bg-green-500 hover:bg-green-600"
            title="Confirm Received"
          >
            <PackageCheck className={iconSize} />
          </button>
        );
      case "PENDING":
        return (
          <>
            <button
              onClick={() => updateTransferStatus(t.id, "COMPLETED")}
              disabled={actionLoading}
              className="rounded-md px-2 py-1 text-[10px] font-medium text-white bg-green-500 hover:bg-green-600"
              title="Complete"
            >
              <CheckCircle2 className={iconSize} />
            </button>
            <button
              onClick={() => { if (confirm("Cancel this transfer?")) updateTransferStatus(t.id, "CANCELLED"); }}
              disabled={actionLoading}
              className="rounded-md px-2 py-1 text-[10px] font-medium text-red-600 border border-red-200 hover:bg-red-50"
              title="Cancel"
            >
              <Ban className={iconSize} />
            </button>
          </>
        );
      case "RECEIVED":
      case "COMPLETED":
        return <CheckCircle2 className={`${iconSize} text-green-500`} />;
      case "CANCELLED":
        return <Ban className={`${iconSize} text-gray-400`} />;
      default:
        return null;
    }
  };

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
          <h2 className="text-xl font-semibold text-gray-900">Transfers</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            {stats.total} transfers — {stats.draft} draft, {stats.pendingApproval} pending approval, {stats.inTransit} in transit, {stats.received} received
          </p>
        </div>
        <Button onClick={openCreate} className="bg-terracotta hover:bg-terracotta-dark">
          <Plus className="mr-1.5 h-4 w-4" />New Transfer
        </Button>
      </div>

      {/* AI Suggestions */}
      <div className="mt-4">
        <AIInsightBanner type="transfers" onCreated={reload} />
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Search outlet or staff..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {[
            { key: "all", label: `All (${stats.total})` },
            { key: "DRAFT", label: `Draft (${stats.draft})` },
            { key: "PENDING_APPROVAL", label: `Pending Approval (${stats.pendingApproval})` },
            { key: "APPROVED", label: `Approved (${stats.approved})` },
            { key: "IN_TRANSIT", label: `In Transit (${stats.inTransit})` },
            { key: "RECEIVED", label: `Received (${stats.received})` },
            { key: "CANCELLED", label: `Cancelled (${stats.cancelled})` },
          ].map((t) => (
            <button key={t.key} onClick={() => setStatusFilter(t.key)} className={`rounded-full border px-3 py-1 text-xs transition-colors ${statusFilter === t.key ? "border-terracotta bg-terracotta/5 text-terracotta-dark" : "border-gray-200 text-gray-500"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
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
              <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                {data.length === 0 ? "No transfers yet. Click 'New Transfer' to move stock between outlets." : "No transfers match your filter."}
              </td></tr>
            )}
            {filtered.map((t) => (
              <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">{formatDate(t.createdAt)}</p>
                  <p className="text-[10px] text-gray-400">{formatTime(t.createdAt)}</p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-gray-900">{t.fromOutlet}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-gray-400" />
                    <span className="font-medium text-gray-900">{t.toOutlet}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <Package className="h-3.5 w-3.5 text-gray-400" />
                    <span className="font-medium">{t.items.length}</span>
                    <span className="text-gray-400 text-xs">items</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600">{t.transferredBy}</td>
                <td className="px-4 py-3">
                  <Badge variant="outline" className={`text-[10px] ${STATUS_STYLES[t.status] ?? ""}`}>
                    {STATUS_LABELS[t.status] ?? t.status}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSelected(t)}>
                      <Eye className="h-3 w-3 mr-1" />View
                    </Button>
                    {renderActionButtons(t)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ArrowLeftRight className="h-5 w-5 text-terracotta" />
                  Transfer Details
                </DialogTitle>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-3 mt-2">
                <div className="rounded-lg border p-3">
                  <p className="text-[10px] text-gray-500 uppercase">From</p>
                  <p className="text-sm font-semibold">{selected.fromOutlet}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-[10px] text-gray-500 uppercase">To</p>
                  <p className="text-sm font-semibold">{selected.toOutlet}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-[10px] text-gray-500 uppercase">Created By</p>
                  <p className="text-sm font-semibold">{selected.transferredBy}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-[10px] text-gray-500 uppercase">Status</p>
                  <Badge variant="outline" className={`text-[10px] ${STATUS_STYLES[selected.status] ?? ""}`}>
                    {STATUS_LABELS[selected.status] ?? selected.status}
                  </Badge>
                </div>
              </div>

              {selected.notes && (
                <p className="text-xs text-gray-500 mt-2 bg-gray-50 rounded-lg px-3 py-2">Note: {selected.notes}</p>
              )}

              {/* Approval info */}
              {selected.approvedBy && selected.approvedAt && (
                <p className="text-xs text-blue-600 mt-2 bg-blue-50 rounded-lg px-3 py-2">
                  Approved by: {selected.approvedBy} on {formatDate(selected.approvedAt)} at {formatTime(selected.approvedAt)}
                </p>
              )}

              {/* Received info */}
              {selected.receivedBy && selected.receivedAt && (
                <p className="text-xs text-green-600 mt-2 bg-green-50 rounded-lg px-3 py-2">
                  Received by: {selected.receivedBy} on {formatDate(selected.receivedAt)} at {formatTime(selected.receivedAt)}
                </p>
              )}

              {/* Rejection reason */}
              {selected.status === "CANCELLED" && selected.rejectionReason && (
                <p className="text-xs text-red-600 mt-2 bg-red-50 rounded-lg px-3 py-2">
                  Rejection reason: {selected.rejectionReason}
                </p>
              )}

              <div className="mt-3 rounded-lg border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Product</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">SKU</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Package</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.items.map((item) => (
                      <tr key={item.id} className="border-b border-gray-50">
                        <td className="px-3 py-2 font-medium text-gray-900">{item.product}</td>
                        <td className="px-3 py-2 text-gray-500">{item.sku}</td>
                        <td className="px-3 py-2 text-gray-500">{item.package || "—"}</td>
                        <td className="px-3 py-2 text-right font-mono font-medium">{item.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Action buttons in detail dialog */}
              {(selected.status === "DRAFT" || selected.status === "PENDING_APPROVAL" || selected.status === "APPROVED" || selected.status === "IN_TRANSIT" || selected.status === "PENDING") && (
                <div className="mt-4 flex justify-end gap-2">
                  {selected.status === "DRAFT" && (
                    <Button
                      onClick={() => updateTransferStatus(selected.id, "PENDING_APPROVAL")}
                      disabled={actionLoading}
                      className="bg-amber-500 hover:bg-amber-600"
                    >
                      {actionLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                      Submit for Approval
                    </Button>
                  )}
                  {selected.status === "PENDING_APPROVAL" && (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => openRejectDialog(selected.id)}
                        disabled={actionLoading}
                        className="border-red-200 text-red-600 hover:bg-red-50"
                      >
                        <Ban className="h-4 w-4 mr-1" />Reject
                      </Button>
                      <Button
                        onClick={() => updateTransferStatus(selected.id, "APPROVED")}
                        disabled={actionLoading}
                        className="bg-green-600 hover:bg-green-700"
                      >
                        {actionLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-1" />}
                        Approve
                      </Button>
                    </>
                  )}
                  {selected.status === "APPROVED" && (
                    <Button
                      onClick={() => updateTransferStatus(selected.id, "IN_TRANSIT")}
                      disabled={actionLoading}
                      className="bg-purple-600 hover:bg-purple-700"
                    >
                      {actionLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Truck className="h-4 w-4 mr-1" />}
                      Mark In Transit
                    </Button>
                  )}
                  {selected.status === "IN_TRANSIT" && (
                    <Button
                      onClick={() => updateTransferStatus(selected.id, "RECEIVED")}
                      disabled={actionLoading}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      {actionLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <PackageCheck className="h-4 w-4 mr-1" />}
                      Confirm Received
                    </Button>
                  )}
                  {selected.status === "PENDING" && (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => { if (confirm("Cancel this transfer?")) updateTransferStatus(selected.id, "CANCELLED"); }}
                        disabled={actionLoading}
                        className="border-red-200 text-red-600 hover:bg-red-50"
                      >
                        <Ban className="h-4 w-4 mr-1" />Cancel
                      </Button>
                      <Button
                        onClick={() => updateTransferStatus(selected.id, "COMPLETED")}
                        disabled={actionLoading}
                        className="bg-green-600 hover:bg-green-700"
                      >
                        {actionLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Truck className="h-4 w-4 mr-1" />}
                        Mark as Completed
                      </Button>
                    </>
                  )}
                </div>
              )}

              {selected.completedAt && (
                <p className="text-xs text-green-600 mt-2 text-right">
                  Completed on {formatDate(selected.completedAt)} at {formatTime(selected.completedAt)}
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject Transfer</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-500">Please provide a reason for rejecting this transfer.</p>
          <textarea
            className="mt-2 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-terracotta focus:outline-none"
            rows={3}
            placeholder="Reason for rejection..."
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleReject}
              disabled={!rejectionReason.trim()}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Reject Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Transfer Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5 text-terracotta" />
              New Transfer
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Outlet selectors */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600">From Outlet</label>
                <select
                  className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                  value={fromOutletId}
                  onChange={(e) => { setFromOutletId(e.target.value); setCart([]); fetchStockForOutlet(e.target.value, setStockBalances); }}
                >
                  <option value="">Select...</option>
                  {outlets.filter((o) => o.id !== toOutletId).map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">To Outlet</label>
                <select
                  className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                  value={toOutletId}
                  onChange={(e) => { setToOutletId(e.target.value); fetchStockForOutlet(e.target.value, setToStockBalances); }}
                >
                  <option value="">Select...</option>
                  {outlets.filter((o) => o.id !== fromOutletId).map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Product search + add */}
            <div>
              <label className="text-xs font-medium text-gray-600">Add Products</label>
              {!fromOutletId && <p className="mt-1 text-xs text-amber-600">Select source outlet first</p>}
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  placeholder={fromOutletId ? "Search product..." : "Select source outlet first..."}
                  className="pl-9"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  disabled={!fromOutletId}
                />
              </div>
              {productSearch && (
                <div className="mt-1 max-h-40 overflow-y-auto rounded-md border bg-white shadow-sm">
                  {filteredProducts.length === 0 && (
                    <p className="px-3 py-2 text-xs text-gray-400">No products found</p>
                  )}
                  {filteredProducts.slice(0, 8).map((p) => {
                    const pkg = p.packages.find((pk) => pk.isDefault) || p.packages[0];
                    const conv = pkg?.conversionFactor || 1;
                    const baseStock = stockBalances[p.id] ?? 0;
                    const pkgStock = Math.floor(baseStock / conv);
                    return (
                      <button
                        key={p.id}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
                        onClick={() => addToCart(p)}
                      >
                        <span className="text-gray-900">{p.name}</span>
                        <span className="text-xs text-gray-400">{pkgStock} {pkg?.label || p.baseUom} · {p.sku}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Cart items */}
            {cart.length > 0 && (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Product</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Pkg</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">From</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500 w-20">Qty</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">To</th>
                      <th className="px-3 py-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((item, idx) => {
                      const conv = item.conversionFactor;
                      const fromAfter = item.availableStock - item.quantity;
                      const toBase = toStockBalances[item.productId] ?? 0;
                      const toCurrent = Math.floor(toBase / conv);
                      const toAfter = toCurrent + item.quantity;
                      return (
                      <tr key={item.productId} className={`border-b border-gray-50 ${item.quantity > item.availableStock ? "bg-red-50" : ""}`}>
                        <td className="px-3 py-2">
                          <p className="font-medium text-gray-900">{item.name}</p>
                          <p className="text-[10px] text-gray-400">{item.sku}</p>
                        </td>
                        <td className="px-3 py-2 text-gray-500">{item.uom}</td>
                        <td className="px-3 py-2 text-right">
                          <span className={item.availableStock <= 0 ? "text-red-600 font-medium" : "text-gray-500"}>{item.availableStock}</span>
                          <span className="text-gray-300 mx-0.5">&rarr;</span>
                          <span className={fromAfter <= 0 ? "text-red-600 font-medium" : "text-gray-700 font-medium"}>{fromAfter}</span>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="1"
                            max={item.availableStock}
                            className="w-full rounded border border-gray-200 px-2 py-1 text-right text-xs focus:border-terracotta focus:outline-none"
                            value={item.quantity}
                            onChange={(e) => updateCartQty(idx, parseInt(e.target.value) || 0)}
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className="text-gray-500">{toCurrent}</span>
                          <span className="text-gray-300 mx-0.5">&rarr;</span>
                          <span className="text-green-600 font-medium">{toAfter}</span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button onClick={() => removeFromCart(idx)} className="text-red-400 hover:text-red-600">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="text-xs font-medium text-gray-600">Notes (optional)</label>
              <Input
                className="mt-1"
                placeholder="Reason for transfer..."
                value={transferNotes}
                onChange={(e) => setTransferNotes(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={!fromOutletId || !toOutletId || cart.length === 0 || submitting}
              className="bg-terracotta hover:bg-terracotta-dark"
            >
              {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ArrowLeftRight className="mr-1.5 h-4 w-4" />}
              Create Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
