"use client";

import { useState, useEffect, useRef, useMemo, Fragment, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useFetch } from "@/lib/use-fetch";
import { Card } from "@/components/ui/card";
import { compressImage } from "@/lib/compress-image";
import {
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ShoppingCart,
  MessageCircle,
  Truck,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Package,
  AlertTriangle,
  Plus,
  Send,
  Ban,
  ThumbsUp,
  Trash2,
  Camera,
  Pencil,
  X,
  Calendar,
} from "lucide-react";

type PaginatedResponse<T> = { items: T[]; total: number; page: number; limit: number };
const PAGE_SIZE = 50;

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// ── Types ─────────────────────────────────────────────────────────────────

type OrderItem = {
  id: string;
  productId: string;
  product: string;
  sku: string;
  uom: string;
  package: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  notes: string | null;
};

type Order = {
  id: string;
  orderNumber: string;
  outlet: string;
  outletCode: string;
  supplierId: string;
  supplier: string;
  supplierPhone: string;
  status: string;
  totalAmount: number;
  notes: string | null;
  deliveryDate: string | null;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  items: OrderItem[];
  receivingCount: number;
};

// ── Constants ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  DRAFT: { label: "Draft", color: "bg-gray-400", icon: FileText },
  PENDING_APPROVAL: { label: "Pending Approval", color: "bg-amber-500", icon: Clock },
  APPROVED: { label: "Approved", color: "bg-blue-500", icon: CheckCircle2 },
  SENT: { label: "Sent to Supplier", color: "bg-green-500", icon: MessageCircle },
  CONFIRMED: { label: "Confirmed", color: "bg-indigo-500", icon: CheckCircle2 },
  AWAITING_DELIVERY: { label: "Awaiting Delivery", color: "bg-purple-500", icon: Truck },
  PARTIALLY_RECEIVED: { label: "Partially Received", color: "bg-amber-600", icon: AlertTriangle },
  COMPLETED: { label: "Completed", color: "bg-gray-500", icon: CheckCircle2 },
  CANCELLED: { label: "Cancelled", color: "bg-red-500", icon: AlertTriangle },
};

const NEXT_ACTIONS: Record<string, { status: string; label: string; icon: typeof Clock; color: string }[]> = {
  DRAFT: [
    { status: "PENDING_APPROVAL", label: "Submit for Approval", icon: Send, color: "bg-amber-500 hover:bg-amber-600" },
    { status: "CANCELLED", label: "Cancel", icon: Ban, color: "bg-red-500 hover:bg-red-600" },
  ],
  PENDING_APPROVAL: [
    { status: "APPROVED", label: "Approve", icon: ThumbsUp, color: "bg-blue-500 hover:bg-blue-600" },
    { status: "CANCELLED", label: "Reject", icon: Ban, color: "bg-red-500 hover:bg-red-600" },
  ],
  APPROVED: [
    { status: "SENT", label: "Mark as Sent", icon: Send, color: "bg-green-500 hover:bg-green-600" },
  ],
  // SENT: actions handled inline (edit + confirm) — no quick-action buttons
  SENT: [],
  CONFIRMED: [
    { status: "AWAITING_DELIVERY", label: "Awaiting Delivery", icon: Truck, color: "bg-purple-500 hover:bg-purple-600" },
  ],
  AWAITING_DELIVERY: [],
  PARTIALLY_RECEIVED: [],
  COMPLETED: [],
  CANCELLED: [],
};

// ── Component ─────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search, 300);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // ── SENT order editing state ────────────────────────────────────────────
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editItems, setEditItems] = useState<{ productId: string; product: string; sku: string; uom: string; quantity: number; unitPrice: number; notes: string | null }[]>([]);
  const [editDeliveryDate, setEditDeliveryDate] = useState("");
  const [editInvoiceDueDate, setEditInvoiceDueDate] = useState("");
  const [editInvoicePhotos, setEditInvoicePhotos] = useState<string[]>([]);
  const [compressing, setCompressing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startEditing = (order: Order) => {
    setEditingOrderId(order.id);
    setEditItems(order.items.map((i) => ({
      productId: i.productId,
      product: i.product,
      sku: i.sku,
      uom: i.uom || i.package,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      notes: i.notes,
    })));
    setEditDeliveryDate(order.deliveryDate ?? "");
    setEditInvoiceDueDate("");
    setEditInvoicePhotos([]);
    setExpandedId(order.id);
  };

  const cancelEditing = () => {
    setEditingOrderId(null);
    setEditItems([]);
  };

  const handleInvoicePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setCompressing(true);
    try {
      const compressed = await Promise.all(Array.from(files).map((f) => compressImage(f)));
      setEditInvoicePhotos((prev) => [...prev, ...compressed]);
    } finally {
      setCompressing(false);
      e.target.value = "";
    }
  };

  const saveOrderEdits = async (orderId: string) => {
    setSavingEdit(true);
    try {
      const payload: Record<string, unknown> = {};
      if (editItems.length > 0) {
        payload.items = editItems.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          notes: i.notes,
        }));
      }
      if (editDeliveryDate) payload.deliveryDate = editDeliveryDate;
      if (editInvoiceDueDate) payload.invoiceDueDate = editInvoiceDueDate;
      if (editInvoicePhotos.length > 0) payload.invoicePhotos = editInvoicePhotos;

      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { alert("Failed to save changes"); return; }
      setEditingOrderId(null);
      loadOrders();
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmOrder = async (orderId: string) => {
    // Save edits first, then confirm
    setSavingEdit(true);
    try {
      const payload: Record<string, unknown> = { status: "AWAITING_DELIVERY" };
      if (editItems.length > 0) {
        payload.items = editItems.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          notes: i.notes,
        }));
      }
      if (editDeliveryDate) payload.deliveryDate = editDeliveryDate;
      if (editInvoiceDueDate) payload.invoiceDueDate = editInvoiceDueDate;
      if (editInvoicePhotos.length > 0) payload.invoicePhotos = editInvoicePhotos;

      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { alert("Failed to confirm order"); return; }
      setEditingOrderId(null);
      loadOrders();
    } finally {
      setSavingEdit(false);
    }
  };

  const apiUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (statusFilter) params.set("status", statusFilter);
    params.set("page", String(page));
    params.set("limit", String(PAGE_SIZE));
    return `/api/orders?${params}`;
  }, [debouncedSearch, statusFilter, page]);

  const { data, isLoading: loading, mutate: loadOrders } = useFetch<PaginatedResponse<Order>>(apiUrl);
  const orders = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Reset to page 1 when search/filter changes
  const prevSearch = useRef(debouncedSearch);
  const prevStatus = useRef(statusFilter);
  useEffect(() => {
    if (prevSearch.current !== debouncedSearch || prevStatus.current !== statusFilter) {
      setPage(1);
      prevSearch.current = debouncedSearch;
      prevStatus.current = statusFilter;
    }
  }, [debouncedSearch, statusFilter]);

  // ── Status update ───────────────────────────────────────────────────────

  const deleteOrder = async (orderId: string) => {
    if (!confirm("Delete this order permanently?")) return;
    setUpdatingId(orderId);
    try {
      const res = await fetch(`/api/orders/${orderId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to delete order");
        return;
      }
      loadOrders();
    } finally {
      setUpdatingId(null);
    }
  };

  const updateStatus = async (orderId: string, newStatus: string) => {
    setUpdatingId(orderId);
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) { alert("Failed to update order status"); return; }
      loadOrders();
    } finally {
      setUpdatingId(null);
    }
  };

  const buildWhatsAppUrl = (order: Order) => {
    const items = order.items.map((i) => `• ${i.product} (${i.uom || i.package}) × ${i.quantity}`).join("\n");
    const msg = `Hi, this is Celsius Coffee.\n\nPO: ${order.orderNumber}\nOutlet: ${order.outlet}\n${order.deliveryDate ? `Delivery: ${order.deliveryDate}\n` : ""}\nOrder:\n${items}\n\nTotal: RM ${order.totalAmount.toFixed(2)}\n\n${order.notes ? `Notes: ${order.notes}\n\n` : ""}Thank you!`;
    const phone = order.supplierPhone.replace(/[^0-9]/g, "");
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  };

  // ── Filters ─────────────────────────────────────────────────────────────

  const statuses = ["", ...Object.keys(STATUS_CONFIG)];
  const totalValue = useMemo(() => orders.reduce((a, o) => a + o.totalAmount, 0), [orders]);
  const pendingCount = useMemo(() => orders.filter((o) => ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "AWAITING_DELIVERY"].includes(o.status)).length, [orders]);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Purchase Orders</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            {total} orders &middot; {pendingCount} active
          </p>
        </div>
        <Link href="/admin/orders/create">
          <Button className="bg-terracotta hover:bg-terracotta-dark">
            <Plus className="mr-1.5 h-4 w-4" />Create Order
          </Button>
        </Link>
      </div>

      {/* Summary cards */}
      <div className="mt-4 grid grid-cols-4 gap-4">
        <Card className="px-4 py-3">
          <p className="text-xs text-gray-500">Total Orders</p>
          <p className="text-xl font-bold text-gray-900">{total}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-gray-500">Active / In Progress</p>
          <p className="text-xl font-bold text-terracotta">{pendingCount}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-gray-500">Completed</p>
          <p className="text-xl font-bold text-green-600">{orders.filter((o) => o.status === "COMPLETED").length}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-gray-500">Total Value</p>
          <p className="text-xl font-bold text-gray-900">RM {totalValue.toFixed(2)}</p>
        </Card>
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Search by PO#, supplier, or outlet..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {statuses.map((s) => {
            const config = STATUS_CONFIG[s];
            return (
              <button
                key={s || "all"}
                onClick={() => setStatusFilter(s)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${statusFilter === s ? "border-terracotta bg-terracotta/5 text-terracotta-dark" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}
              >
                {s === "" ? "All" : config?.label ?? s}
              </button>
            );
          })}
        </div>
      </div>

      {/* Orders table */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="w-8 px-3 py-3"></th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">PO Number</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Outlet</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Supplier</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Amount</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Items</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Delivery</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {!loading && orders.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center">
                  <ShoppingCart className="mx-auto h-8 w-8 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">
                    {total === 0 && !debouncedSearch && !statusFilter ? "No orders yet. Click 'Create Order' to get started." : "No orders match your filter."}
                  </p>
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-terracotta" />
                </td>
              </tr>
            )}
            {orders.map((order) => {
              const config = STATUS_CONFIG[order.status] ?? { label: order.status, color: "bg-gray-400", icon: Clock };
              const actions = NEXT_ACTIONS[order.status] ?? [];
              return (
                <Fragment key={order.id}>
                  <tr className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer" onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}>
                    <td className="px-3 py-3">
                      <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${expandedId === order.id ? "rotate-180" : ""}`} />
                    </td>
                    <td className="px-4 py-3">
                      <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-terracotta">{order.orderNumber}</code>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{order.outlet}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{order.supplier}</span>
                        {order.supplierPhone && ["APPROVED", "SENT", "AWAITING_DELIVERY"].includes(order.status) && (
                          <a href={buildWhatsAppUrl(order)} target="_blank" onClick={(e) => e.stopPropagation()} className="text-green-600 hover:text-green-700" title="Send via WhatsApp">
                            <MessageCircle className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3"><Badge className={`text-[10px] ${config.color}`}>{config.label}</Badge></td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">RM {order.totalAmount.toFixed(2)}</td>
                    <td className="px-4 py-3 text-gray-600">
                      <span className="flex items-center gap-1 text-xs"><Package className="h-3 w-3" />{order.items.length}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{order.deliveryDate ?? "—"}</td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        {actions.map((a) => (
                          <button key={a.status} onClick={() => updateStatus(order.id, a.status)} disabled={updatingId === order.id} className={`rounded-md px-2 py-1 text-[10px] font-medium text-white ${a.color} disabled:opacity-50`} title={a.label}>
                            {updatingId === order.id ? <Loader2 className="h-3 w-3 animate-spin" /> : a.label}
                          </button>
                        ))}
                        {["DRAFT", "CANCELLED"].includes(order.status) && (
                          <button onClick={() => deleteOrder(order.id)} disabled={updatingId === order.id} className="rounded-md px-2 py-1 text-[10px] font-medium text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50" title="Delete">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedId === order.id && (
                    <tr>
                      <td colSpan={9} className="bg-gray-50 px-8 py-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-semibold text-gray-500 uppercase">Order Items</p>
                          <div className="flex items-center gap-2 text-xs text-gray-400">
                            <span>Created by: {order.createdBy}</span>
                            {order.approvedBy && <span>&middot; Approved by: {order.approvedBy}</span>}
                            {order.sentAt && <span>&middot; Sent: {new Date(order.sentAt).toLocaleDateString("en-MY")}</span>}
                            {order.status === "SENT" && editingOrderId !== order.id && (
                              <button onClick={() => startEditing(order)} className="ml-2 flex items-center gap-1 rounded-md bg-terracotta/10 px-2 py-1 text-[10px] font-medium text-terracotta hover:bg-terracotta/20">
                                <Pencil className="h-3 w-3" />Adjust Order
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Editable items table for SENT orders */}
                        {editingOrderId === order.id ? (
                          <>
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-gray-400">
                                  <th className="pb-1 text-left font-medium">Product</th>
                                  <th className="pb-1 text-left font-medium">SKU</th>
                                  <th className="pb-1 text-left font-medium">Package</th>
                                  <th className="pb-1 text-right font-medium">Qty</th>
                                  <th className="pb-1 text-right font-medium">Unit Price</th>
                                  <th className="pb-1 text-right font-medium">Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {editItems.map((item, idx) => (
                                  <tr key={item.productId} className="border-t border-gray-200/50">
                                    <td className="py-1.5 text-gray-700">{item.product}</td>
                                    <td className="py-1.5"><code className="text-gray-500">{item.sku}</code></td>
                                    <td className="py-1.5 text-gray-500">{item.uom}</td>
                                    <td className="py-1.5 text-right">
                                      <input
                                        type="number"
                                        min="0"
                                        step="any"
                                        value={item.quantity}
                                        onChange={(e) => {
                                          const val = parseFloat(e.target.value) || 0;
                                          setEditItems((prev) => prev.map((it, i) => i === idx ? { ...it, quantity: val } : it));
                                        }}
                                        className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-right text-xs"
                                      />
                                    </td>
                                    <td className="py-1.5 text-right">
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={item.unitPrice}
                                        onChange={(e) => {
                                          const val = parseFloat(e.target.value) || 0;
                                          setEditItems((prev) => prev.map((it, i) => i === idx ? { ...it, unitPrice: val } : it));
                                        }}
                                        className="w-20 rounded border border-gray-300 px-1.5 py-0.5 text-right text-xs"
                                      />
                                    </td>
                                    <td className="py-1.5 text-right text-gray-900 font-medium">RM {(item.quantity * item.unitPrice).toFixed(2)}</td>
                                  </tr>
                                ))}
                                <tr className="border-t border-gray-300">
                                  <td colSpan={5} className="py-1.5 font-semibold text-gray-700">Total</td>
                                  <td className="py-1.5 text-right font-semibold text-gray-900">
                                    RM {editItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0).toFixed(2)}
                                  </td>
                                </tr>
                              </tbody>
                            </table>

                            {/* Delivery date + Invoice due date */}
                            <div className="mt-3 flex flex-wrap gap-4">
                              <div>
                                <label className="text-[10px] font-medium text-gray-500 uppercase">Delivery Date</label>
                                <input
                                  type="date"
                                  value={editDeliveryDate}
                                  onChange={(e) => setEditDeliveryDate(e.target.value)}
                                  className="mt-0.5 block w-40 rounded border border-gray-300 px-2 py-1 text-xs"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-medium text-gray-500 uppercase">Invoice Due Date</label>
                                <input
                                  type="date"
                                  value={editInvoiceDueDate}
                                  onChange={(e) => setEditInvoiceDueDate(e.target.value)}
                                  className="mt-0.5 block w-40 rounded border border-gray-300 px-2 py-1 text-xs"
                                />
                              </div>
                            </div>

                            {/* Invoice photo upload */}
                            <div className="mt-3">
                              <label className="text-[10px] font-medium text-gray-500 uppercase">Invoice Photo</label>
                              <div className="mt-1 flex flex-wrap gap-2">
                                {editInvoicePhotos.map((photo, i) => (
                                  <div key={i} className="relative h-16 w-16 overflow-hidden rounded-lg border">
                                    <img src={photo} alt={`Invoice ${i + 1}`} className="h-full w-full object-cover" />
                                    <button
                                      onClick={() => setEditInvoicePhotos((prev) => prev.filter((_, j) => j !== i))}
                                      className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white"
                                    >
                                      <X className="h-2.5 w-2.5" />
                                    </button>
                                  </div>
                                ))}
                                {compressing ? (
                                  <div className="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-dashed border-terracotta/30 text-terracotta">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-gray-300 text-gray-400 hover:border-terracotta hover:text-terracotta"
                                  >
                                    <Camera className="h-4 w-4" />
                                    <span className="text-[8px]">Upload</span>
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Action buttons */}
                            <div className="mt-3 flex items-center gap-2">
                              <button
                                onClick={() => saveOrderEdits(order.id)}
                                disabled={savingEdit}
                                className="rounded-md bg-gray-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                              >
                                {savingEdit ? <Loader2 className="inline mr-1 h-3 w-3 animate-spin" /> : null}
                                Save Changes
                              </button>
                              <button
                                onClick={() => confirmOrder(order.id)}
                                disabled={savingEdit}
                                className="rounded-md bg-terracotta px-3 py-1.5 text-xs font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
                              >
                                {savingEdit ? <Loader2 className="inline mr-1 h-3 w-3 animate-spin" /> : <CheckCircle2 className="inline mr-1 h-3 w-3" />}
                                Confirm Order
                              </button>
                              <button
                                onClick={cancelEditing}
                                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100"
                              >
                                Cancel
                              </button>
                            </div>
                          </>
                        ) : (
                          /* Read-only items table */
                          <>
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-gray-400">
                                  <th className="pb-1 text-left font-medium">Product</th>
                                  <th className="pb-1 text-left font-medium">SKU</th>
                                  <th className="pb-1 text-left font-medium">Package</th>
                                  <th className="pb-1 text-right font-medium">Qty</th>
                                  <th className="pb-1 text-right font-medium">Unit Price</th>
                                  <th className="pb-1 text-right font-medium">Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {order.items.map((item) => (
                                  <tr key={item.id} className="border-t border-gray-200/50">
                                    <td className="py-1.5 text-gray-700">{item.product}</td>
                                    <td className="py-1.5"><code className="text-gray-500">{item.sku}</code></td>
                                    <td className="py-1.5 text-gray-500">{item.uom || item.package}</td>
                                    <td className="py-1.5 text-right text-gray-700">{item.quantity}</td>
                                    <td className="py-1.5 text-right text-gray-600">RM {item.unitPrice.toFixed(2)}</td>
                                    <td className="py-1.5 text-right text-gray-900 font-medium">RM {item.totalPrice.toFixed(2)}</td>
                                  </tr>
                                ))}
                                <tr className="border-t border-gray-300">
                                  <td colSpan={5} className="py-1.5 font-semibold text-gray-700">Total</td>
                                  <td className="py-1.5 text-right font-semibold text-gray-900">RM {order.totalAmount.toFixed(2)}</td>
                                </tr>
                              </tbody>
                            </table>
                            {order.notes && <p className="mt-2 text-xs text-gray-500">Notes: {order.notes}</p>}
                            {order.receivingCount > 0 && <p className="mt-2 text-xs text-green-600">{order.receivingCount} receiving record(s) linked</p>}
                          </>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm">
          <p className="text-gray-500">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </p>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-md border px-2 py-1 text-gray-500 hover:bg-gray-50 disabled:opacity-30">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-3 text-gray-700">Page {page} of {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="rounded-md border px-2 py-1 text-gray-500 hover:bg-gray-50 disabled:opacity-30">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Hidden file input for invoice photo upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleInvoicePhoto}
      />
    </div>
  );
}
