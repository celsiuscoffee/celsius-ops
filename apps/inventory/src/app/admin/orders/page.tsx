"use client";

import { useState, Fragment } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useFetch } from "@/lib/use-fetch";
import { Card } from "@/components/ui/card";
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
  Send,
  Ban,
  ThumbsUp,
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

type Order = {
  id: string;
  orderNumber: string;
  branch: string;
  branchCode: string;
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
  SENT: { label: "Sent", color: "bg-green-500", icon: MessageCircle },
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
  SENT: [
    { status: "AWAITING_DELIVERY", label: "Awaiting Delivery", icon: Truck, color: "bg-purple-500 hover:bg-purple-600" },
  ],
  AWAITING_DELIVERY: [],
  PARTIALLY_RECEIVED: [],
  COMPLETED: [],
  CANCELLED: [],
};

// ── Component ─────────────────────────────────────────────────────────────

export default function OrdersPage() {
  // Table state
  const { data: orders = [], isLoading: loading, mutate: loadOrders } = useFetch<Order[]>("/api/orders");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // ── Status update ───────────────────────────────────────────────────────

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
    const msg = `Hi, this is Celsius Coffee.\n\nPO: ${order.orderNumber}\nBranch: ${order.branch}\n${order.deliveryDate ? `Delivery: ${order.deliveryDate}\n` : ""}\nOrder:\n${items}\n\nTotal: RM ${order.totalAmount.toFixed(2)}\n\n${order.notes ? `Notes: ${order.notes}\n\n` : ""}Thank you!`;
    const phone = order.supplierPhone.replace(/[^0-9]/g, "");
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  };

  // ── Filters ─────────────────────────────────────────────────────────────

  const statuses = ["All", ...Object.keys(STATUS_CONFIG)];
  const filtered = orders.filter((o) => {
    const matchSearch =
      o.orderNumber.toLowerCase().includes(search.toLowerCase()) ||
      o.supplier.toLowerCase().includes(search.toLowerCase()) ||
      o.branch.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "All" || o.status === statusFilter;
    return matchSearch && matchStatus;
  });
  const totalValue = filtered.reduce((a, o) => a + o.totalAmount, 0);
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
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Purchase Orders</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            {orders.length} orders &middot; {pendingCount} active
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
          <p className="text-xl font-bold text-gray-900">{orders.length}</p>
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
          <Input placeholder="Search by PO#, supplier, or branch..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {statuses.map((s) => {
            const config = STATUS_CONFIG[s];
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${statusFilter === s ? "border-terracotta bg-terracotta/5 text-terracotta-dark" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}
              >
                {s === "All" ? "All" : config?.label ?? s}
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
              <th className="px-4 py-3 text-left font-medium text-gray-500">Branch</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Supplier</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Amount</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Items</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Delivery</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center">
                  <ShoppingCart className="mx-auto h-8 w-8 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">
                    {orders.length === 0 ? "No orders yet. Click 'Create Order' to get started." : "No orders match your filter."}
                  </p>
                </td>
              </tr>
            )}
            {filtered.map((order) => {
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
                    <td className="px-4 py-3 text-gray-600 text-xs">{order.branch}</td>
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
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  );
}
