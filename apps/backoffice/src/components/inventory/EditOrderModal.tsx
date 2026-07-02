"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@celsius/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  Pencil,
  Receipt,
  CalendarDays,
  Upload,
  X,
  Sparkles,
  Truck,
  Send,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────

export type OrderItem = {
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

export type Order = {
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

export type EditItem = OrderItem & { removed?: boolean; qtyStr: string; priceStr: string };

export type InvoiceFile = { url: string; type: "image" | "pdf"; name: string };

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

export function EditOrderModal({
  order,
  confirmMode = false,
  onClose,
  onSaved,
}: {
  order: Order | null;
  confirmMode?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Edit dialog state
  const [editItems, setEditItems] = useState<EditItem[]>([]);
  const [editDeliveryDate, setEditDeliveryDate] = useState("");
  const [editInvoiceNumber, setEditInvoiceNumber] = useState("");
  const [editInvoiceIssueDate, setEditInvoiceIssueDate] = useState("");
  const [editInvoiceDueDate, setEditInvoiceDueDate] = useState("");
  // Deposit override — empty string means "no deposit on this invoice".
  // Pre-filled from existing invoice value, falling back to the supplier
  // default (so Collective POs default to 10% even before an invoice
  // record exists).
  const [editDepositPercent, setEditDepositPercent] = useState("");
  const [editDepositTermsDays, setEditDepositTermsDays] = useState("");
  const [editInvoiceFiles, setEditInvoiceFiles] = useState<InvoiceFile[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [aiExtracted, setAiExtracted] = useState<Record<string, boolean>>({});
  const [confirmOnSave, setConfirmOnSave] = useState(false);
  const [detectedSupplier, setDetectedSupplier] = useState<string | null>(null);
  const [aiUnmatched, setAiUnmatched] = useState<string[]>([]);
  const [aiDeliveryCharge, setAiDeliveryCharge] = useState<number | null>(null);
  // Status-action row (Approve / Send / Cancel) — ports the lightweight PO
  // panel actions into this modal so a PO can be progressed without leaving
  // the edit view. Independent of the Save/Upload flow above.
  const [statusBusy, setStatusBusy] = useState(false);

  // Transition the order's status, then refresh + close. Surfaces the API
  // error inline (toast) and keeps the modal open on failure.
  const patchStatus = async (status: string) => {
    if (!order) return;
    setStatusBusy(true);
    try {
      const res = await fetch(`/api/inventory/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json?.error || `Status update failed (${res.status})`);
        return;
      }
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Status update failed");
    } finally {
      setStatusBusy(false);
    }
  };

  // Re-fire the WhatsApp send for a SENT-but-undelivered PO. Reports what actually happened —
  // block sent, cold prompt sent, or the template/OFF reason it didn't — so it's not a guess.
  // Keeps the modal open so the result toast is visible.
  const resendPo = async () => {
    if (!order) return;
    setStatusBusy(true);
    try {
      const res = await fetch(`/api/inventory/orders/${order.id}/resend-po`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json?.error || `Resend failed (${res.status})`);
        return;
      }
      if (json.ok) toast.success(json.message ?? "Re-sent to WhatsApp.");
      else toast.error(json.message ?? "Resend didn't deliver — check the template.");
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Resend failed");
    } finally {
      setStatusBusy(false);
    }
  };

  // Initialize the internal state from `order` (port of openEditDialog).
  // Keyed on order?.id so re-opening with a different order re-inits.
  useEffect(() => {
    if (!order) return;
    setConfirmOnSave(confirmMode);
    setDetectedSupplier(null);
    setAiUnmatched([]);
    // Pre-fill from saved value so re-opening the modal preserves the
    // delivery charge instead of forcing a re-extract.
    setAiDeliveryCharge(order.deliveryCharge > 0 ? order.deliveryCharge : null);
    setEditItems(order.items.map((i) => ({ ...i, removed: false, qtyStr: String(i.quantity), priceStr: i.unitPrice.toFixed(2) })));
    setEditDeliveryDate(order.deliveryDate ?? "");
    setEditInvoiceNumber(order.invoice?.invoiceNumber ?? "");
    setEditInvoiceIssueDate(order.invoice?.issueDate ?? "");
    setEditInvoiceDueDate(order.invoice?.dueDate ?? "");
    // Deposit pre-fill order: invoice override → supplier default → blank.
    // Once an invoice exists, its value is the source of truth; until then
    // we show the supplier default so Collective POs default to 10%.
    const initialPct =
      order.invoice?.depositPercent ?? order.supplierDepositPercent ?? null;
    const initialTerms =
      order.invoice?.depositTermsDays ?? order.supplierDepositTermsDays ?? null;
    setEditDepositPercent(initialPct != null ? String(initialPct) : "");
    setEditDepositTermsDays(initialTerms != null ? String(initialTerms) : "");
    setEditInvoiceFiles([]);
    setAiExtracted({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

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
  }, [editItems]);

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
              order?.supplier,
            );
          }
          return updated;
        });
      }
    } finally {
      setUploading(false);
    }
  }, [extractInvoiceData, order?.supplier]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
    files.forEach(uploadFile);
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

  const saveEdit = async (): Promise<boolean> => {
    if (!order) return false;
    setEditSaving(true);
    try {
      // Build item changes
      const itemChanges = editItems
        .filter((i) => {
          if (i.removed) return true;
          const origItem = order.items.find((o) => o.id === i.id);
          if (!origItem) return false;
          return parseFloat(i.qtyStr) !== origItem.quantity || parseFloat(i.priceStr) !== origItem.unitPrice;
        })
        .map((i) => i.removed
          ? { id: i.id, remove: true }
          : { id: i.id, quantity: parseFloat(i.qtyStr) || 0, unitPrice: parseFloat(i.priceStr) || 0 }
        );

      // Update order (items + delivery date + delivery charge). Sending
      // deliveryCharge tells the API to recompute totalAmount = items +
      // charge so the PO list shows the full obligation, not just items.
      const orderPayload: Record<string, unknown> = {};
      if (itemChanges.length > 0) orderPayload.items = itemChanges;
      if (editDeliveryDate !== (order.deliveryDate ?? "")) {
        orderPayload.deliveryDate = editDeliveryDate || null;
      }
      const newDeliveryCharge = aiDeliveryCharge ?? 0;
      if (newDeliveryCharge !== order.deliveryCharge) {
        orderPayload.deliveryCharge = newDeliveryCharge;
      }
      if (Object.keys(orderPayload).length > 0) {
        const r = await fetch(`/api/inventory/orders/${order.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(orderPayload),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          toast.error(err?.error || `Order save failed (${r.status})`);
          // Stop here — invoice update would race against an order in an
          // unknown state.
          return false;
        }
      }

      // Update or create invoice (include delivery charge if detected)
      const invoiceAmount = editTotal + (aiDeliveryCharge || 0);

      // Parse deposit fields once — empty → null (clears override).
      const parsedDepositPercent =
        editDepositPercent.trim() === ""
          ? null
          : Number.isFinite(parseFloat(editDepositPercent))
            ? Math.round(parseFloat(editDepositPercent))
            : null;
      const parsedDepositTerms =
        editDepositTermsDays.trim() === ""
          ? null
          : Number.isFinite(parseFloat(editDepositTermsDays))
            ? Math.round(parseFloat(editDepositTermsDays))
            : null;

      if (order.invoice) {
        const invoicePayload: Record<string, unknown> = {};
        if (editInvoiceNumber !== (order.invoice.invoiceNumber ?? "")) {
          invoicePayload.invoiceNumber = editInvoiceNumber || null;
        }
        if (editInvoiceIssueDate !== (order.invoice.issueDate ?? "")) {
          invoicePayload.issueDate = editInvoiceIssueDate || null;
        }
        if (editInvoiceDueDate !== (order.invoice.dueDate ?? "")) {
          invoicePayload.dueDate = editInvoiceDueDate || null;
        }
        // Mirror the delivery date onto the invoice so reconciliation +
        // future receivings flow have the actual-arrival date attached to
        // the document that triggers payment.
        if (editDeliveryDate !== (order.invoice.deliveryDate ?? "")) {
          invoicePayload.deliveryDate = editDeliveryDate || null;
        }
        if (invoiceAmount !== order.invoice.amount) {
          invoicePayload.amount = invoiceAmount;
        }
        if (parsedDepositPercent !== (order.invoice.depositPercent ?? null)) {
          invoicePayload.depositPercent = parsedDepositPercent;
        }
        if (parsedDepositTerms !== (order.invoice.depositTermsDays ?? null)) {
          invoicePayload.depositTermsDays = parsedDepositTerms;
        }
        if (editInvoiceFiles.length > 0) {
          // Fetch existing photos and append new ones
          const invRes = await fetch(`/api/inventory/invoices/${order.invoice.id}`);
          const invData = invRes.ok ? await invRes.json() : { photos: [] };
          invoicePayload.photos = [...(invData.photos || []), ...editInvoiceFiles.map((f) => f.url)];
        }
        if (Object.keys(invoicePayload).length > 0) {
          const r = await fetch(`/api/inventory/invoices/${order.invoice.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(invoicePayload),
          });
          if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            toast.error(err?.error || `Invoice save failed (${r.status})`);
            return false; // keep the modal open so the user can retry
          }
        }
      } else if (editInvoiceNumber || editInvoiceIssueDate || editInvoiceDueDate || editInvoiceFiles.length > 0) {
        const detailRes = await fetch(`/api/inventory/orders/${order.id}`);
        if (!detailRes.ok) {
          toast.error("Could not load order detail to attach invoice");
          return false;
        }
        const detail = await detailRes.json();
        const r = await fetch("/api/inventory/invoices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: order.id,
            outletId: detail.outletId,
            supplierId: detail.supplierId,
            amount: invoiceAmount,
            invoiceNumber: editInvoiceNumber || null,
            issueDate: editInvoiceIssueDate || null,
            dueDate: editInvoiceDueDate || null,
            deliveryDate: editDeliveryDate || null,
            depositPercent: parsedDepositPercent,
            depositTermsDays: parsedDepositTerms,
            photos: editInvoiceFiles.map((f) => f.url),
          }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          toast.error(err?.error || `Invoice create failed (${r.status})`);
          return false;
        }
      }

      toast.success("Saved");
      onSaved();
      onClose();
      return true;
    } catch (err) {
      console.error("[orders save] exception:", err);
      toast.error(err instanceof Error ? err.message : "Save failed unexpectedly");
      return false;
    } finally {
      setEditSaving(false);
    }
  };

  // Confirm-and-send flow: validate, save, then transition to AWAITING_DELIVERY.
  // Mirrors the original inline "Upload Invoice & Send" button which called
  // saveEdit() followed by updateStatus(order.id, "AWAITING_DELIVERY"). saveEdit
  // closes the modal on success, so the status PATCH is fired independently.
  const uploadInvoiceAndSend = async () => {
    if (!order) return;
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
    await fetch(`/api/inventory/orders/${order.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "AWAITING_DELIVERY" }),
    });
    onSaved();
  };

  return (
    <Dialog open={!!order} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className={`max-h-[95vh] overflow-y-auto ${order?.invoice && order.invoice.photos.length > 0 ? "sm:max-w-[1400px] w-[95vw]" : "sm:max-w-3xl"}`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {confirmOnSave ? <CheckCircle2 className="h-4 w-4 text-yellow-500" /> : <Pencil className="h-4 w-4" />}
            {confirmOnSave ? `Upload Invoice — ${order?.orderNumber}` : `Edit ${order?.orderNumber}`}
          </DialogTitle>
        </DialogHeader>

        {order && (
          <div className={`flex gap-4 ${order.invoice && order.invoice.photos.length > 0 ? "" : ""}`}>
            {/* Left: Invoice image / PDF preview */}
            {order.invoice && order.invoice.photos.length > 0 && (
              <InvoicePreviewPane photos={order.invoice.photos} />
            )}

            {/* Right: Form */}
            <div className="flex-1 space-y-4">
            {/* Supplier & Outlet info */}
            <div className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500">
              {order.supplier} → {order.outlet}
              {detectedSupplier && detectedSupplier.toLowerCase() !== order.supplier.toLowerCase() && (
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
                  AI detected: {detectedSupplier}
                </span>
              )}
              {detectedSupplier && detectedSupplier.toLowerCase() === order.supplier.toLowerCase() && (
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
                {order.invoice && (
                  <Badge className="ml-1 text-[9px] bg-gray-400">{order.invoice.invoiceNumber}</Badge>
                )}
                {!order.invoice && (
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
                    {order.status === "SENT" && <span className="text-red-500">*</span>}
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
                {order.status === "SENT" && <span className="text-red-500">*</span>}
                {aiExtracted.deliveryDate && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-medium text-purple-600">AI</span>}
              </label>
              <Input
                type="date"
                value={editDeliveryDate}
                onChange={(e) => setEditDeliveryDate(e.target.value)}
              />
            </div>

            {/* Deposit panel — set per-invoice. Pre-filled from supplier
                default; clear the % to disable deposit on this invoice. */}
            {(() => {
              const invoiceTotal = editTotal + (aiDeliveryCharge || 0);
              const pct = parseFloat(editDepositPercent);
              const validPct = Number.isFinite(pct) && pct > 0;
              const depAmt = validPct && invoiceTotal > 0
                ? Math.round((invoiceTotal * pct / 100) * 100) / 100
                : 0;
              const balance = validPct && invoiceTotal > 0
                ? Math.round((invoiceTotal - depAmt) * 100) / 100
                : invoiceTotal;
              const depositAlreadyPaid = !!order.invoice?.depositPaidAt;
              return (
                <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                  <p className="mb-2 text-xs font-semibold text-amber-900">Deposit (optional)</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-amber-900/80">Deposit %</label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        placeholder="e.g. 10"
                        value={editDepositPercent}
                        onChange={(e) => setEditDepositPercent(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-amber-900/80">Balance due (days)</label>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="e.g. 21"
                        value={editDepositTermsDays}
                        onChange={(e) => setEditDepositTermsDays(e.target.value)}
                      />
                    </div>
                  </div>
                  {validPct && invoiceTotal > 0 ? (
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded bg-white px-2 py-1.5">
                        <span className="text-amber-700">Deposit ({pct}%)</span>
                        <p className="font-semibold text-amber-900">RM {depAmt.toFixed(2)}</p>
                      </div>
                      <div className="rounded bg-white px-2 py-1.5">
                        <span className="text-amber-700">Balance</span>
                        <p className="font-semibold text-amber-900">RM {balance.toFixed(2)}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1.5 text-[11px] text-amber-800/70">
                      Leave % blank for full payment. Set % to require a deposit before delivery — system splits the invoice into Pay Deposit + Pay Balance.
                    </p>
                  )}
                  {depositAlreadyPaid && (
                    <p className="mt-2 text-[11px] text-amber-700">
                      Deposit already paid on {new Date(order.invoice!.depositPaidAt!).toLocaleDateString("en-MY")}. Editing the % won&apos;t reverse that — only adjusts what&apos;s recorded.
                    </p>
                  )}
                </div>
              );
            })()}

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

        {/* Status actions — progress the PO (approve / send / receive / cancel)
            without leaving the edit modal. Ported from the supplier-chats
            poView panel. */}
        {order && (order.status !== "COMPLETED" && order.status !== "CANCELLED") && (
          <div className="flex flex-wrap gap-2 border-t pt-3">
            {(order.status === "DRAFT" || order.status === "PENDING_APPROVAL") && (
              <Button
                onClick={() => patchStatus("APPROVED")}
                disabled={statusBusy || editSaving || uploading}
                className="bg-primary hover:bg-primary/90"
              >
                {statusBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                Approve
              </Button>
            )}
            {order.status === "APPROVED" && (
              <Button
                onClick={() => patchStatus("SENT")}
                disabled={statusBusy || editSaving || uploading}
                className="bg-primary hover:bg-primary/90"
              >
                {statusBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
                Send to supplier
              </Button>
            )}
            {["SENT", "CONFIRMED", "AWAITING_DELIVERY"].includes(order.status) && (
              <Button
                onClick={resendPo}
                disabled={statusBusy || editSaving || uploading}
                className="border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                title="Re-fire the WhatsApp send for this PO (use if it never reached the supplier)"
              >
                {statusBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
                Resend to WhatsApp
              </Button>
            )}
            {["SENT", "CONFIRMED", "AWAITING_DELIVERY", "PARTIALLY_RECEIVED"].includes(order.status) && (
              <a href="/inventory/receivings" className={buttonVariants({ variant: "outline" })}>
                <Truck className="mr-1.5 h-4 w-4" />
                Record delivery
              </a>
            )}
            <Button
              variant="outline"
              onClick={() => {
                if (window.confirm(`Cancel order ${order.orderNumber}? This can't be undone.`)) {
                  void patchStatus("CANCELLED");
                }
              }}
              disabled={statusBusy || editSaving || uploading}
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              {statusBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Cancel order
            </Button>
          </div>
        )}

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={saveEdit} disabled={editSaving || uploading} className={confirmOnSave ? "bg-yellow-500 hover:bg-yellow-600" : "bg-terracotta hover:bg-terracotta-dark"}>
            {editSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
            {confirmOnSave ? "Upload Invoice" : "Save Changes"}
          </Button>
          {order && ["SENT", "APPROVED"].includes(order.status) && (
            <Button
              disabled={editSaving || uploading}
              className="bg-purple-500 hover:bg-purple-600"
              onClick={uploadInvoiceAndSend}
            >
              {editSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Truck className="mr-1.5 h-4 w-4" />}
              Upload Invoice &amp; Send
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
