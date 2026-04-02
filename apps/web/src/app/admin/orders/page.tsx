"use client";

import { useState, useEffect, Fragment } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
} from "lucide-react";

type OrderItem = {
  id: string;
  product: string;
  sku: string;
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

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/orders")
      .then((res) => res.json())
      .then((data) => { setOrders(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const statuses = ["All", ...new Set(orders.map((o) => o.status))];

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
      <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
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
              <th className="px-4 py-3 text-left font-medium text-gray-500">Created</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center">
                  <ShoppingCart className="mx-auto h-8 w-8 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">
                    {orders.length === 0
                      ? "No orders yet. Orders created from the mobile app will appear here."
                      : "No orders match your filter."}
                  </p>
                </td>
              </tr>
            )}
            {filtered.map((order) => {
              const config = STATUS_CONFIG[order.status] ?? { label: order.status, color: "bg-gray-400", icon: Clock };

              return (
                <Fragment key={order.id}>
                  <tr
                    className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer"
                    onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
                  >
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
                        {order.supplierPhone && (
                          <a
                            href={`https://wa.me/${order.supplierPhone.replace("+", "")}`}
                            target="_blank"
                            onClick={(e) => e.stopPropagation()}
                            className="text-green-600 hover:text-green-700"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={`text-[10px] ${config.color}`}>{config.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      RM {order.totalAmount.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      <span className="flex items-center gap-1 text-xs">
                        <Package className="h-3 w-3" />
                        {order.items.length}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {order.deliveryDate ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {new Date(order.createdAt).toLocaleDateString("en-MY")}
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
                                <td className="py-1.5 text-gray-500">{item.package}</td>
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
                        {order.notes && (
                          <p className="mt-2 text-xs text-gray-500">Notes: {order.notes}</p>
                        )}
                        {order.receivingCount > 0 && (
                          <p className="mt-2 text-xs text-green-600">{order.receivingCount} receiving record(s) linked</p>
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
    </div>
  );
}
