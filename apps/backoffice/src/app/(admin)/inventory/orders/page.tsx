"use client";

import { useState, useEffect, Fragment, useRef, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useFetch } from "@/lib/use-fetch";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
  Plus,
  Send,
  Ban,
  ThumbsUp,
  Trash2,
  Pencil,
  Receipt,
  CalendarDays,
  Upload,
  X,
  ImageIcon,
  Sparkles,
} from "lucide-react";
import { AIInsightBanner } from "@/components/ai-insight-banner";

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
  dueDate: string | null;
  photoCount: number;
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
  invoice: OrderInvoice | null;
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
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const url = `/api/inventory/orders?tab=${tab}${debouncedSearch ? `&search=${debouncedSearch}` : ""}`;
  const { data: orders = [], isLoading: loading, mutate: loadOrders } = useFetch<Order[]>(url);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Edit dialog state
  type EditItem = OrderItem & { removed?: boolean; qtyStr: string; priceStr: string };
  const [editOrder, setEditOrder] = useState<Order | null>(null);
  const [editItems, setEditItems] = useState<EditItem[]>([]);
  const [editDeliveryDate, setEditDeliveryDate] = useState("");
  const [editInvoiceNumber, setEditInvoiceNumber] = useState("");
  const [editInvoiceDueDate, setEditInvoiceDueDate] = useState("");
  type InvoiceFile = { url: string; type: "image" | "pdf"; name: string };
  const [editInvoiceFiles, setEditInvoiceFiles] = useState<InvoiceFile[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [extracting, setExtracting] = useState(false);
  const [aiExtracted, setAiExtracted] = useState<Record<string, boolean>>({});

  const openEditDialog = (order: Order) => {
    setEditOrder(order);
    setEditItems(order.items.map((i) => ({ ...i, removed: false, qtyStr: String(i.quantity), priceStr: i.unitPrice.toFixed(2) })));
    setEditDeliveryDate(order.deliveryDate ?? "");
    setEditInvoiceNumber(order.invoice?.invoiceNumber ?? "");
    setEditInvoiceDueDate(order.invoice?.dueDate ?? "");
    setEditInvoiceFiles([]);
    setAiExtracted({});
  };

  const editTotal = editItems
    .filter((i) => !i.removed)
    .reduce((sum, i) => sum + (parseFloat(i.qtyStr) || 0) * (parseFloat(i.priceStr) || 0), 0);

  const extractInvoiceData = useCallback(async (urls: string[], supplierName?: string) => {
    setExtracting(true);
    try {
      const res = await fetch("/api/inventory/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls,
          context: supplierName ? `Supplier: ${supplierName}` : undefined,
          productNames: editItems.map((i) => i.product),
        }),
      });
      if (!res.ok) {
        console.warn("[AI Extract] Failed:", res.status);
        return;
      }
      const data = await res.json();
      if (data.error) {
        console.warn("[AI Extract] Error:", data.error);
        return;
      }
      const filled: Record<string, boolean> = {};

      // Invoice number — always override with AI data
      if (data.invoiceNumber) {
        setEditInvoiceNumber(data.invoiceNumber);
        filled.invoiceNumber = true;
      }

      // Due date — always override with AI data
      if (data.dueDate) {
        setEditInvoiceDueDate(data.dueDate);
        filled.dueDate = true;
      }

      // Delivery date — use deliveryDate or issueDate (always override with AI data)
      const detectedDeliveryDate = data.deliveryDate || data.issueDate;
      if (detectedDeliveryDate) {
        setEditDeliveryDate(detectedDeliveryDate);
        filled.deliveryDate = true;
      }

      // Match extracted items to order items by name similarity — update qty & price
      if (data.items?.length > 0) {
        setEditItems((prevItems) => {
          const updated = [...prevItems];
          let matched = false;
          for (const aiItem of data.items) {
            const aiName = (aiItem.name || "").toLowerCase();
            // Find best match in existing order items
            const idx = updated.findIndex((oi) => {
              const orderName = oi.product.toLowerCase();
              return orderName.includes(aiName) || aiName.includes(orderName) ||
                // Fuzzy: check if most words match
                aiName.split(/\s+/).filter((w: string) => orderName.includes(w)).length >= Math.ceil(aiName.split(/\s+/).length * 0.5);
            });
            if (idx >= 0) {
              if (aiItem.quantity > 0) updated[idx].qtyStr = String(aiItem.quantity);
              if (aiItem.unitPrice > 0) updated[idx].priceStr = String(aiItem.unitPrice);
              matched = true;
            }
          }
          if (matched) filled.items = true;
          return updated;
        });
      }

      setAiExtracted((prev) => ({ ...prev, ...filled }));
    } catch (err) {
      console.warn("[AI Extract] Exception:", err);
    } finally {
      setExtracting(false);
    }
  }, [editDeliveryDate]);

  const uploadFile = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "invoices");
      const res = await fetch("/api/inventory/upload", { method: "POST", body: fd });
      if (res.ok) {
        const data = await res.json();
        const newFile = { url: data.url, type: data.type || "image", name: data.name || file.name };
        setEditInvoiceFiles((prev) => {
          const updated = [...prev, newFile];
          // Trigger AI extraction after first file upload
          if (updated.length === 1) {
            extractInvoiceData(
              [newFile.url],
              editOrder?.supplier,
            );
          }
          return updated;
        });
      }
    } finally {
      setUploading(false);
    }
  }, [extractInvoiceData, editOrder?.supplier]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
    files.forEach(uploadFile);
  }, [uploadFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach(uploadFile);
    e.target.value = "";
  }, [uploadFile]);

  const openFilePicker = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,application/pdf";
    input.multiple = true;
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      files.forEach(uploadFile);
      document.body.removeChild(input);
    });
    input.click();
  }, [uploadFile]);

  const saveEdit = async () => {
    if (!editOrder) return;
    setEditSaving(true);
    try {
      // Build item changes
      const itemChanges = editItems
        .filter((i) => {
          if (i.removed) return true;
          const origItem = editOrder.items.find((o) => o.id === i.id);
          if (!origItem) return false;
          return parseFloat(i.qtyStr) !== origItem.quantity || parseFloat(i.priceStr) !== origItem.unitPrice;
        })
        .map((i) => i.removed
          ? { id: i.id, remove: true }
          : { id: i.id, quantity: parseFloat(i.qtyStr) || 0, unitPrice: parseFloat(i.priceStr) || 0 }
        );

      // Update order (items + delivery date)
      const orderPayload: Record<string, unknown> = {};
      if (itemChanges.length > 0) orderPayload.items = itemChanges;
      if (editDeliveryDate !== (editOrder.deliveryDate ?? "")) {
        orderPayload.deliveryDate = editDeliveryDate || null;
      }
      if (Object.keys(orderPayload).length > 0) {
        await fetch(`/api/inventory/orders/${editOrder.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(orderPayload),
        });
      }

      // Update or create invoice
      const invoiceAmount = editTotal;

      if (editOrder.invoice) {
        const invoicePayload: Record<string, unknown> = {};
        if (editInvoiceNumber !== (editOrder.invoice.invoiceNumber ?? "")) {
          invoicePayload.invoiceNumber = editInvoiceNumber || null;
        }
        if (editInvoiceDueDate !== (editOrder.invoice.dueDate ?? "")) {
          invoicePayload.dueDate = editInvoiceDueDate || null;
        }
        if (invoiceAmount !== editOrder.invoice.amount) {
          invoicePayload.amount = invoiceAmount;
        }
        if (editInvoiceFiles.length > 0) {
          // Fetch existing photos and append new ones
          const invRes = await fetch(`/api/inventory/invoices/${editOrder.invoice.id}`);
          const invData = invRes.ok ? await invRes.json() : { photos: [] };
          invoicePayload.photos = [...(invData.photos || []), ...editInvoiceFiles.map((f) => f.url)];
        }
        if (Object.keys(invoicePayload).length > 0) {
          await fetch(`/api/inventory/invoices/${editOrder.invoice.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(invoicePayload),
          });
        }
      } else if (editInvoiceNumber || editInvoiceDueDate || editInvoiceFiles.length > 0) {
        const detailRes = await fetch(`/api/inventory/orders/${editOrder.id}`);
        if (detailRes.ok) {
          const detail = await detailRes.json();
          await fetch("/api/inventory/invoices", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              orderId: editOrder.id,
              outletId: detail.outletId,
              supplierId: detail.supplierId,
              amount: invoiceAmount,
              invoiceNumber: editInvoiceNumber || null,
              dueDate: editInvoiceDueDate || null,
              photos: editInvoiceFiles.map((f) => f.url),
            }),
          });
        }
      }

      setEditOrder(null);
      loadOrders();
    } finally {
      setEditSaving(false);
    }
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
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Purchase Orders</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            {orders.length} orders &middot; {pendingCount} active
          </p>
        </div>
        <Link href="/inventory/orders/create">
          <Button className="bg-terracotta hover:bg-terracotta-dark">
            <Plus className="mr-1.5 h-4 w-4" />Create Order
          </Button>
        </Link>
      </div>

      {/* AI Suggestions */}
      <div className="mt-4">
        <AIInsightBanner type="purchaseOrders" onCreated={() => loadOrders()} />
        <AIInsightBanner type="transfers" onCreated={() => loadOrders()} />
      </div>

      {/* Summary cards */}
      <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
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
      </div>

      {/* Orders table */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-white overflow-x-auto">
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
                        {order.status === "SENT" && (
                          <button onClick={() => openEditDialog(order)} disabled={updatingId === order.id} className="rounded-md px-2 py-1 text-[10px] font-medium text-white bg-purple-500 hover:bg-purple-600 disabled:opacity-50" title="Confirm Order">
                            {updatingId === order.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm Order"}
                          </button>
                        )}
                        {["DRAFT", "PENDING_APPROVAL", "SENT", "AWAITING_DELIVERY", "PARTIALLY_RECEIVED"].includes(order.status) && (
                          <button onClick={() => openEditDialog(order)} className="rounded-md px-2 py-1 text-[10px] font-medium text-gray-600 border border-gray-200 hover:bg-gray-50" title="Edit Order">
                            <Pencil className="h-3 w-3" />
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

      {/* Edit Order Dialog */}
      <Dialog open={!!editOrder} onOpenChange={(open) => !open && setEditOrder(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4" />
              Edit {editOrder?.orderNumber}
            </DialogTitle>
          </DialogHeader>

          {editOrder && (
            <div className="space-y-4">
              {/* Supplier & Outlet info */}
              <div className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500">
                {editOrder.supplier} → {editOrder.outlet}
              </div>

              {/* Invoice section — UPLOAD FIRST */}
              <div className="border-b pb-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-700">
                  <Receipt className="h-3.5 w-3.5" />
                  Invoice
                  {editOrder.invoice && (
                    <Badge className="ml-1 text-[9px] bg-gray-400">{editOrder.invoice.invoiceNumber}</Badge>
                  )}
                  {!editOrder.invoice && (
                    <span className="ml-1 text-[10px] font-normal text-gray-400">— will be created when you add a due date or photo</span>
                  )}
                </p>

                {/* Upload invoice/receipt */}
                <div className="mb-3">
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">
                    <Upload className="h-3.5 w-3.5" /> Upload Invoice / Receipt
                  </label>
                  <p className="mb-2 text-[10px] text-gray-400">Upload first — AI will auto-extract invoice details &amp; update order items below</p>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={openFilePicker}
                    className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-5 transition-colors ${
                      dragOver ? "border-terracotta bg-terracotta/5" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {uploading ? (
                      <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
                    ) : (
                      <Upload className="h-6 w-6 text-gray-300" />
                    )}
                    <p className="mt-1.5 text-xs text-gray-400">
                      {uploading ? "Uploading..." : "Drag & drop invoice files here"}
                    </p>
                    <span className="mt-2 rounded-md bg-terracotta/10 px-3 py-1.5 text-xs font-medium text-terracotta">
                      Browse Files
                    </span>
                  </div>

                  {/* File previews */}
                  {editInvoiceFiles.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {editInvoiceFiles.map((f, i) => (
                        <div key={i} className="group relative rounded-md border overflow-hidden">
                          {f.type === "pdf" ? (
                            <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-50">
                              <FileText className="h-4 w-4 text-red-500" />
                              <span className="text-xs text-gray-700 max-w-[120px] truncate">{f.name}</span>
                            </div>
                          ) : (
                            <div className="h-16 w-16">
                              <Image src={f.url} alt={`Invoice ${i + 1}`} fill className="object-cover" sizes="64px" />
                            </div>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditInvoiceFiles((prev) => prev.filter((_, j) => j !== i)); }}
                            className="absolute -right-1 -top-1 rounded-full bg-red-500 p-0.5 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* AI extraction status */}
                {extracting && (
                  <div className="mb-3 flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2">
                    <Sparkles className="h-4 w-4 animate-pulse text-purple-500" />
                    <span className="text-xs text-purple-700">AI is extracting invoice details...</span>
                  </div>
                )}

                {Object.keys(aiExtracted).length > 0 && !extracting && (
                  <div className="mb-3 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
                    <Sparkles className="h-4 w-4 text-green-500" />
                    <span className="text-xs text-green-700">AI auto-filled fields — review and correct if needed</span>
                  </div>
                )}

                {/* Invoice details */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">
                      <FileText className="h-3.5 w-3.5" /> Invoice Number
                      {editOrder.status === "SENT" && <span className="text-red-500">*</span>}
                      {aiExtracted.invoiceNumber && <span className="ml-1 rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-medium text-purple-600">AI</span>}
                    </label>
                    <Input
                      type="text"
                      placeholder="e.g. INV-001234"
                      value={editInvoiceNumber}
                      onChange={(e) => { setEditInvoiceNumber(e.target.value); setAiExtracted((p) => { const n = { ...p }; delete n.invoiceNumber; return n; }); }}
                      className={aiExtracted.invoiceNumber ? "border-purple-300 bg-purple-50/30" : ""}
                    />
                  </div>
                  <div>
                    <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">
                      <CalendarDays className="h-3.5 w-3.5" /> Invoice Due Date
                      {aiExtracted.dueDate && <span className="ml-1 rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-medium text-purple-600">AI</span>}
                    </label>
                    <Input
                      type="date"
                      value={editInvoiceDueDate}
                      onChange={(e) => { setEditInvoiceDueDate(e.target.value); setAiExtracted((p) => { const n = { ...p }; delete n.dueDate; return n; }); }}
                      className={aiExtracted.dueDate ? "border-purple-300 bg-purple-50/30" : ""}
                    />
                  </div>
                </div>
              </div>

              {/* Delivery Date */}
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">
                  <Truck className="h-3.5 w-3.5" /> Delivery Date
                  {editOrder.status === "SENT" && <span className="text-red-500">*</span>}
                  {aiExtracted.deliveryDate && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-medium text-purple-600">AI</span>}
                </label>
                <Input
                  type="date"
                  value={editDeliveryDate}
                  onChange={(e) => setEditDeliveryDate(e.target.value)}
                />
              </div>

              {/* Editable Items */}
              <div>
                <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-gray-700 uppercase">
                  Order Items
                  {aiExtracted.items && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-medium normal-case text-purple-600">AI updated qty &amp; prices</span>}
                </p>
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b">
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Product</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Package</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500 w-20">Qty</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500 w-24">Unit Price</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500 w-24">Total</th>
                        <th className="px-3 py-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {editItems.map((item, idx) => {
                        if (item.removed) return (
                          <tr key={item.id} className="border-b border-gray-50 bg-red-50/50">
                            <td className="px-3 py-2 text-gray-400 line-through" colSpan={5}>{item.product}</td>
                            <td className="px-3 py-2 text-center">
                              <button onClick={() => setEditItems((prev) => prev.map((p, i) => i === idx ? { ...p, removed: false } : p))} className="text-blue-500 hover:text-blue-700" title="Undo">
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                        const lineTotal = (parseFloat(item.qtyStr) || 0) * (parseFloat(item.priceStr) || 0);
                        return (
                          <tr key={item.id} className="border-b border-gray-50">
                            <td className="px-3 py-2">
                              <p className="font-medium text-gray-900">{item.product}</p>
                              <p className="text-[10px] text-gray-400">{item.sku}</p>
                            </td>
                            <td className="px-3 py-2 text-gray-500">{item.uom || item.package}</td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min="0"
                                step="1"
                                className="w-full rounded border border-gray-200 px-2 py-1 text-right text-xs focus:border-terracotta focus:outline-none"
                                value={item.qtyStr}
                                onChange={(e) => setEditItems((prev) => prev.map((p, i) => i === idx ? { ...p, qtyStr: e.target.value } : p))}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className="w-full rounded border border-gray-200 px-2 py-1 text-right text-xs focus:border-terracotta focus:outline-none"
                                value={item.priceStr}
                                onChange={(e) => setEditItems((prev) => prev.map((p, i) => i === idx ? { ...p, priceStr: e.target.value } : p))}
                              />
                            </td>
                            <td className="px-3 py-2 text-right font-medium text-gray-900">RM {lineTotal.toFixed(2)}</td>
                            <td className="px-3 py-2 text-center">
                              <button onClick={() => setEditItems((prev) => prev.map((p, i) => i === idx ? { ...p, removed: true } : p))} className="text-red-400 hover:text-red-600" title="Remove">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="border-t-2 border-gray-200 bg-gray-50">
                        <td colSpan={4} className="px-3 py-2 text-right font-semibold text-gray-700">Total</td>
                        <td className="px-3 py-2 text-right font-bold text-gray-900">RM {editTotal.toFixed(2)}</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* old invoice section removed — now at top */}
            </div>
          )}

          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setEditOrder(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={editSaving || uploading} className="bg-terracotta hover:bg-terracotta-dark">
              {editSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
              Save Changes
            </Button>
            {editOrder?.status === "SENT" && (
              <Button
                disabled={editSaving || uploading}
                className="bg-purple-500 hover:bg-purple-600"
                onClick={async () => {
                  // Validate required fields
                  const missing: string[] = [];
                  if (!editDeliveryDate) missing.push("Delivery Date");
                  if (!editInvoiceNumber) missing.push("Invoice Number");
                  if (!editInvoiceDueDate) missing.push("Invoice Due Date");
                  if (missing.length > 0) {
                    alert(`Please fill in required fields:\n• ${missing.join("\n• ")}`);
                    return;
                  }
                  // Save first, then confirm order
                  await saveEdit();
                  await updateStatus(editOrder.id, "AWAITING_DELIVERY");
                }}
              >
                {editSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Truck className="mr-1.5 h-4 w-4" />}
                Confirm Order
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
