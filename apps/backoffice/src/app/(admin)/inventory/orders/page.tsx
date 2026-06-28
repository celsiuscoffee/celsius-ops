"use client";

import { formatRM } from "@celsius/shared";

import { useState, useEffect, Fragment } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useFetch } from "@/lib/use-fetch";
import { Card } from "@/components/ui/card";
import { EditOrderModal } from "@/components/inventory/EditOrderModal";
import {
  Search,
  ChevronDown,
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
  Trash2,
  Pencil,
  Receipt,
  CalendarDays,
  X,
  Filter,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────

type OrderItem = {
  id: string;
  product: string;
  sku: string;
  uom: string;
  package: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  notes: string | null;
};

type OrderInvoice = {
  id: string;
  invoiceNumber: string;
  amount: number;
  status: string;
  issueDate: string;
  dueDate: string | null;
  photoCount: number;
  photos: string[];
  depositPercent: number | null;
  depositTermsDays: number | null;
  depositAmount: number | null;
  depositPaidAt: string | null;
  deliveryDate: string | null;
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
  photos: string[];
  deliveryDate: string | null;
  deliveryCharge: number;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  items: OrderItem[];
  receivingCount: number;
  invoice: OrderInvoice | null;
  supplierDepositPercent: number | null;
  supplierDepositTermsDays: number | null;
};

// ── Constants ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  DRAFT: { label: "Draft", color: "bg-gray-400", icon: FileText },
  PENDING_APPROVAL: { label: "Pending Approval", color: "bg-amber-500", icon: Clock },
  APPROVED: { label: "Confirmed", color: "bg-blue-500", icon: CheckCircle2 },
  SENT: { label: "Sent", color: "bg-green-500", icon: MessageCircle },
  AWAITING_DELIVERY: { label: "Awaiting Delivery", color: "bg-purple-500", icon: Truck },
  PARTIALLY_RECEIVED: { label: "Partially Received", color: "bg-amber-600", icon: AlertTriangle },
  COMPLETED: { label: "Completed", color: "bg-gray-500", icon: CheckCircle2 },
  CANCELLED: { label: "Cancelled", color: "bg-red-500", icon: AlertTriangle },
};

const NEXT_ACTIONS: Record<string, { status: string; label: string; icon: typeof Clock; color: string }[]> = {
  DRAFT: [],
  PENDING_APPROVAL: [],
  APPROVED: [],
  SENT: [],
  AWAITING_DELIVERY: [],
  PARTIALLY_RECEIVED: [],
  COMPLETED: [],
  CANCELLED: [],
};

// ── Component ─────────────────────────────────────────────────────────────

export default function OrdersPage() {
  // Table state
  const [tab, setTab] = useState("active");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 500);
    return () => clearTimeout(t);
  }, [search]);
  // Deep-link from the Purchase Orders workspace: ?search=<supplier> pre-fills the search so the
  // rail's "Open POs" card lands on this supplier's POs. window.location avoids a Suspense boundary.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("search");
    if (q) {
      setSearch(q);
      setDebouncedSearch(q);
    }
  }, []);
  // Created-date range filter — mirrors the invoices page pattern.
  const [showFilters, setShowFilters] = useState(false);
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const activeOrderFilterCount = [createdFrom, createdTo].filter(Boolean).length;
  const url = (() => {
    const params = new URLSearchParams({ tab });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (createdFrom) params.set("createdFrom", createdFrom);
    if (createdTo) params.set("createdTo", createdTo);
    return `/api/inventory/orders?${params.toString()}`;
  })();
  type OrdersResponse = { orders: Order[]; summary: { total: number; draft: number; active: number; completed: number; totalValue: number } };
  const { data, isLoading: loading, mutate: loadOrders } = useFetch<OrdersResponse>(url);
  const orders: Order[] = data?.orders ?? [];
  const summary = data?.summary ?? { total: 0, draft: 0, active: 0, completed: 0, totalValue: 0 };
  const [cardFilter, setCardFilter] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Edit dialog state — modal logic lives in EditOrderModal now.
  // We keep just the trigger here: which order is being edited (null =
  // closed) and whether the modal opens in confirm/upload-invoice mode.
  const [editOrder, setEditOrder] = useState<Order | null>(null);
  const [editConfirmMode, setEditConfirmMode] = useState(false);
  const openEditDialog = (order: Order, confirmMode = false) => {
    setEditConfirmMode(confirmMode);
    setEditOrder(order);
  };

  // ── Status update ───────────────────────────────────────────────────────

  const deleteOrder = async (orderId: string) => {
    if (!confirm("Delete this order permanently?")) return;
    setUpdatingId(orderId);
    try {
      const res = await fetch(`/api/inventory/orders/${orderId}`, { method: "DELETE" });
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
      const res = await fetch(`/api/inventory/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        alert(body.error || "Failed to update order status");
        return;
      }
      loadOrders();
    } finally {
      setUpdatingId(null);
    }
  };

  const buildWhatsAppUrl = (order: Order) => {
    const items = order.items.map((i) => `• ${i.product} (${i.uom || i.package}) × ${i.quantity}`).join("\n");
    const msg = `Hi, this is Celsius Coffee.\n\nPO: ${order.orderNumber}\nOutlet: ${order.outlet}\n${order.deliveryDate ? `Delivery: ${order.deliveryDate}\n` : ""}\nOrder:\n${items}\n\nTotal: ${formatRM(order.totalAmount)}\n\n${order.notes ? `Notes: ${order.notes}\n\n` : ""}Thank you!`;
    const phone = order.supplierPhone.replace(/[^0-9]/g, "");
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  };

  // ── Computed from API-filtered results ───────────────────────────────────

  const totalValue = orders.reduce((a, o) => a + o.totalAmount, 0);
  const pendingCount = orders.filter((o) => ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "AWAITING_DELIVERY"].includes(o.status)).length;

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-gray-900">PO Lists</h2>
          <p className="mt-0.5 text-xs sm:text-sm text-gray-500">
            {summary.total} {summary.total === 1 ? 'order' : 'orders'} &middot; {summary.active} active
          </p>
        </div>
        <Link href="/inventory/orders/create" className="sm:w-auto">
          <Button className="bg-terracotta hover:bg-terracotta-dark w-full sm:w-auto">
            <Plus className="mr-1.5 h-4 w-4" />Create Order
          </Button>
        </Link>
      </div>

      {/* Summary cards */}
      <div className="mt-4 grid grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-4">
        <Card className={`px-4 py-3 cursor-pointer transition-colors ${cardFilter === null ? "ring-2 ring-terracotta" : "hover:bg-gray-50"}`} onClick={() => setCardFilter(null)}>
          <p className="text-xs text-gray-500">Total Orders</p>
          <p className="text-xl font-bold text-gray-900">{summary.total}</p>
        </Card>
        <Card className={`px-4 py-3 cursor-pointer transition-colors ${cardFilter === "DRAFT" ? "ring-2 ring-terracotta" : "hover:bg-gray-50"}`} onClick={() => setCardFilter(cardFilter === "DRAFT" ? null : "DRAFT")}>
          <p className="text-xs text-gray-500">Draft</p>
          <p className="text-xl font-bold text-gray-500">{summary.draft}</p>
        </Card>
        <Card className={`px-4 py-3 cursor-pointer transition-colors ${cardFilter === "active" ? "ring-2 ring-terracotta" : "hover:bg-gray-50"}`} onClick={() => setCardFilter(cardFilter === "active" ? null : "active")}>
          <p className="text-xs text-gray-500">Active / In Progress</p>
          <p className="text-xl font-bold text-terracotta">{summary.active}</p>
        </Card>
        <Card className={`px-4 py-3 cursor-pointer transition-colors ${cardFilter === "COMPLETED" ? "ring-2 ring-terracotta" : "hover:bg-gray-50"}`} onClick={() => setCardFilter(cardFilter === "COMPLETED" ? null : "COMPLETED")}>
          <p className="text-xs text-gray-500">Completed</p>
          <p className="text-xl font-bold text-green-600">{summary.completed}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-gray-500">Total Value</p>
          <p className="text-xl font-bold text-gray-900">RM {summary.totalValue.toFixed(2)}</p>
        </Card>
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <div className="relative w-full sm:flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Search by PO#, supplier, or outlet..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1.5">
          {([["active", "Active"], ["completed", "Completed"], ["all", "All"]] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${tab === value ? "border-terracotta bg-terracotta/5 text-terracotta-dark" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`relative flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${showFilters || activeOrderFilterCount > 0 ? "border-blue-400 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}
        >
          <Filter className="h-3 w-3" />
          Filters
          {activeOrderFilterCount > 0 && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">{activeOrderFilterCount}</span>
          )}
        </button>
        {activeOrderFilterCount > 0 && (
          <button
            onClick={() => { setCreatedFrom(""); setCreatedTo(""); }}
            className="flex items-center gap-1 rounded-full border border-gray-200 px-2 py-1 text-[10px] text-gray-500 hover:bg-gray-50"
          >
            <X className="h-3 w-3" /> Clear filters
          </button>
        )}
      </div>

      {/* Expanded filter panel */}
      {showFilters && (
        <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/30 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 flex items-center gap-1 text-xs font-medium text-gray-600">
                <CalendarDays className="h-3 w-3" /> Created From
              </label>
              <input
                type="date"
                value={createdFrom}
                onChange={(e) => setCreatedFrom(e.target.value)}
                className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="mb-1.5 flex items-center gap-1 text-xs font-medium text-gray-600">
                <CalendarDays className="h-3 w-3" /> Created To
              </label>
              <input
                type="date"
                value={createdTo}
                onChange={(e) => setCreatedTo(e.target.value)}
                min={createdFrom || undefined}
                className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          </div>
        </div>
      )}

      {/* Orders table */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
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
            {orders.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center">
                  <ShoppingCart className="mx-auto h-8 w-8 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">
                    {!debouncedSearch && tab === "all" ? "No orders yet. Click 'Create Order' to get started." : "No orders match your filter."}
                  </p>
                </td>
              </tr>
            )}
            {orders.filter((o) => {
              if (!cardFilter) return true;
              if (cardFilter === "DRAFT") return o.status === "DRAFT";
              if (cardFilter === "COMPLETED") return o.status === "COMPLETED";
              if (cardFilter === "active") return !["DRAFT", "COMPLETED", "CANCELLED"].includes(o.status);
              return true;
            }).map((order) => {
              const config = STATUS_CONFIG[order.status] ?? { label: order.status, color: "bg-gray-400", icon: Clock };
              const actions = NEXT_ACTIONS[order.status] ?? [];
              return (
                <Fragment key={order.id}>
                  <tr className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer" onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}>
                    <td className="px-3 py-3">
                      <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${expandedId === order.id ? "rotate-180" : ""}`} />
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/inventory/orders/${order.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                        <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-terracotta">{order.orderNumber}</code>
                      </Link>
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
                          <button key={a.status} onClick={() => {
                            updateStatus(order.id, a.status);
                          }} disabled={updatingId === order.id} className={`rounded-md px-2 py-1 text-[10px] font-medium text-white ${a.color} disabled:opacity-50`} title={a.label}>
                            {updatingId === order.id ? <Loader2 className="h-3 w-3 animate-spin" /> : a.label}
                          </button>
                        ))}
                        {/* Upload Invoice — replaces the old "Confirm Order" CTA. Shows on every
                            in-flight PO state so procurement can fill in supplier invoice details
                            whenever they arrive (before delivery, on delivery, or days after).
                            Hidden once the invoice is paid (no need to upload anymore) or once a
                            real invoice is fully attached (has dueDate set). */}
                        {["AWAITING_DELIVERY", "PARTIALLY_RECEIVED", "COMPLETED", "SENT", "APPROVED"].includes(order.status)
                          && order.invoice?.status !== "PAID"
                          && !order.invoice?.dueDate && (
                          <button onClick={() => openEditDialog(order)} disabled={updatingId === order.id} className="rounded-md px-2 py-1 text-[10px] font-medium text-white bg-yellow-500 hover:bg-yellow-600 disabled:opacity-50" title="Upload Invoice">
                            {updatingId === order.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Upload Invoice"}
                          </button>
                        )}
                        {order.status === "DRAFT" && (
                          <Link href={`/inventory/orders/create?draft=${order.id}`} className="rounded-md px-2 py-1 text-[10px] font-medium text-gray-600 border border-gray-200 hover:bg-gray-50" title="Edit Draft">
                            <Pencil className="h-3 w-3" />
                          </Link>
                        )}
                        {["SENT", "APPROVED", "AWAITING_DELIVERY"].includes(order.status) && order.invoice?.status !== "PAID" && (
                          <button onClick={() => openEditDialog(order)} disabled={updatingId === order.id} className="rounded-md px-2 py-1 text-[10px] font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-50" title="Edit Order">
                            <Pencil className="h-3 w-3" />
                          </button>
                        )}
                        {/* Cancel hidden once a committed invoice exists (INITIATED/DEPOSIT_PAID/PAID).
                            API also enforces this — frontend hide is just for UX. */}
                        {["SENT", "APPROVED", "AWAITING_DELIVERY"].includes(order.status)
                          && !["INITIATED", "DEPOSIT_PAID", "PAID"].includes(order.invoice?.status ?? "") && (
                          <button onClick={() => { if (confirm("Cancel this order?")) updateStatus(order.id, "CANCELLED"); }} disabled={updatingId === order.id} className="rounded-md px-2 py-1 text-[10px] font-medium text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50" title="Cancel Order">
                            Cancel
                          </button>
                        )}
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
                          <div className="flex gap-2 text-xs text-gray-400">
                            <span>Created by: {order.createdBy}</span>
                            {order.approvedBy && <span>&middot; Approved by: {order.approvedBy}</span>}
                            {order.sentAt && <span>&middot; Sent: {new Date(order.sentAt).toLocaleDateString("en-MY")}</span>}
                          </div>
                        </div>
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
                        {order.photos && order.photos.length > 0 && (
                          <div className="mt-2">
                            <p className="text-xs text-gray-500 mb-1">Attached documents ({order.photos.length})</p>
                            <div className="flex gap-2 flex-wrap">
                              {order.photos.map((url, i) => {
                                const isRaw = url.includes("/raw/upload/") || url.endsWith(".pdf");
                                const displayUrl = isRaw ? url : url.replace("/raw/upload/", "/image/upload/");
                                return (
                                <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="relative h-16 w-16 rounded-md overflow-hidden border border-gray-200 hover:border-blue-400 transition-colors">
                                  {isRaw ? (
                                    <div className="h-full w-full flex items-center justify-center bg-gray-50">
                                      <FileText className="h-6 w-6 text-red-400" />
                                    </div>
                                  ) : (
                                    <Image src={displayUrl} alt={`Doc ${i + 1}`} fill className="object-cover" sizes="64px" />
                                  )}
                                </a>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {order.invoice && (
                          <div className="mt-2 flex items-center gap-3 rounded-md bg-white px-3 py-2 border border-gray-200">
                            <Receipt className="h-4 w-4 text-gray-400" />
                            <div className="flex-1 flex items-center gap-4 text-xs">
                              <span className="font-medium text-gray-700">{order.invoice.invoiceNumber}</span>
                              <span className="text-gray-500">RM {order.invoice.amount.toFixed(2)}</span>
                              <Badge className={`text-[9px] ${order.invoice.status === "PAID" ? "bg-green-500" : order.invoice.status === "OVERDUE" ? "bg-blue-500" : "bg-terracotta"}`}>{{ PENDING: "Payment", OVERDUE: "Initiated", PAID: "Paid" }[order.invoice.status] || order.invoice.status}</Badge>
                              {order.invoice.dueDate && <span className="text-gray-400">Due: {order.invoice.dueDate}</span>}
                              {order.invoice.photoCount > 0 && <span className="text-gray-400">{order.invoice.photoCount} photo(s)</span>}
                            </div>
                          </div>
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

      {/* Edit Order Dialog — shared component (also used in supplier-chats) */}
      <EditOrderModal
        order={editOrder}
        confirmMode={editConfirmMode}
        onClose={() => setEditOrder(null)}
        onSaved={() => { loadOrders(undefined, { revalidate: true }); }}
      />

    </div>
  );
}
