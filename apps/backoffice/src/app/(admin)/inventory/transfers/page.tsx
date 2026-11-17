"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { KeyNumber } from "@/components/ui/key-number";
import { summariseTransfers, LATE_DAYS } from "@/lib/inventory/transfer-summary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, ArrowLeftRight, Loader2, Search, ArrowRight,
  CheckCircle2, Truck, Plus, Ban, Trash2,
  ShieldCheck, Send, PackageCheck, Sparkles, Zap,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

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
  DRAFT: "bg-sunken text-text-2",
  PENDING_APPROVAL: "bg-warn-soft text-warn-text",
  APPROVED: "bg-info-soft text-info-text",
  IN_TRANSIT: "bg-info-soft text-info-text",
  RECEIVED: "bg-ok-soft text-ok-text",
  COMPLETED: "bg-ok-soft text-ok-text",
  CANCELLED: "bg-sunken text-text-3",
  PENDING: "bg-warn-soft text-warn-text",
};

const FILTERS: { key: string; label: string; match: (s: string) => boolean }[] = [
  { key: "PENDING_APPROVAL", label: "Waiting for approval", match: (s) => s === "PENDING_APPROVAL" || s === "PENDING" },
  { key: "transit", label: "In transit", match: (s) => s === "APPROVED" || s === "IN_TRANSIT" },
  { key: "received", label: "Received", match: (s) => s === "RECEIVED" || s === "COMPLETED" },
  { key: "DRAFT", label: "Draft", match: (s) => s === "DRAFT" },
  { key: "CANCELLED", label: "Cancelled", match: (s) => s === "CANCELLED" },
];

/** What the next person has to do, in words, for the detail page banner. */
const NEXT_STEP: Record<string, string> = {
  DRAFT: "Not sent yet. Submit it for approval when the list is right.",
  PENDING_APPROVAL: "Waiting for a manager to approve or reject.",
  PENDING: "Waiting to be completed or cancelled.",
  APPROVED: "Approved. Mark it in transit when the stock leaves.",
  IN_TRANSIT: "On its way. The receiving outlet confirms when it arrives.",
  RECEIVED: "Received. Stock has moved.",
  COMPLETED: "Completed. Stock has moved.",
  CANCELLED: "Cancelled. No stock moved.",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Waiting for approval",
  APPROVED: "Approved",
  IN_TRANSIT: "In transit",
  RECEIVED: "Received",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  PENDING: "Pending",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kuala_Lumpur" });
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

  // Smart Transfer state
  type AITransfer = { fromOutletId: string; fromOutletName: string; toOutletId: string; toOutletName: string; items: { productId: string; productName: string; productSku: string; packageName: string; productPackageId: string | null; quantity: number; fromStock: number; toStock: number }[]; reason: string };
  const [aiTransfers, setAiTransfers] = useState<AITransfer[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiCreating, setAiCreating] = useState(false);

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

  const loadSmartTransfers = async () => {
    setAiLoading(true);
    setAiOpen(true);
    try {
      const res = await fetch("/api/inventory/ai-decisions");
      if (res.ok) {
        const data = await res.json();
        setAiTransfers(data.transfers || []);
      }
    } catch { /* ignore */ }
    finally { setAiLoading(false); }
  };

  const createAllSmartTransfers = async () => {
    if (aiTransfers.length === 0) return;
    setAiCreating(true);
    try {
      const res = await fetch("/api/inventory/ai-decisions/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "all_transfers",
          data: {
            transfers: aiTransfers.map((t) => ({
              fromOutletId: t.fromOutletId,
              toOutletId: t.toOutletId,
              items: t.items.map((i) => ({
                productId: i.productId,
                productPackageId: i.productPackageId,
                quantity: i.quantity,
              })),
            })),
          },
        }),
      });
      if (res.ok) {
        setAiOpen(false);
        setAiTransfers([]);
        reload();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to create transfers");
      }
    } finally { setAiCreating(false); }
  };

  const createSingleSmartTransfer = async (transfer: AITransfer) => {
    setAiCreating(true);
    try {
      const res = await fetch("/api/inventory/ai-decisions/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "transfer",
          data: {
            fromOutletId: transfer.fromOutletId,
            toOutletId: transfer.toOutletId,
            items: transfer.items.map((i) => ({
              productId: i.productId,
              productPackageId: i.productPackageId,
              quantity: i.quantity,
            })),
          },
        }),
      });
      if (res.ok) {
        setAiTransfers((prev) => prev.filter((t) => t !== transfer));
        reload();
      }
    } finally { setAiCreating(false); }
  };

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
      if (statusFilter !== "all" && !(FILTERS.find((f) => f.key === statusFilter)?.match(t.status) ?? true)) return false;
      if (search) {
        const q = search.toLowerCase();
        return t.fromOutlet.toLowerCase().includes(q) || t.toOutlet.toLowerCase().includes(q) || t.transferredBy.toLowerCase().includes(q);
      }
      return true;
    });
  }, [data, search, statusFilter]);

  const [now] = useState(() => Date.now());
  const summary = useMemo(() => summariseTransfers(data, now), [data, now]);

  async function updateTransferStatus(id: string, status: string, extra?: { rejectionReason?: string }) {
    if (status === "RECEIVED") {
      if (!confirm("Confirm received? Stock will be added to the destination outlet.")) return;
    }
    if (status === "APPROVED") {
      if (!confirm("Approve this transfer? Stock will be subtracted from the source outlet.")) return;
    }
    if (status === "IN_TRANSIT") {
      if (!confirm("Approve & dispatch this transfer? Stock will be subtracted from the source outlet.")) return;
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-text-3" />
      </div>
    );
  }

  const days = (n: number | null) => (n == null ? "" : n === 0 ? "today" : n === 1 ? "1 day" : `${n} days`);
  const inTransitDays = (t: Transfer) => Math.floor((now - Date.parse(t.approvedAt ?? t.createdAt)) / 86_400_000);

  return (
    <div className="px-4 pt-6 pb-10 md:px-8">
      {selected ? (
        // ── Detail: a full page, not a modal ──
        <div className="max-w-[960px]">
          <button onClick={() => setSelected(null)} className="inline-flex items-center gap-1.5 text-sm text-text-2 hover:text-text">
            <ArrowLeft className="h-4 w-4" /> All transfers
          </button>
          <h1 className="mt-3 flex flex-wrap items-center gap-2 text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">
            {selected.fromOutlet} <ArrowRight className="h-5 w-5 text-text-3" /> {selected.toOutlet}
          </h1>
          <p className="mt-0.5 text-sm text-text-2">
            {formatDate(selected.createdAt)} at {formatTime(selected.createdAt)} · by {selected.transferredBy} · {selected.items.length} {selected.items.length === 1 ? "item" : "items"}
          </p>

          <div className={`mt-5 rounded-card px-4 py-3 ${STATUS_STYLES[selected.status] ?? "bg-sunken text-text-2"}`}>
            <p className="text-sm font-semibold">{STATUS_LABELS[selected.status] ?? selected.status}</p>
            <p className="text-[13px] opacity-90">
              {selected.status === "CANCELLED" && selected.rejectionReason ? `Rejected: ${selected.rejectionReason}` : NEXT_STEP[selected.status] ?? ""}
            </p>
          </div>

          {(selected.approvedBy || selected.receivedBy || selected.completedAt || selected.notes) && (
            <ul className="mt-4 space-y-1 text-[13px] text-text-2">
              {selected.notes && <li>Note: {selected.notes}</li>}
              {selected.approvedBy && selected.approvedAt && <li>Approved by {selected.approvedBy}, {formatDate(selected.approvedAt)} at {formatTime(selected.approvedAt)}</li>}
              {selected.receivedBy && selected.receivedAt && <li>Received by {selected.receivedBy}, {formatDate(selected.receivedAt)} at {formatTime(selected.receivedAt)}</li>}
              {selected.completedAt && <li>Completed {formatDate(selected.completedAt)} at {formatTime(selected.completedAt)}</li>}
            </ul>
          )}

          <div className="mt-5 overflow-hidden rounded-card border border-line bg-surface">
            <p className="border-b border-line px-4 py-3 text-sm font-semibold text-text">Items</p>
            {selected.items.map((item) => (
              <div key={item.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text">{item.product}</p>
                  <p className="mt-0.5 truncate text-[12px] text-text-3">{item.package || "No package"} · {item.sku}</p>
                </div>
                <p className="shrink-0 font-mono text-sm font-semibold text-text">{item.quantity}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {selected.status === "DRAFT" && (
              <Button onClick={() => updateTransferStatus(selected.id, "PENDING_APPROVAL")} disabled={actionLoading} className="bg-ink text-on-ink hover:bg-ink-hover">
                {actionLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}Submit for approval
              </Button>
            )}
            {selected.status === "PENDING_APPROVAL" && (
              <>
                <Button variant="outline" onClick={() => openRejectDialog(selected.id)} disabled={actionLoading} className="text-danger-text">
                  <Ban className="mr-1.5 h-4 w-4" />Reject
                </Button>
                <Button onClick={() => updateTransferStatus(selected.id, "APPROVED")} disabled={actionLoading} className="bg-ink text-on-ink hover:bg-ink-hover">
                  {actionLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1.5 h-4 w-4" />}Approve
                </Button>
              </>
            )}
            {selected.status === "APPROVED" && (
              <Button onClick={() => updateTransferStatus(selected.id, "IN_TRANSIT")} disabled={actionLoading} className="bg-ink text-on-ink hover:bg-ink-hover">
                {actionLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Truck className="mr-1.5 h-4 w-4" />}Mark in transit
              </Button>
            )}
            {selected.status === "IN_TRANSIT" && (
              <Button onClick={() => updateTransferStatus(selected.id, "RECEIVED")} disabled={actionLoading} className="bg-ink text-on-ink hover:bg-ink-hover">
                {actionLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-1.5 h-4 w-4" />}Confirm received
              </Button>
            )}
            {selected.status === "PENDING" && (
              <>
                <Button variant="outline" onClick={() => { if (confirm("Cancel this transfer?")) updateTransferStatus(selected.id, "CANCELLED"); }} disabled={actionLoading} className="text-danger-text">
                  <Ban className="mr-1.5 h-4 w-4" />Cancel transfer
                </Button>
                <Button onClick={() => updateTransferStatus(selected.id, "COMPLETED")} disabled={actionLoading} className="bg-ink text-on-ink hover:bg-ink-hover">
                  {actionLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}Mark as completed
                </Button>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Transfers</h1>
              <p className="mt-0.5 text-sm text-text-2">Stock moving between outlets: what is stuck, and for how long.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={loadSmartTransfers} variant="outline">
                <Sparkles className="mr-1.5 h-4 w-4" />Smart transfer
              </Button>
              <Button onClick={openCreate} className="bg-ink text-on-ink hover:bg-ink-hover">
                <Plus className="mr-1.5 h-4 w-4" />New transfer
              </Button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KeyNumber label="Waiting for approval" value={String(summary.approval.count)} tone={summary.approval.count > 0 ? "warn" : undefined}
              note={summary.approval.count > 0 ? <>oldest <b className="font-semibold text-text-2">{days(summary.approval.oldestDays)}</b></> : "nothing waiting"} />
            <KeyNumber label="In transit" value={String(summary.transit.count)} tone={summary.transit.late > 0 ? "warn" : undefined}
              note={summary.transit.count === 0 ? "nothing on the road" : summary.transit.late > 0
                ? <><b className="font-semibold text-text-2">{summary.transit.late}</b> over {LATE_DAYS} days, oldest {days(summary.transit.oldestDays)}</>
                : <>oldest <b className="font-semibold text-text-2">{days(summary.transit.oldestDays)}</b></>} />
            <KeyNumber label="Received, 30 days" value={String(summary.moved.count)}
              note={<><b className="font-semibold text-text-2">{summary.moved.lines}</b> item lines moved</>} />
            <KeyNumber label="Cancelled, 30 days" value={String(summary.cancelled.count)}
              note={<>of <b className="font-semibold text-text-2">{summary.cancelled.of}</b> created</>} />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:max-w-sm sm:flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
              <Input placeholder="Search outlet or staff..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[{ key: "all", label: "All", match: () => true }, ...FILTERS].map((f) => (
                <button key={f.key} onClick={() => setStatusFilter(f.key)} className={`rounded-full border px-3 py-1 text-xs transition-colors ${statusFilter === f.key ? "border-text bg-raised font-semibold text-text" : "border-line text-text-2"}`}>
                  {f.label} ({data.filter((t) => f.match(t.status)).length})
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface">
            {filtered.length === 0 && (
              <p className="px-4 py-12 text-center text-sm text-text-3">
                {data.length === 0 ? "No transfers yet. Use New transfer to move stock between outlets." : "No transfers match your filter."}
              </p>
            )}
            {filtered.map((t) => {
              const late = (t.status === "IN_TRANSIT" || t.status === "APPROVED") && inTransitDays(t) > LATE_DAYS;
              return (
                <button key={t.id} onClick={() => { setSelected(t); window.scrollTo(0, 0); }}
                  className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-sunken/50">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium text-text">
                      {t.fromOutlet} <ArrowRight className="h-3.5 w-3.5 shrink-0 text-text-3" /> {t.toOutlet}
                    </p>
                    <p className="mt-0.5 truncate text-[12px] text-text-3">
                      {formatDate(t.createdAt)} · {formatTime(t.createdAt)} · by {t.transferredBy} · {t.items.length} {t.items.length === 1 ? "item" : "items"}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] ${late ? "bg-warn-soft text-warn-text" : STATUS_STYLES[t.status] ?? "bg-sunken text-text-2"}`}>
                    {late ? `In transit ${days(inTransitDays(t))}` : STATUS_LABELS[t.status] ?? t.status}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Reject Dialog */}
      {/* Smart Transfer Dialog */}
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-blue-500" />
              Smart Transfer Recommendations
            </DialogTitle>
          </DialogHeader>
          {aiLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
              <span className="ml-2 text-sm text-text-2">Analyzing stock levels across outlets...</span>
            </div>
          ) : aiTransfers.length === 0 ? (
            <div className="py-12 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-green-400" />
              <p className="mt-2 text-sm text-text-2">All outlets are balanced. No transfers needed.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-text-2">{aiTransfers.length} transfer{aiTransfers.length !== 1 ? "s" : ""} recommended based on stock imbalances</p>
              {aiTransfers.map((t, idx) => (
                <div key={idx} className="rounded-lg border border-blue-100 bg-blue-50/30 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-text">
                      <span>{t.fromOutletName}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-blue-500" />
                      <span>{t.toOutletName}</span>
                    </div>
                    <button
                      onClick={() => createSingleSmartTransfer(t)}
                      disabled={aiCreating}
                      className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {aiCreating ? <Loader2 className="h-3 w-3 animate-spin" /> : "Create Draft"}
                    </button>
                  </div>
                  <p className="text-xs text-blue-600 mb-2">{t.reason}</p>
                  <div className="space-y-1">
                    {t.items.map((item, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-text-2">{item.productName} <span className="text-text-3">({item.productSku})</span></span>
                        <span className="font-medium text-text">{item.quantity} {item.packageName}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {aiTransfers.length > 0 && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setAiOpen(false)}>Close</Button>
              <Button onClick={createAllSmartTransfers} disabled={aiCreating} className="bg-blue-600 hover:bg-blue-700">
                {aiCreating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Zap className="mr-1.5 h-4 w-4" />}
                Create All ({aiTransfers.length}) Drafts
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject Transfer</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-2">Please provide a reason for rejecting this transfer.</p>
          <textarea
            className="mt-2 w-full rounded-md border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none"
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
              <ArrowLeftRight className="h-5 w-5 text-brand-text" />
              New Transfer
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Outlet selectors */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-text-2">From Outlet</label>
                <select
                  className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
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
                <label className="text-xs font-medium text-text-2">To Outlet</label>
                <select
                  className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
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
              <label className="text-xs font-medium text-text-2">Add Products</label>
              {!fromOutletId && <p className="mt-1 text-xs text-amber-600">Select source outlet first</p>}
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
                <Input
                  placeholder={fromOutletId ? "Search product..." : "Select source outlet first..."}
                  className="pl-9"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  disabled={!fromOutletId}
                />
              </div>
              {productSearch && (
                <div className="mt-1 max-h-40 overflow-y-auto rounded-md border bg-surface shadow-sm">
                  {filteredProducts.length === 0 && (
                    <p className="px-3 py-2 text-xs text-text-3">No products found</p>
                  )}
                  {filteredProducts.slice(0, 8).map((p) => {
                    const pkg = p.packages.find((pk) => pk.isDefault) || p.packages[0];
                    const conv = pkg?.conversionFactor || 1;
                    const baseStock = stockBalances[p.id] ?? 0;
                    const pkgStock = Math.floor(baseStock / conv);
                    return (
                      <button
                        key={p.id}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-sunken"
                        onClick={() => addToCart(p)}
                      >
                        <span className="text-text">{p.name}</span>
                        <span className="text-xs text-text-3">{pkgStock} {pkg?.label || p.baseUom} · {p.sku}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Cart items */}
            {cart.length > 0 && (
              <div className="rounded-lg border overflow-hidden overflow-x-auto">
                <table className="w-full text-xs min-w-[720px]">
                  <thead>
                    <tr className="bg-sunken border-b">
                      <th className="px-3 py-2 text-left font-medium text-text-2">Product</th>
                      <th className="px-3 py-2 text-left font-medium text-text-2">Pkg</th>
                      <th className="px-3 py-2 text-right font-medium text-text-2">From</th>
                      <th className="px-3 py-2 text-right font-medium text-text-2 w-20">Qty</th>
                      <th className="px-3 py-2 text-right font-medium text-text-2">To</th>
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
                      <tr key={item.productId} className={`border-b border-line ${item.quantity > item.availableStock ? "bg-red-50" : ""}`}>
                        <td className="px-3 py-2">
                          <p className="font-medium text-text">{item.name}</p>
                          <p className="text-[10px] text-text-3">{item.sku}</p>
                        </td>
                        <td className="px-3 py-2 text-text-2">{item.uom}</td>
                        <td className="px-3 py-2 text-right">
                          <span className={item.availableStock <= 0 ? "text-red-600 font-medium" : "text-text-2"}>{item.availableStock}</span>
                          <span className="text-text-3 mx-0.5">&rarr;</span>
                          <span className={fromAfter <= 0 ? "text-red-600 font-medium" : "text-text-2 font-medium"}>{fromAfter}</span>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="1"
                            max={item.availableStock}
                            className="w-full rounded border border-line px-2 py-1 text-right text-xs focus:border-ink focus:outline-none"
                            value={item.quantity}
                            onChange={(e) => updateCartQty(idx, parseInt(e.target.value) || 0)}
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className="text-text-2">{toCurrent}</span>
                          <span className="text-text-3 mx-0.5">&rarr;</span>
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
              <label className="text-xs font-medium text-text-2">Notes (optional)</label>
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
              className="bg-ink hover:bg-ink-hover"
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
