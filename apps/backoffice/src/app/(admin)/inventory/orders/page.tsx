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

// ── Invoice preview pane ──────────────────────────────────────────────────
// Image-or-PDF aware preview with onError fallback to iframe. Bigger now so
// it actually fills the wider edit dialog (was capped at 60vh, broke when
// the URL was a PDF or expired Cloudinary asset).
function InvoicePreviewPane({ photos }: { photos: string[] }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [failed, setFailed] = useState(false);
  const url = photos[activeIdx];
  const isPdf = /\.pdf($|\?)/i.test(url) || url.includes("/raw/upload/");
  const imgUrl = url.replace("/raw/upload/", "/image/upload/");

  return (
    <div className="hidden lg:flex w-[48%] shrink-0 flex-col rounded-lg bg-gray-900 overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b border-gray-700">
        <p className="text-xs text-gray-400 font-medium">Invoice / Receipt</p>
        {photos.length > 1 && (
          <div className="flex gap-1">
            {photos.map((_, i) => (
              <button
                key={i}
                onClick={() => { setActiveIdx(i); setFailed(false); }}
                className={`h-6 w-6 rounded text-[10px] font-medium ${i === activeIdx ? "bg-terracotta text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex-1 flex items-stretch justify-stretch p-3 min-h-[600px]">
        {isPdf || failed ? (
          <iframe src={url} className="w-full h-full min-h-[600px] rounded bg-white" title="Invoice" />
        ) : (
          <a href={imgUrl} target="_blank" rel="noopener noreferrer" className="group relative flex-1 flex items-center justify-center">
            <img
              src={imgUrl}
              alt="Invoice"
              className="max-w-full max-h-[80vh] object-contain rounded"
              onError={() => setFailed(true)}
            />
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/20 rounded transition-opacity">
              <span className="text-white text-xs font-medium bg-black/50 px-2 py-1 rounded">Open full size</span>
            </div>
          </a>
        )}
      </div>
      <div className="px-3 py-2 border-t border-gray-700 flex items-center justify-between">
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-medium text-blue-400 hover:text-blue-300">
          Open in new tab →
        </a>
        <span className="text-[10px] text-gray-500">{isPdf ? "PDF" : failed ? "Preview unavailable" : "Image"}</span>
      </div>
    </div>
  );
}

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
  type OrdersResponse = { orders: Order[]; summary: { total: number; draft: number; active: number; completed: number; totalValue: number } };
  const { data, isLoading: loading, mutate: loadOrders } = useFetch<OrdersResponse>(url);
  const orders: Order[] = data?.orders ?? [];
  const summary = data?.summary ?? { total: 0, draft: 0, active: 0, completed: 0, totalValue: 0 };
  const [cardFilter, setCardFilter] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Edit dialog state
  type EditItem = OrderItem & { removed?: boolean; qtyStr: string; priceStr: string };
  const [editOrder, setEditOrder] = useState<Order | null>(null);
  const [editItems, setEditItems] = useState<EditItem[]>([]);
  const [editDeliveryDate, setEditDeliveryDate] = useState("");
  const [editInvoiceNumber, setEditInvoiceNumber] = useState("");
  const [editInvoiceIssueDate, setEditInvoiceIssueDate] = useState("");
  const [editInvoiceDueDate, setEditInvoiceDueDate] = useState("");
  type InvoiceFile = { url: string; type: "image" | "pdf"; name: string };
  const [editInvoiceFiles, setEditInvoiceFiles] = useState<InvoiceFile[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [extracting, setExtracting] = useState(false);
  const [aiExtracted, setAiExtracted] = useState<Record<string, boolean>>({});
  const [confirmOnSave, setConfirmOnSave] = useState(false);
  const [detectedSupplier, setDetectedSupplier] = useState<string | null>(null);
  const [aiUnmatched, setAiUnmatched] = useState<string[]>([]);
  const [aiDeliveryCharge, setAiDeliveryCharge] = useState<number | null>(null);

  const openEditDialog = (order: Order, confirmMode = false) => {
    setConfirmOnSave(confirmMode);
    setDetectedSupplier(null);
    setAiUnmatched([]);
    setAiDeliveryCharge(null);
    setEditOrder(order);
    setEditItems(order.items.map((i) => ({ ...i, removed: false, qtyStr: String(i.quantity), priceStr: i.unitPrice.toFixed(2) })));
    setEditDeliveryDate(order.deliveryDate ?? "");
    setEditInvoiceNumber(order.invoice?.invoiceNumber ?? "");
    setEditInvoiceIssueDate(order.invoice?.issueDate ?? "");
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
      // Fetch full product catalog and supplier list for AI matching
      const [productsRes, suppliersRes] = await Promise.all([
        fetch("/api/inventory/products"),
        fetch("/api/inventory/suppliers"),
      ]);
      const allProducts: { name: string; sku: string; packages: { label: string; conversion: number }[]; suppliers: { name: string; price: number; uom: string }[] }[] = productsRes.ok ? await productsRes.json() : [];
      const allSuppliers: { name: string }[] = suppliersRes.ok ? await suppliersRes.json() : [];

      // Build rich product names including packaging and supplier pricing context
      const productNames = allProducts.map((p) => {
        let desc = `${p.name} (${p.sku})`;
        if (p.packages?.length > 0) {
          const pkgInfo = p.packages.map((pkg) => `${pkg.label} [×${pkg.conversion}]`).join(", ");
          desc += ` — packages: ${pkgInfo}`;
        }
        // Include supplier pricing for the current supplier
        const relevantPrices = supplierName
          ? p.suppliers?.filter((s) => s.name.toLowerCase().includes(supplierName.toLowerCase()))
          : p.suppliers;
        if (relevantPrices?.length > 0) {
          const priceInfo = relevantPrices.map((s) => `RM${s.price}/${s.uom}`).join(", ");
          desc += ` — prices: ${priceInfo}`;
        }
        return desc;
      });

      // Include current order items for context
      const orderItemsContext = editItems
        .filter((i) => !i.removed)
        .map((i) => `${i.product} | package: ${i.uom || i.package || "pcs"} | ordered qty: ${i.quantity} | unit price: RM${i.unitPrice}`);

      const res = await fetch("/api/inventory/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls,
          context: supplierName ? `Supplier: ${supplierName}` : undefined,
          productNames,
          supplierNames: allSuppliers.map((s) => s.name),
          orderItems: orderItemsContext,
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

      // Supplier name — show detected supplier
      if (data.supplierName) {
        setDetectedSupplier(data.supplierName);
        filled.supplier = true;
      }

      // Invoice number — always override with AI data
      if (data.invoiceNumber) {
        setEditInvoiceNumber(data.invoiceNumber);
        filled.invoiceNumber = true;
      }

      // Issue date — always override with AI data
      if (data.issueDate) {
        setEditInvoiceIssueDate(data.issueDate);
        filled.issueDate = true;
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

      // Match extracted items to existing order items only — don't add new items
      if (data.items?.length > 0) {
        const unmatchedItems: string[] = [];
        setEditItems((prevItems) => {
          const updated = [...prevItems];
          let changed = false;
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
              // Update existing item
              if (aiItem.quantity > 0) updated[idx].qtyStr = String(aiItem.quantity);
              if (aiItem.unitPrice > 0) updated[idx].priceStr = String(aiItem.unitPrice);
              changed = true;
            } else {
              // Track unmatched items to show warning
              if (aiItem.name) unmatchedItems.push(`${aiItem.name} (${aiItem.quantity} × RM${aiItem.unitPrice})`);
            }
          }
          if (changed) filled.items = true;
          return updated;
        });
        if (unmatchedItems.length > 0) {
          setAiUnmatched(unmatchedItems);
        }
      }

      // Delivery charge
      if (data.deliveryCharge && data.deliveryCharge > 0) {
        setAiDeliveryCharge(data.deliveryCharge);
        filled.deliveryCharge = true;
      }

      setAiExtracted((prev) => ({ ...prev, ...filled }));
    } catch (err) {
      console.warn("[AI Extract] Exception:", err);
    } finally {
      setExtracting(false);
    }
  }, [editDeliveryDate, editItems]);

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

      // Update or create invoice (include delivery charge if detected)
      const invoiceAmount = editTotal + (aiDeliveryCharge || 0);

      if (editOrder.invoice) {
        const invoicePayload: Record<string, unknown> = {};
        if (editInvoiceNumber !== (editOrder.invoice.invoiceNumber ?? "")) {
          invoicePayload.invoiceNumber = editInvoiceNumber || null;
        }
        if (editInvoiceIssueDate !== (editOrder.invoice.issueDate ?? "")) {
          invoicePayload.issueDate = editInvoiceIssueDate || null;
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
      } else if (editInvoiceNumber || editInvoiceIssueDate || editInvoiceDueDate || editInvoiceFiles.length > 0) {
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
              issueDate: editInvoiceIssueDate || null,
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
    <div className="p-3 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Purchase Orders</h2>
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
      </div>

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

      {/* Edit Order Dialog */}
      <Dialog open={!!editOrder} onOpenChange={(open) => !open && setEditOrder(null)}>
        <DialogContent className={`max-h-[95vh] overflow-y-auto ${editOrder?.invoice && editOrder.invoice.photos.length > 0 ? "sm:max-w-[1400px] w-[95vw]" : "sm:max-w-3xl"}`}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {confirmOnSave ? <CheckCircle2 className="h-4 w-4 text-yellow-500" /> : <Pencil className="h-4 w-4" />}
              {confirmOnSave ? `Upload Invoice — ${editOrder?.orderNumber}` : `Edit ${editOrder?.orderNumber}`}
            </DialogTitle>
          </DialogHeader>

          {editOrder && (
            <div className={`flex gap-4 ${editOrder.invoice && editOrder.invoice.photos.length > 0 ? "" : ""}`}>
              {/* Left: Invoice image / PDF preview */}
              {editOrder.invoice && editOrder.invoice.photos.length > 0 && (
                <InvoicePreviewPane photos={editOrder.invoice.photos} />
              )}

              {/* Right: Form */}
              <div className="flex-1 space-y-4">
              {/* Supplier & Outlet info */}
              <div className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500">
                {editOrder.supplier} → {editOrder.outlet}
                {detectedSupplier && detectedSupplier.toLowerCase() !== editOrder.supplier.toLowerCase() && (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
                    AI detected: {detectedSupplier}
                  </span>
                )}
                {detectedSupplier && detectedSupplier.toLowerCase() === editOrder.supplier.toLowerCase() && (
                  <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-[9px] font-medium text-green-700">
                    ✓ Supplier matched
                  </span>
                )}
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
                      <CalendarDays className="h-3.5 w-3.5" /> Invoice Date
                      {aiExtracted.issueDate && <span className="ml-1 rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-medium text-purple-600">AI</span>}
                    </label>
                    <Input
                      type="date"
                      value={editInvoiceIssueDate}
                      onChange={(e) => { setEditInvoiceIssueDate(e.target.value); setAiExtracted((p) => { const n = { ...p }; delete n.issueDate; return n; }); }}
                      className={aiExtracted.issueDate ? "border-purple-300 bg-purple-50/30" : ""}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
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
                <div className="rounded-lg border overflow-hidden overflow-x-auto">
                  <table className="w-full text-xs min-w-[720px]">
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
                              <p className="text-[10px] text-gray-400">
                                {item.sku}
                                {item.notes === "Added from invoice" && <span className="ml-1 rounded bg-purple-100 px-1 py-0.5 text-[9px] font-medium text-purple-600">AI added</span>}
                              </p>
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
                      {aiDeliveryCharge != null && aiDeliveryCharge > 0 && (
                        <tr className="border-t border-gray-100">
                          <td colSpan={4} className="px-3 py-1.5 text-right text-gray-500">
                            Delivery Charge
                            <span className="ml-1 rounded bg-purple-100 px-1 py-0.5 text-[9px] font-medium text-purple-600">AI</span>
                          </td>
                          <td className="px-3 py-1.5 text-right text-gray-700">RM {aiDeliveryCharge.toFixed(2)}</td>
                          <td></td>
                        </tr>
                      )}
                      <tr className="border-t-2 border-gray-200 bg-gray-50">
                        <td colSpan={4} className="px-3 py-2 text-right font-semibold text-gray-700">Total</td>
                        <td className="px-3 py-2 text-right font-bold text-gray-900">RM {(editTotal + (aiDeliveryCharge || 0)).toFixed(2)}</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Unmatched items warning */}
                {aiUnmatched.length > 0 && (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    <p className="text-xs font-medium text-amber-700">Items on invoice not matched to order:</p>
                    <ul className="mt-1 space-y-0.5">
                      {aiUnmatched.map((item, i) => (
                        <li key={i} className="text-xs text-amber-600">• {item}</li>
                      ))}
                    </ul>
                    <p className="mt-1.5 text-[10px] text-amber-500">Add these items manually if needed, or update product catalog.</p>
                  </div>
                )}

              </div>

              {/* old invoice section removed - now at top */}
            </div>
          </div>
          )}

          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setEditOrder(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={editSaving || uploading} className={confirmOnSave ? "bg-yellow-500 hover:bg-yellow-600" : "bg-terracotta hover:bg-terracotta-dark"}>
              {editSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
              {confirmOnSave ? "Upload Invoice" : "Save Changes"}
            </Button>
            {editOrder && ["SENT", "APPROVED"].includes(editOrder.status) && (
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
                Upload Invoice &amp; Send
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
