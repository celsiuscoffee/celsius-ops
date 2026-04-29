"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useFetch } from "@/lib/use-fetch";
import { FileText, Search, Download, Eye, Image as ImageIcon, Loader2, CheckCircle2, Clock, AlertTriangle, Filter, X, CalendarDays, Building2, ZoomIn, Pencil, Upload, Trash2, FileDown, DollarSign, Landmark, Copy, Check } from "lucide-react";

const isPdf = (url: string) => /\.pdf($|\?)/i.test(url);
const fixImageUrl = (url: string) => url.replace("/raw/upload/", "/image/upload/");

/** Try to render as image; if it fails (e.g. raw PDF without extension), fall back to iframe */
function SmartPhoto({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  // For Cloudinary raw URLs, try image delivery path
  const imgUrl = url.replace("/raw/upload/", "/image/upload/");
  if (failed || isPdf(url)) {
    return (
      <div className="overflow-hidden rounded-lg border border-gray-200 flex flex-col flex-1 min-h-0">
        <iframe src={url} className="flex-1 w-full min-h-[75vh]" title={alt} />
        <div className="flex items-center justify-between border-t bg-gray-50 px-3 py-1.5 shrink-0">
          <span className="flex items-center gap-1.5 text-xs text-gray-500"><FileDown className="h-3.5 w-3.5" />Document</span>
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-blue-600 hover:text-blue-700">Open in new tab &rarr;</a>
        </div>
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="group relative block overflow-hidden rounded-lg border border-gray-200 hover:border-blue-300">
      <img src={imgUrl} alt={alt} className="h-auto w-full object-contain" onError={() => setFailed(true)} />
      <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/10 group-hover:opacity-100">
        <ZoomIn className="h-6 w-6 text-white drop-shadow-md" />
      </div>
    </a>
  );
}

type Invoice = {
  id: string;
  invoiceNumber: string;
  poNumber: string;
  outlet: string;
  supplier: string;
  amount: number;
  status: string;
  issueDate: string;
  dueDate: string | null;
  hasPhoto: boolean;
  photoCount: number;
  photos: string[];
  paymentType: string;
  claimedBy: string | null;
  notes: string | null;
  paidAt: string | null;
  paidVia: string | null;
  paymentRef: string | null;
  popShortLink: string | null;
  supplierPhone: string | null;
  supplierBank: { bankName: string; accountNumber: string | null; accountName: string | null } | null;
  claimantBank: { bankName: string; accountNumber: string | null; accountName: string | null } | null;
  vendorName: string | null;
  vendorBank: { bankName: string; accountNumber: string | null; accountName: string | null } | null;
  expenseCategory: "INGREDIENT" | "ASSET" | "MAINTENANCE" | "OTHER";
  orderType: string | null;
  transfer: { fromOutlet: string; toOutlet: string; items: { product: string; quantity: number }[] } | null;
  depositPercent: number | null;
  depositAmount: number | null;
  depositPaidAt: string | null;
  depositRef: string | null;
  flags: InvoiceFlag[];
};

type InvoiceFlagCode =
  | "DUPLICATE_PO"
  | "DUPLICATE_PAYMENT_REF"
  | "REF_MATCHES_PAID_INVOICE"
  | "AMOUNT_TOLERANCE_MATCH"
  | "BANK_MISMATCH";

type InvoiceFlag = {
  code: InvoiceFlagCode;
  message: string;
  detectedAt: string;
  dismissed?: boolean;
  dismissedAt?: string;
  dismissedById?: string;
  meta?: Record<string, unknown>;
};

const FLAG_TITLE: Record<InvoiceFlagCode, string> = {
  DUPLICATE_PO: "Duplicate PO",
  DUPLICATE_PAYMENT_REF: "Payment ref already used",
  REF_MATCHES_PAID_INVOICE: "Reference matches paid invoice",
  AMOUNT_TOLERANCE_MATCH: "Amount matched only within tolerance",
  BANK_MISMATCH: "POP bank ≠ supplier bank",
};

const activeFlags = (inv: Pick<Invoice, "flags">) => (inv.flags ?? []).filter((f) => !f.dismissed);

type OutletOption = { id: string; name: string };
type SummaryBucket = { count: number; amount: number };
type InvoicesSummary = {
  total: SummaryBucket;
  payable: SummaryBucket;
  overdue: SummaryBucket;
  initiated: SummaryBucket;
  paid: SummaryBucket;
  dueToday: SummaryBucket;
};
type InvoicesResponse = {
  invoices: Invoice[];
  outlets: OutletOption[];
  dueTodayCount: number;
  dueTodayAmount: number;
  summary?: InvoicesSummary;
};

export default function InvoicesPage() {
  const [tab, setTab] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [outletFilter, setOutletFilter] = useState<string[]>([]);
  const [bankFilter, setBankFilter] = useState<"all" | "maybank" | "non-maybank">("all");
  const [dueDateFrom, setDueDateFrom] = useState("");
  const [dueDateTo, setDueDateTo] = useState("");
  const [paidDateFrom, setPaidDateFrom] = useState("");
  const [paidDateTo, setPaidDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [viewingPhotos, setViewingPhotos] = useState<{ invoiceNumber: string; photos: string[] } | null>(null);
  const [cardFilter, setCardFilter] = useState<"all" | "pending" | "overdue" | "initiated" | "paid" | "due_today" | "payable" | null>(null);
  const [batchInitiating, setBatchInitiating] = useState(false);

  // Payment dialog
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
  const [payingTargetStatus, setPayingTargetStatus] = useState<string>("");
  const [payForm, setPayForm] = useState({ paidVia: "", paymentRef: "" });
  const [paySaving, setPaySaving] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [payReceipts, setPayReceipts] = useState<string[]>([]);
  const [payUploading, setPayUploading] = useState(false);

  // Send POP shortlink
  const [sendingPopId, setSendingPopId] = useState<string | null>(null);

  // Flag review dialog
  const [reviewingFlags, setReviewingFlags] = useState<Invoice | null>(null);
  const [flagActionCode, setFlagActionCode] = useState<InvoiceFlagCode | null>(null);

  // Edit invoice dialog
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [editForm, setEditForm] = useState({ invoiceNumber: "", issueDate: "", dueDate: "", notes: "", amount: "" });
  const [editPhotos, setEditPhotos] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [editUploading, setEditUploading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams({ tab, type: typeFilter });
  if (debouncedSearch) params.set("search", debouncedSearch);
  outletFilter.forEach((id) => params.append("outlet", id));
  if (dueDateFrom) params.set("dueDateFrom", dueDateFrom);
  if (dueDateTo) params.set("dueDateTo", dueDateTo);
  if (paidDateFrom) params.set("paidDateFrom", paidDateFrom);
  if (paidDateTo) params.set("paidDateTo", paidDateTo);
  // cardFilter is server-side now — without this, picking "Due Today"
  // would show 0 rows because the unpaid-due-today set sits past the
  // paginated 200-row cutoff. Server narrows the result to the right
  // bucket regardless of which tab is active.
  if (cardFilter && cardFilter !== "all") params.set("cardFilter", cardFilter);

  const url = `/api/inventory/invoices?${params.toString()}`;
  const { data, isLoading: loading, mutate: loadInvoices } = useFetch<InvoicesResponse>(url);
  const allInvoices = data?.invoices ?? [];
  const outletOptions = data?.outlets ?? [];
  const dueTodayCount = data?.dueTodayCount ?? 0;
  const dueTodayAmount = data?.dueTodayAmount ?? 0;

  const today = new Date().toISOString().split("T")[0];

  // Bank filter is still applied client-side (it's a free-text contains check
  // on supplier/claimant bank names — not worth a server roundtrip). cardFilter
  // is handled by the API now, so it's dropped from the local filter.
  const invoices = allInvoices.filter((inv) => {
    // Bank filter: use claimant bank for STAFF_CLAIM, supplier bank otherwise
    const bankName = (inv.paymentType === "STAFF_CLAIM" ? inv.claimantBank : inv.supplierBank)?.bankName?.toLowerCase() ?? "";
    if (bankFilter === "maybank" && !bankName.includes("maybank")) return false;
    if (bankFilter === "non-maybank" && bankName.includes("maybank")) return false;
    return true;
  });

  const activeFilterCount = [outletFilter.length > 0, bankFilter !== "all", dueDateFrom, dueDateTo, paidDateFrom, paidDateTo].filter(Boolean).length;

  const openPayDialog = (inv: Invoice, targetStatus: string) => {
    setPayingInvoice(inv);
    setPayingTargetStatus(targetStatus);
    setPayForm({ paidVia: "", paymentRef: "" });
    setPayReceipts([]);
    setCopiedField(null);
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handlePayReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setPayUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("folder", "invoices");
        const res = await fetch("/api/inventory/upload", { method: "POST", body: formData });
        if (res.ok) {
          const data = await res.json();
          const isPdf = file.type === "application/pdf" || data.url?.endsWith(".pdf");

          // Auto-split multi-page PDFs so each invoice gets only its relevant page
          if (isPdf) {
            try {
              const splitRes = await fetch(`/api/inventory/split-pop?url=${encodeURIComponent(data.url)}`);
              const { pageCount } = await splitRes.json();
              if (pageCount > 1) {
                // Extract just page 1 for this invoice (user can change later)
                const extractRes = await fetch("/api/inventory/split-pop", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ url: data.url, page: 1 }),
                });
                if (extractRes.ok) {
                  const { url: pageUrl } = await extractRes.json();
                  setPayReceipts((prev) => [...prev, pageUrl]);
                  continue;
                }
              }
            } catch { /* Fall through to use full URL */ }
          }

          setPayReceipts((prev) => [...prev, data.url]);
        }
      }
    } catch { /* ignore */ }
    setPayUploading(false);
    e.target.value = "";
  };

  const submitPayment = async () => {
    if (!payingInvoice) return;
    setPaySaving(true);
    try {
      const res = await fetch(`/api/inventory/invoices/${payingInvoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: payingTargetStatus,
          ...(payForm.paymentRef ? {
            // For deposit payment, store ref in depositRef; for balance/full, in paymentRef
            ...(payingTargetStatus === "DEPOSIT_PAID" ? { depositRef: payForm.paymentRef } : { paymentRef: payForm.paymentRef }),
          } : {}),
          ...(payReceipts.length > 0 ? { photos: [...(payingInvoice.photos || []), ...payReceipts] } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Failed: ${err.error || res.statusText}`);
        return;
      }
      setPayingInvoice(null);
      await loadInvoices(undefined, { revalidate: true });
    } catch {
      alert("Network error");
    } finally {
      setPaySaving(false);
    }
  };

  const updateStatus = async (invoiceId: string, newStatus: string, inv?: Invoice) => {
    // Open payment dialog for INITIATED or PAID transitions
    if (inv && (newStatus === "INITIATED" || newStatus === "PAID")) {
      openPayDialog(inv, newStatus);
      return;
    }
    setUpdatingId(invoiceId);
    try {
      const res = await fetch(`/api/inventory/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Failed to update status: ${err.error || res.statusText}`);
        return;
      }
      await loadInvoices(undefined, { revalidate: true });
    } catch (err) {
      alert("Network error updating status");
    } finally {
      setUpdatingId(null);
    }
  };

  const openEdit = (inv: Invoice) => {
    setEditingInvoice(inv);
    setEditForm({
      invoiceNumber: inv.invoiceNumber,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate ?? "",
      notes: inv.notes ?? "",
      amount: inv.amount.toFixed(2),
    });
    setEditPhotos(inv.photos);
  };

  const handleEditPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setEditUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("folder", "invoices");
        const res = await fetch("/api/inventory/upload", { method: "POST", body: formData });
        if (res.ok) {
          const data = await res.json();
          setEditPhotos((prev) => [...prev, data.url]);
        }
      }
    } catch { /* ignore */ }
    setEditUploading(false);
    e.target.value = "";
  };

  const saveEdit = async () => {
    if (!editingInvoice) return;
    setEditSaving(true);
    try {
      await fetch(`/api/inventory/invoices/${editingInvoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceNumber: editForm.invoiceNumber,
          issueDate: editForm.issueDate || null,
          dueDate: editForm.dueDate || null,
          notes: editForm.notes || null,
          amount: parseFloat(editForm.amount) || editingInvoice.amount,
          photos: editPhotos,
        }),
      });
      setEditingInvoice(null);
      loadInvoices(undefined, { revalidate: true });
    } finally {
      setEditSaving(false);
    }
  };

  const dismissFlag = async (invoiceId: string, code: InvoiceFlagCode) => {
    setFlagActionCode(code);
    try {
      const res = await fetch(`/api/inventory/invoices/${invoiceId}/flags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss", code }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Failed: ${err.error || res.statusText}`);
        return;
      }
      await loadInvoices(undefined, { revalidate: true });
      // Update the open dialog from the refreshed list
      setReviewingFlags((prev) => {
        if (!prev) return prev;
        const refreshed = (data?.invoices ?? []).find((i) => i.id === prev.id);
        return refreshed ?? prev;
      });
    } finally {
      setFlagActionCode(null);
    }
  };

  const batchInitiateDueToday = async () => {
    const dueTodayUnpaid = allInvoices.filter((inv) => inv.dueDate === today && (inv.status === "PENDING" || inv.status === "OVERDUE"));
    if (dueTodayUnpaid.length === 0) return;
    if (!confirm(`Initiate payment for ${dueTodayUnpaid.length} invoice${dueTodayUnpaid.length > 1 ? "s" : ""} due today?`)) return;
    setBatchInitiating(true);
    try {
      for (const inv of dueTodayUnpaid) {
        await fetch(`/api/inventory/invoices/${inv.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "INITIATED" }),
        });
      }
      await loadInvoices(undefined, { revalidate: true });
    } finally {
      setBatchInitiating(false);
    }
  };

  // Summary cards come from a server-side aggregate over the full invoice
  // table. Computing from `allInvoices` here would silently understate
  // anything when the API truncates at the 200-row pagination limit
  // (e.g. once PAID grows past 200, Payable/Overdue collapsed to zero
  // even when work was outstanding). Falls back to the loaded subset
  // only when the API hasn't been redeployed yet.
  const summary = data?.summary;
  const totalAll = summary?.total.amount ?? allInvoices.reduce((a, i) => a + i.amount, 0);
  const totalAllCount = summary?.total.count ?? allInvoices.length;
  const totalPayable = summary?.payable.amount ?? allInvoices.filter((i) => i.status !== "PAID").reduce((a, i) => a + i.amount, 0);
  const payableCount = summary?.payable.count ?? allInvoices.filter((i) => i.status !== "PAID").length;
  const totalOverdue = summary?.overdue.amount ?? allInvoices.filter((i) => i.status === "OVERDUE").reduce((a, i) => a + i.amount, 0);
  const overdueCount = summary?.overdue.count ?? allInvoices.filter((i) => i.status === "OVERDUE").length;
  const totalInitiated = summary?.initiated.amount ?? allInvoices.filter((i) => i.status === "INITIATED").reduce((a, i) => a + i.amount, 0);
  const initiatedCount = summary?.initiated.count ?? allInvoices.filter((i) => i.status === "INITIATED").length;
  const totalPaid = summary?.paid.amount ?? allInvoices.filter((i) => i.status === "PAID").reduce((a, i) => a + i.amount, 0);
  const paidCount = summary?.paid.count ?? allInvoices.filter((i) => i.status === "PAID").length;

  const statusLabel = (status: string, paymentType: string) => {
    // Staff claims used to show "approved"/"reimbursed" — unified with supplier
    // and vendor-request flows, all now read "initiated"/"paid".
    if (paymentType === "INTERNAL_TRANSFER") {
      if (status === "PAID") return "settled";
    }
    if (status === "DEPOSIT_PAID") return "deposit paid";
    return status.toLowerCase();
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "PAID": return "bg-green-500";
      case "INITIATED": return "bg-blue-500";
      case "PENDING": return "bg-terracotta";
      case "DEPOSIT_PAID": return "bg-amber-500";
      case "OVERDUE": return "bg-red-500";
      case "DRAFT": return "bg-gray-400";
      default: return "bg-gray-400";
    }
  };

  const getActions = (inv: Invoice) => {
    const { status, paymentType, depositPercent } = inv;
    const isTransfer = paymentType === "INTERNAL_TRANSFER";
    const hasDeposit = depositPercent && depositPercent > 0;
    const depositAmt = inv.depositAmount ?? Math.round(inv.amount * (depositPercent || 0) / 100 * 100) / 100;
    const balanceAmt = Math.round((inv.amount - depositAmt) * 100) / 100;

    // Unified action labels — "Initiate Payment" / "Mark Paid" everywhere,
    // except internal transfers which use "Initiate Settlement" / "Mark Settled".
    const initiateLabel = isTransfer ? "Initiate Settlement" : "Initiate Payment";
    const paidLabel = isTransfer ? "Mark Settled" : "Mark Paid";
    switch (status) {
      case "PENDING": return [
        { status: "INITIATED", label: initiateLabel, color: "bg-blue-500 hover:bg-blue-600" },
      ];
      case "INITIATED": {
        if (hasDeposit) {
          return [
            { status: "DEPOSIT_PAID", label: `Pay Deposit (RM ${depositAmt.toFixed(2)})`, color: "bg-amber-500 hover:bg-amber-600" },
            { status: "PAID", label: `Pay Full (RM ${inv.amount.toFixed(2)})`, color: "bg-green-500 hover:bg-green-600" },
          ];
        }
        return [
          { status: "PAID", label: paidLabel, color: "bg-green-500 hover:bg-green-600" },
        ];
      }
      case "DEPOSIT_PAID": return [
        { status: "PAID", label: `Pay Balance (RM ${balanceAmt.toFixed(2)})`, color: "bg-green-500 hover:bg-green-600" },
      ];
      case "OVERDUE": return [
        { status: "INITIATED", label: initiateLabel, color: "bg-blue-500 hover:bg-blue-600" },
        { status: "PAID", label: paidLabel, color: "bg-green-500 hover:bg-green-600" },
      ];
      case "PAID": return [];
      default: return [];
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
    <div className="p-3 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Invoices</h2>
          <p className="mt-0.5 text-xs sm:text-sm text-gray-500">{invoices.length} invoices &middot; Track and reconcile supplier invoices</p>
        </div>
      </div>

      {/* Summary cards — clickable to filter */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        {([
          { key: "all" as const, label: "Total", amount: totalAll, count: totalAllCount, color: "text-gray-900", border: "border-gray-300", ring: "ring-gray-200" },
          { key: "payable" as const, label: "Payable", amount: totalPayable, count: payableCount, color: payableCount > 0 ? "text-orange-600" : "text-gray-400", border: "border-orange-400", ring: "ring-orange-100" },
          { key: "due_today" as const, label: "Due Today", amount: dueTodayAmount, count: dueTodayCount, color: dueTodayCount > 0 ? "text-blue-600" : "text-gray-400", border: "border-blue-400", ring: "ring-blue-100" },
          { key: "initiated" as const, label: "Initiated", amount: totalInitiated, count: initiatedCount, color: initiatedCount > 0 ? "text-indigo-600" : "text-gray-400", border: "border-indigo-400", ring: "ring-indigo-100" },
          { key: "overdue" as const, label: "Overdue", amount: totalOverdue, count: overdueCount, color: overdueCount > 0 ? "text-red-600" : "text-gray-400", border: "border-red-400", ring: "ring-red-100" },
          { key: "paid" as const, label: "Paid", amount: totalPaid, count: paidCount, color: "text-green-600", border: "border-green-400", ring: "ring-green-100" },
        ]).map((card) => (
          <button
            key={card.key}
            onClick={() => setCardFilter(cardFilter === card.key ? null : card.key)}
            className={`rounded-lg border bg-white px-3 py-2.5 text-left transition-all hover:shadow-sm ${
              cardFilter === card.key
                ? `${card.border} ring-2 ${card.ring} shadow-sm`
                : card.key === "due_today" && card.count > 0
                  ? "border-blue-200 bg-blue-50/50 hover:border-blue-300"
                  : card.key === "payable" && card.count > 0
                  ? "border-orange-200 bg-orange-50/50 hover:border-orange-300"
                  : "border-gray-200 hover:border-gray-300"
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">{card.label}</p>
              {card.count > 0 && card.key !== "all" && (
                <span className={`flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-white ${
                  card.key === "payable" ? "bg-orange-500" : card.key === "due_today" ? "bg-blue-500" : card.key === "overdue" ? "bg-red-500" : card.key === "initiated" ? "bg-indigo-500" : "bg-green-500"
                }`}>
                  {card.count}
                </span>
              )}
            </div>
            <p className={`text-lg font-bold ${card.color}`}>RM {card.amount.toFixed(2)}</p>
            {card.key === "due_today" && card.count > 0 && cardFilter === "due_today" && (
              <div
                onClick={(e) => { e.stopPropagation(); batchInitiateDueToday(); }}
                className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-md bg-blue-500 px-2 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600"
              >
                {batchInitiating ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    <DollarSign className="h-3 w-3" />
                    Initiate All Payments
                  </>
                )}
              </div>
            )}
          </button>
        ))}
      </div>
      {cardFilter && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-gray-500">
            Showing: <span className="font-medium text-gray-700">{cardFilter === "due_today" ? "Due Today" : cardFilter === "payable" ? "Payable" : cardFilter === "all" ? "All" : cardFilter.charAt(0).toUpperCase() + cardFilter.slice(1)}</span>
            {" "}({invoices.length} invoice{invoices.length !== 1 ? "s" : ""})
          </span>
          <button onClick={() => setCardFilter(null)} className="flex items-center gap-0.5 rounded-full border border-gray-200 px-2 py-0.5 text-[10px] text-gray-500 hover:bg-gray-50">
            <X className="h-3 w-3" /> Clear
          </button>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <div className="relative w-full sm:flex-1 sm:min-w-[200px] sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Search invoices..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0 sm:pb-0">
          {([["unpaid", "Unpaid"], ["paid", "Paid"], ["all", "All"]] as const).map(([value, label]) => (
            <button key={value} onClick={() => setTab(value)} className={`shrink-0 rounded-full border px-3 py-1 text-xs transition-colors ${tab === value ? "border-terracotta bg-terracotta/5 text-terracotta-dark" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>{label}</button>
          ))}
        </div>
        <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0 sm:pb-0">
          {([["all", "All Types"], ["supplier", "Supplier"], ["staff_claim", "Staff Claims"], ["payment_request", "Payment Requests"], ["transfer", "Transfers"]] as const).map(([value, label]) => (
            <button key={value} onClick={() => setTypeFilter(value)} className={`shrink-0 rounded-full border px-3 py-1 text-xs transition-colors ${typeFilter === value ? "border-purple-400 bg-purple-50 text-purple-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>{label}</button>
          ))}
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`relative flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${showFilters || activeFilterCount > 0 ? "border-blue-400 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}
        >
          <Filter className="h-3 w-3" />
          Filters
          {activeFilterCount > 0 && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">{activeFilterCount}</span>
          )}
        </button>
        {activeFilterCount > 0 && (
          <button
            onClick={() => { setOutletFilter([]); setBankFilter("all"); setDueDateFrom(""); setDueDateTo(""); }}
            className="flex items-center gap-1 rounded-full border border-gray-200 px-2 py-1 text-[10px] text-gray-500 hover:bg-gray-50"
          >
            <X className="h-3 w-3" /> Clear filters
          </button>
        )}
      </div>

      {/* Expanded filter panel */}
      {showFilters && (
        <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/30 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Outlets — multi-select */}
            <div>
              <label className="mb-1.5 flex items-center gap-1 text-xs font-medium text-gray-600">
                <Building2 className="h-3 w-3" /> Outlets
                {outletFilter.length > 0 && (
                  <button onClick={() => setOutletFilter([])} className="ml-auto text-[10px] text-blue-500 hover:underline">Clear</button>
                )}
              </label>
              <div className="max-h-[140px] overflow-y-auto rounded-md border border-gray-200 bg-white p-1.5 space-y-0.5">
                {outletOptions.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 rounded px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={outletFilter.includes(o.id)}
                      onChange={(e) => {
                        if (e.target.checked) setOutletFilter((prev) => [...prev, o.id]);
                        else setOutletFilter((prev) => prev.filter((id) => id !== o.id));
                      }}
                      className="rounded border-gray-300 text-blue-500 focus:ring-blue-400 h-3.5 w-3.5"
                    />
                    {o.name}
                  </label>
                ))}
              </div>
            </div>

            {/* Bank filter */}
            <div>
              <label className="mb-1.5 flex items-center gap-1 text-xs font-medium text-gray-600">
                <Landmark className="h-3 w-3" /> Bank
              </label>
              <div className="flex flex-col gap-1 rounded-md border border-gray-200 bg-white p-1.5">
                {([["all", "All Banks"], ["maybank", "Maybank"], ["non-maybank", "Non-Maybank"]] as const).map(([val, label]) => (
                  <label key={val} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="radio"
                      name="bankFilter"
                      checked={bankFilter === val}
                      onChange={() => setBankFilter(val)}
                      className="text-blue-500 focus:ring-blue-400 h-3.5 w-3.5"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {/* Due date range */}
            <div className="space-y-2">
              <div>
                <label className="mb-1.5 flex items-center gap-1 text-xs font-medium text-gray-600">
                  <CalendarDays className="h-3 w-3" /> Due From
                </label>
                <input
                  type="date"
                  value={dueDateFrom}
                  onChange={(e) => setDueDateFrom(e.target.value)}
                  className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="mb-1.5 flex items-center gap-1 text-xs font-medium text-gray-600">
                  <CalendarDays className="h-3 w-3" /> Due To
                </label>
                <input
                  type="date"
                  value={dueDateTo}
                  onChange={(e) => setDueDateTo(e.target.value)}
                  min={dueDateFrom || undefined}
                  className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
            </div>

            {/* Paid date range */}
            <div className="space-y-2">
              <div>
                <label className="mb-1.5 flex items-center gap-1 text-xs font-medium text-gray-600">
                  <CheckCircle2 className="h-3 w-3" /> Paid From
                </label>
                <input
                  type="date"
                  value={paidDateFrom}
                  onChange={(e) => setPaidDateFrom(e.target.value)}
                  className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="mb-1.5 flex items-center gap-1 text-xs font-medium text-gray-600">
                  <CheckCircle2 className="h-3 w-3" /> Paid To
                </label>
                <input
                  type="date"
                  value={paidDateTo}
                  onChange={(e) => setPaidDateTo(e.target.value)}
                  min={paidDateFrom || undefined}
                  className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
            </div>

            {/* Clear all */}
            <div className="flex items-end">
              {activeFilterCount > 0 && (
                <button
                  onClick={() => { setOutletFilter([]); setBankFilter("all"); setDueDateFrom(""); setDueDateTo(""); setPaidDateFrom(""); setPaidDateTo(""); }}
                  className="flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 transition-colors"
                >
                  <X className="h-3 w-3" /> Clear All Filters
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile card list */}
      <div className="mt-4 space-y-2 lg:hidden">
        {invoices.length === 0 && (
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center">
            <FileText className="mx-auto h-8 w-8 text-gray-300" />
            <p className="mt-2 text-sm text-gray-500">
              {!debouncedSearch && tab === "all"
                ? "No invoices yet. Invoices will be created from receivings."
                : "No invoices match your filter."}
            </p>
          </div>
        )}
        {invoices.map((inv) => {
          const actions = getActions(inv);
          return (
            <div key={inv.id} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-sm font-semibold text-gray-900">{inv.invoiceNumber}</p>
                    <Badge className={`text-[10px] ${statusColor(inv.status)}`}>{statusLabel(inv.status, inv.paymentType)}</Badge>
                    {inv.paymentType === "STAFF_CLAIM" && <span className="rounded bg-purple-100 px-1 py-0.5 text-[9px] font-medium text-purple-600">CLAIM</span>}
                    {inv.orderType === "PAYMENT_REQUEST" && <span className="rounded bg-blue-100 px-1 py-0.5 text-[9px] font-medium text-blue-600">REQUEST</span>}
                    {inv.paymentType === "INTERNAL_TRANSFER" && <span className="rounded bg-orange-100 px-1 py-0.5 text-[9px] font-medium text-orange-600">TRANSFER</span>}
                    {inv.expenseCategory && inv.expenseCategory !== "INGREDIENT" && (
                      <span className="rounded bg-gray-100 px-1 py-0.5 text-[9px] font-medium uppercase text-gray-600">{inv.expenseCategory}</span>
                    )}
                    {activeFlags(inv).length > 0 && (
                      <button
                        onClick={() => setReviewingFlags(inv)}
                        className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 hover:bg-amber-200"
                      >
                        <AlertTriangle className="h-3 w-3" />
                        REVIEW {activeFlags(inv).length > 1 ? `×${activeFlags(inv).length}` : ""}
                      </button>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-gray-600">{inv.supplier}</p>
                  <p className="truncate text-[11px] text-gray-400">
                    {inv.outlet}
                    {inv.claimedBy ? ` · ${inv.claimedBy}` : ""}
                    {" · "}PO <code className="rounded bg-gray-100 px-1 py-0.5 text-[10px]">{inv.poNumber}</code>
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-base font-bold text-gray-900">RM {inv.amount.toFixed(2)}</p>
                  {inv.status === "DEPOSIT_PAID" && inv.depositAmount && (
                    <p className="text-[10px] text-amber-600">Bal: RM {(inv.amount - inv.depositAmount).toFixed(2)}</p>
                  )}
                </div>
              </div>

              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-gray-500">
                <div>
                  <p className="text-[9px] uppercase tracking-wide text-gray-400">Issued</p>
                  <p className="text-gray-600">{inv.issueDate}</p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-wide text-gray-400">Due</p>
                  <p className="text-gray-600">{inv.dueDate ?? "—"}</p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-wide text-gray-400">Paid</p>
                  <p className="text-gray-600">{inv.paidAt ? inv.paidAt.slice(0, 10) : "—"}</p>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {inv.hasPhoto && (
                  <button
                    onClick={() => setViewingPhotos({ invoiceNumber: inv.invoiceNumber, photos: inv.photos })}
                    className="inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-2 py-1 text-[11px] font-medium text-green-700"
                  >
                    <ImageIcon className="h-3.5 w-3.5" />
                    {inv.photoCount} photo{inv.photoCount > 1 ? "s" : ""}
                  </button>
                )}
                <button
                  onClick={() => openEdit(inv)}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </button>
                <div className="ml-auto flex flex-wrap justify-end gap-1.5">
                  {actions.map((a) => (
                    <button
                      key={a.status}
                      onClick={() => updateStatus(inv.id, a.status, inv)}
                      disabled={updatingId === inv.id}
                      className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium text-white ${a.color} disabled:opacity-50`}
                    >
                      {updatingId === inv.id ? <Loader2 className="h-3 w-3 animate-spin" /> : a.label}
                    </button>
                  ))}
                  {actions.length === 0 && inv.status === "PAID" && (
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      {inv.supplierPhone && inv.photos.length > 0 && (
                        <button
                          disabled={sendingPopId === inv.id}
                          onClick={async () => {
                            setSendingPopId(inv.id);
                            try {
                              let receiptUrl = inv.popShortLink;
                              if (!receiptUrl) {
                                const res = await fetch(`/api/inventory/invoices/${inv.id}/shortlink`, { method: "POST" });
                                const data = await res.json();
                                if (data.shortLink) {
                                  receiptUrl = data.shortLink;
                                  inv.popShortLink = data.shortLink;
                                } else {
                                  receiptUrl = inv.photos[inv.photos.length - 1];
                                }
                              }
                              const msg = `Hi, payment has been made for invoice ${inv.invoiceNumber} — RM ${inv.amount.toFixed(2)}.\nRef: ${inv.paymentRef ?? "N/A"}\n\nReceipt: ${receiptUrl}\n\nThank you.`;
                              window.open(`https://wa.me/${inv.supplierPhone!.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`, "_blank");
                            } catch {
                              const fallback = inv.photos[inv.photos.length - 1];
                              const msg = `Hi, payment has been made for invoice ${inv.invoiceNumber} — RM ${inv.amount.toFixed(2)}.\nRef: ${inv.paymentRef ?? "N/A"}\n\nReceipt: ${fallback}\n\nThank you.`;
                              window.open(`https://wa.me/${inv.supplierPhone!.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`, "_blank");
                            } finally {
                              setSendingPopId(null);
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-2 py-1 text-[11px] font-medium text-green-700 disabled:opacity-50"
                        >
                          {sendingPopId === inv.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Send POP"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop table */}
      <div className="mt-4 hidden rounded-xl border border-gray-200 bg-white lg:block overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead><tr className="border-b bg-gray-50/50">
            <th className="px-4 py-3 text-left font-medium text-gray-500">Invoice ID</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">PO Ref</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Supplier</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Outlet</th>
            {typeFilter !== "supplier" && <th className="px-4 py-3 text-left font-medium text-gray-500">Claimed By</th>}
            <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Issue Date</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Due Date</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Paid Date</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Amount (RM)</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Photo</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
          </tr></thead>
          <tbody>
            {invoices.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-12 text-center">
                  <FileText className="mx-auto h-8 w-8 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">
                    {!debouncedSearch && tab === "all"
                      ? "No invoices yet. Invoices will be created from receivings."
                      : "No invoices match your filter."}
                  </p>
                </td>
              </tr>
            )}
            {invoices.map((inv) => {
              const actions = getActions(inv);
              return (
                <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {inv.invoiceNumber}
                    {inv.paymentType === "STAFF_CLAIM" && <span className="ml-1.5 rounded bg-purple-100 px-1 py-0.5 text-[9px] font-medium text-purple-600">CLAIM</span>}
                    {inv.orderType === "PAYMENT_REQUEST" && <span className="ml-1.5 rounded bg-blue-100 px-1 py-0.5 text-[9px] font-medium text-blue-600">REQUEST</span>}
                    {inv.expenseCategory && inv.expenseCategory !== "INGREDIENT" && (
                      <span className="ml-1.5 rounded bg-gray-100 px-1 py-0.5 text-[9px] font-medium uppercase text-gray-600">{inv.expenseCategory}</span>
                    )}
                    {inv.paymentType === "INTERNAL_TRANSFER" && <span className="ml-1.5 rounded bg-orange-100 px-1 py-0.5 text-[9px] font-medium text-orange-600">TRANSFER</span>}
                    {activeFlags(inv).length > 0 && (
                      <button
                        onClick={() => setReviewingFlags(inv)}
                        className="ml-1.5 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 hover:bg-amber-200"
                        title={`${activeFlags(inv).length} review flag${activeFlags(inv).length > 1 ? "s" : ""}`}
                      >
                        <AlertTriangle className="h-3 w-3" />
                        REVIEW {activeFlags(inv).length > 1 ? `×${activeFlags(inv).length}` : ""}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3"><code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{inv.poNumber}</code></td>
                  <td className="px-4 py-3 text-gray-600">{inv.supplier}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{inv.outlet}</td>
                  {typeFilter !== "supplier" && <td className="px-4 py-3 text-xs text-gray-500">{inv.claimedBy ?? "—"}</td>}
                  <td className="px-4 py-3">
                    <Badge className={`text-[10px] ${statusColor(inv.status)}`}>{statusLabel(inv.status, inv.paymentType)}</Badge>
                    {inv.status === "DEPOSIT_PAID" && inv.depositAmount && (
                      <p className="text-[9px] text-amber-600 mt-0.5">Bal: RM {(inv.amount - inv.depositAmount).toFixed(2)}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{inv.issueDate}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{inv.dueDate ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{inv.paidAt ? inv.paidAt.slice(0, 10) : "—"}</td>
                  <td className="px-4 py-3 text-right font-medium">{inv.amount.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    {inv.hasPhoto ? (
                      <button
                        onClick={() => setViewingPhotos({ invoiceNumber: inv.invoiceNumber, photos: inv.photos })}
                        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-green-600 hover:bg-green-50 transition-colors"
                        title={`View ${inv.photoCount} photo${inv.photoCount > 1 ? "s" : ""}`}
                      >
                        <ImageIcon className="h-4 w-4" />
                        <span className="text-[10px] font-medium">{inv.photoCount}</span>
                      </button>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => openEdit(inv)}
                        className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        title="Edit invoice"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {actions.map((a) => (
                        <button
                          key={a.status}
                          onClick={() => updateStatus(inv.id, a.status, inv)}
                          disabled={updatingId === inv.id}
                          className={`rounded-md px-2 py-1 text-[10px] font-medium text-white ${a.color} disabled:opacity-50`}
                        >
                          {updatingId === inv.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            a.label
                          )}
                        </button>
                      ))}
                      {actions.length === 0 && inv.status === "PAID" && (
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                          {inv.supplierPhone && inv.photos.length > 0 && (
                            <button
                              disabled={sendingPopId === inv.id}
                              onClick={async () => {
                                setSendingPopId(inv.id);
                                try {
                                  let receiptUrl = inv.popShortLink;
                                  if (!receiptUrl) {
                                    const res = await fetch(`/api/inventory/invoices/${inv.id}/shortlink`, { method: "POST" });
                                    const data = await res.json();
                                    if (data.shortLink) {
                                      receiptUrl = data.shortLink;
                                      inv.popShortLink = data.shortLink;
                                    } else {
                                      receiptUrl = inv.photos[inv.photos.length - 1];
                                    }
                                  }
                                  const msg = `Hi, payment has been made for invoice ${inv.invoiceNumber} — RM ${inv.amount.toFixed(2)}.\nRef: ${inv.paymentRef ?? "N/A"}\n\nReceipt: ${receiptUrl}\n\nThank you.`;
                                  window.open(`https://wa.me/${inv.supplierPhone!.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`, "_blank");
                                } catch {
                                  const fallback = inv.photos[inv.photos.length - 1];
                                  const msg = `Hi, payment has been made for invoice ${inv.invoiceNumber} — RM ${inv.amount.toFixed(2)}.\nRef: ${inv.paymentRef ?? "N/A"}\n\nReceipt: ${fallback}\n\nThank you.`;
                                  window.open(`https://wa.me/${inv.supplierPhone!.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`, "_blank");
                                } finally {
                                  setSendingPopId(null);
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded-md bg-green-50 px-2 py-1 text-[10px] font-medium text-green-700 hover:bg-green-100 border border-green-200 transition-colors disabled:opacity-50"
                              title={`WhatsApp ${inv.supplier}`}
                            >
                              {sendingPopId === inv.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Send POP"}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Edit invoice modal */}
      {editingInvoice && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" onClick={() => setEditingInvoice(null)}>
          <div className="relative w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-t-xl sm:rounded-xl bg-white p-4 sm:p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">Edit Invoice</h3>
              <button onClick={() => setEditingInvoice(null)} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
                <span className="font-medium text-gray-700">{editingInvoice.supplier}</span> · {editingInvoice.outlet} · PO: {editingInvoice.poNumber}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Invoice Number</label>
                  <Input value={editForm.invoiceNumber} onChange={(e) => setEditForm({ ...editForm, invoiceNumber: e.target.value })} placeholder="e.g. INV-0001" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Amount (RM)</label>
                  <Input type="number" step="0.01" value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Invoice Date</label>
                  <input
                    type="date"
                    value={editForm.issueDate}
                    onChange={(e) => setEditForm({ ...editForm, issueDate: e.target.value })}
                    className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Due Date</label>
                  <input
                    type="date"
                    value={editForm.dueDate}
                    onChange={(e) => setEditForm({ ...editForm, dueDate: e.target.value })}
                    className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Notes</label>
                <Input value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} placeholder="Payment notes..." />
              </div>

              {/* Photo upload */}
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Invoice Photos</label>
                {editPhotos.length > 0 && (
                  <div className="mb-2 grid grid-cols-3 gap-2">
                    {editPhotos.map((url, i) => (
                      <div key={i} className="group relative overflow-hidden rounded-lg border border-gray-200">
                        {isPdf(url) ? (
                          <a href={url} target="_blank" rel="noopener noreferrer" className="flex h-24 w-full flex-col items-center justify-center bg-gray-50 text-gray-400 hover:text-blue-500">
                            <FileDown className="h-6 w-6" />
                            <span className="mt-1 text-[10px]">PDF</span>
                          </a>
                        ) : (
                          <img src={fixImageUrl(url)} alt={`Photo ${i + 1}`} className="h-24 w-full object-cover" />
                        )}
                        <button
                          onClick={() => setEditPhotos(editPhotos.filter((_, j) => j !== i))}
                          className="absolute right-1 top-1 rounded-full bg-red-500 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-4 py-3 text-sm transition-colors hover:border-blue-400 hover:bg-blue-50/30 ${editUploading ? "opacity-50 pointer-events-none" : ""}`}>
                  {editUploading ? (
                    <><Loader2 className="h-4 w-4 animate-spin text-blue-500" /> Uploading...</>
                  ) : (
                    <><Upload className="h-4 w-4 text-gray-400" /> <span className="text-gray-500">Upload photos</span></>
                  )}
                  <input type="file" accept="image/*,.pdf" multiple className="hidden" onChange={handleEditPhotoUpload} />
                </label>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button onClick={() => setEditingInvoice(null)} className="flex-1 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button
                onClick={saveEdit}
                disabled={editSaving || !editForm.invoiceNumber}
                className="flex-1 rounded-md bg-terracotta px-3 py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
              >
                {editSaving ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment dialog */}
      {payingInvoice && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" onClick={() => setPayingInvoice(null)}>
          <div className="relative w-full max-w-md max-h-[92vh] overflow-y-auto rounded-t-xl sm:rounded-xl bg-white p-4 sm:p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">
                {payingInvoice.paymentType === "INTERNAL_TRANSFER"
                  ? payingTargetStatus === "INITIATED" ? "Initiate Settlement" : "Mark Settled"
                  : payingTargetStatus === "DEPOSIT_PAID" ? "Pay Deposit"
                  : payingTargetStatus === "INITIATED" ? "Initiate Payment" : "Mark Paid"}
              </h3>
              <button onClick={() => setPayingInvoice(null)} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Invoice summary */}
            <div className="rounded-lg bg-gray-50 px-3 py-2.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-gray-900">{payingInvoice.invoiceNumber}</span>
                <span className="font-bold text-gray-900">RM {payingInvoice.amount.toFixed(2)}</span>
              </div>
              <p className="mt-0.5 text-xs text-gray-500">{payingInvoice.supplier} · {payingInvoice.outlet}</p>
            </div>

            {/* Deposit breakdown */}
            {payingInvoice.depositPercent && payingInvoice.depositPercent > 0 && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm">
                <p className="text-xs font-medium text-amber-700 mb-1.5">Deposit Payment ({payingInvoice.depositPercent}%)</p>
                <div className="flex items-center justify-between">
                  <span className="text-amber-800">Deposit</span>
                  <span className="font-medium text-amber-900">RM {(payingInvoice.depositAmount ?? Math.round(payingInvoice.amount * payingInvoice.depositPercent / 100 * 100) / 100).toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-amber-800">Balance</span>
                  <span className="font-medium text-amber-900">RM {(payingInvoice.amount - (payingInvoice.depositAmount ?? Math.round(payingInvoice.amount * payingInvoice.depositPercent / 100 * 100) / 100)).toFixed(2)}</span>
                </div>
                {payingInvoice.depositPaidAt && (
                  <p className="mt-1.5 text-xs text-green-600">✓ Deposit paid on {new Date(payingInvoice.depositPaidAt).toLocaleDateString("en-MY")}{payingInvoice.depositRef ? ` — Ref: ${payingInvoice.depositRef}` : ""}</p>
                )}
              </div>
            )}

            {/* Transfer details */}
            {payingInvoice.transfer && (
              <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2.5">
                <p className="text-xs font-medium text-orange-700">Stock Transfer</p>
                <p className="mt-0.5 text-sm text-orange-900">{payingInvoice.transfer.fromOutlet} → {payingInvoice.transfer.toOutlet}</p>
                <div className="mt-1.5 space-y-0.5">
                  {payingInvoice.transfer.items.map((item, i) => (
                    <p key={i} className="text-xs text-orange-700">{item.product} × {item.quantity}</p>
                  ))}
                </div>
              </div>
            )}

            {/* Staff claim details */}
            {payingInvoice.paymentType === "STAFF_CLAIM" && payingInvoice.claimedBy && (
              <div className="mt-3 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2.5">
                <p className="text-xs font-medium text-purple-700">Staff Claim</p>
                <p className="mt-0.5 text-sm text-purple-900">Claimed by: {payingInvoice.claimedBy}</p>
                {payingInvoice.notes && <p className="mt-1 text-xs text-purple-600">{payingInvoice.notes}</p>}
              </div>
            )}

            {/* Bank details — payee source depends on invoice type:
                - STAFF_CLAIM → claimant's bank (from HR/User record)
                - One-off vendor (PAYMENT_REQUEST asset/maintenance) → vendorBank on invoice
                - Otherwise supplier's bank */}
            {(() => {
              const isStaffClaim = payingInvoice.paymentType === "STAFF_CLAIM";
              const hasVendor = !!payingInvoice.vendorBank;
              const bank = isStaffClaim
                ? payingInvoice.claimantBank
                : (payingInvoice.supplierBank ?? payingInvoice.vendorBank);
              if (!bank) {
                if (isStaffClaim) {
                  return (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <Landmark className="h-3.5 w-3.5 text-amber-600" />
                        <p className="text-xs font-medium text-amber-800">
                          No bank details for {payingInvoice.claimedBy ?? "this staff member"} — add them in HR → Employees before paying out
                        </p>
                      </div>
                    </div>
                  );
                }
                return (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <Landmark className="h-3.5 w-3.5 text-amber-600" />
                      <p className="text-xs font-medium text-amber-800">
                        No bank details on file — check the invoice photos for the vendor's account info
                      </p>
                    </div>
                  </div>
                );
              }
              const headerLabel = isStaffClaim
                ? "Staff Bank Details (from HR)"
                : hasVendor && !payingInvoice.supplierBank
                  ? `Vendor Bank Details${payingInvoice.vendorName ? ` — ${payingInvoice.vendorName}` : ""}`
                  : "Bank Details";
              return (
                <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Landmark className="h-3.5 w-3.5 text-blue-600" />
                    <p className="text-xs font-medium text-blue-700">{headerLabel}</p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-blue-600">Bank</span>
                      <span className="text-sm font-medium text-blue-900">{bank.bankName}</span>
                    </div>
                    {bank.accountNumber && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-blue-600">Account No.</span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-sm font-medium text-blue-900">{bank.accountNumber}</span>
                          <button
                            onClick={() => copyToClipboard(bank.accountNumber!, "accNo")}
                            className="rounded p-0.5 text-blue-400 hover:bg-blue-100 hover:text-blue-600"
                          >
                            {copiedField === "accNo" ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                          </button>
                        </div>
                      </div>
                    )}
                    {bank.accountName && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-blue-600">Account Name</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-blue-900">{bank.accountName}</span>
                          <button
                            onClick={() => copyToClipboard(bank.accountName!, "accName")}
                            className="rounded p-0.5 text-blue-400 hover:bg-blue-100 hover:text-blue-600"
                          >
                            {copiedField === "accName" ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Payment reference — only for Mark Paid */}
            {payingTargetStatus === "PAID" && (
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-gray-600">Payment Reference</label>
              <Input
                value={payForm.paymentRef}
                onChange={(e) => setPayForm({ ...payForm, paymentRef: e.target.value })}
                placeholder="e.g. Transfer ref, receipt no..."
              />
            </div>
            )}

            {/* Receipt upload — only for Mark Paid */}
            {payingTargetStatus === "PAID" && (
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-gray-600">Receipt / Proof of Payment</label>
              {payReceipts.length > 0 && (
                <div className="mb-2 grid grid-cols-3 gap-2">
                  {payReceipts.map((url, i) => (
                    <div key={i} className="group relative overflow-hidden rounded-lg border border-gray-200">
                      {isPdf(url) ? (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="flex h-20 w-full flex-col items-center justify-center bg-gray-50 text-gray-400 hover:text-blue-500">
                          <FileDown className="h-5 w-5" />
                          <span className="mt-0.5 text-[10px]">PDF</span>
                        </a>
                      ) : (
                        <img src={fixImageUrl(url)} alt={`Receipt ${i + 1}`} className="h-20 w-full object-cover" />
                      )}
                      <button
                        onClick={() => setPayReceipts(payReceipts.filter((_, j) => j !== i))}
                        className="absolute right-1 top-1 rounded-full bg-red-500 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-4 py-2.5 text-sm transition-colors hover:border-blue-400 hover:bg-blue-50/30 ${payUploading ? "opacity-50 pointer-events-none" : ""}`}>
                {payUploading ? (
                  <><Loader2 className="h-4 w-4 animate-spin text-blue-500" /> Uploading...</>
                ) : (
                  <><Upload className="h-4 w-4 text-gray-400" /> <span className="text-gray-500">Upload receipt (image or PDF)</span></>
                )}
                <input type="file" accept="image/*,.pdf,application/pdf" multiple className="hidden" onChange={handlePayReceiptUpload} />
              </label>
            </div>
            )}

            <div className="mt-4 flex gap-2">
              <button onClick={() => setPayingInvoice(null)} className="flex-1 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button
                onClick={submitPayment}
                disabled={paySaving}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                  payingTargetStatus === "PAID" ? "bg-green-500 hover:bg-green-600" : "bg-blue-500 hover:bg-blue-600"
                }`}
              >
                {paySaving ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : (
                  payingInvoice.paymentType === "INTERNAL_TRANSFER"
                    ? payingTargetStatus === "INITIATED" ? "Initiate Settlement" : "Confirm Settled"
                    : payingTargetStatus === "INITIATED" ? "Confirm Initiate" : "Confirm Paid"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Photo viewer modal — fullscreen */}
      {viewingPhotos && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-4 py-2 border-b shrink-0 bg-gray-50">
            <h3 className="text-sm font-semibold text-gray-900">
              {viewingPhotos.invoiceNumber}
              <span className="ml-2 text-xs font-normal text-gray-400">{viewingPhotos.photos.length} file{viewingPhotos.photos.length > 1 ? "s" : ""}</span>
              {viewingPhotos.photos.length > 1 && (
                <span className="ml-3 text-xs text-gray-400">
                  {viewingPhotos.photos.map((url, i) => (
                    <button key={i} onClick={() => { const el = document.getElementById(`photo-${i}`); el?.scrollIntoView({ behavior: "smooth" }); }} className="inline-block mx-1 px-2 py-0.5 rounded bg-gray-200 hover:bg-gray-300 text-gray-600 text-[10px] font-medium">
                      {i + 1}
                    </button>
                  ))}
                </span>
              )}
            </h3>
            <div className="flex items-center gap-2">
              <a href={viewingPhotos.photos[0]} target="_blank" rel="noopener noreferrer" className="rounded-md px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50">
                Open in new tab &rarr;
              </a>
              <button onClick={() => setViewingPhotos(null)} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {viewingPhotos.photos.map((url, i) =>
              isPdf(url) ? (
                <iframe key={i} id={`photo-${i}`} src={url + "#toolbar=1&navpanes=0"} className="w-full h-full" style={{ minHeight: "calc(100vh - 48px)" }} title={`Document ${i + 1}`} />
              ) : (
                <div key={i} id={`photo-${i}`} className="flex items-center justify-center bg-gray-100 p-4" style={{ minHeight: "calc(100vh - 48px)" }}>
                  <img
                    src={fixImageUrl(url)}
                    alt={`Invoice photo ${i + 1}`}
                    className="max-w-full max-h-[90vh] object-contain rounded shadow-lg"
                    onError={(e) => {
                      // Fallback: replace with iframe
                      const parent = (e.target as HTMLElement).parentElement;
                      if (parent) {
                        parent.innerHTML = `<iframe src="${url}" class="w-full h-full" style="min-height:calc(100vh - 48px)" title="Document"></iframe>`;
                      }
                    }}
                  />
                </div>
              ),
            )}
          </div>
        </div>
      )}

      {/* Flag review dialog */}
      {reviewingFlags && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={() => setReviewingFlags(null)}>
          <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-t-xl sm:rounded-xl bg-white p-4 sm:p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                  Review flags
                </h3>
                <p className="mt-0.5 text-xs text-gray-500">
                  {reviewingFlags.invoiceNumber} · {reviewingFlags.supplier} · RM {reviewingFlags.amount.toFixed(2)}
                </p>
              </div>
              <button onClick={() => setReviewingFlags(null)} className="rounded-md p-1 text-gray-400 hover:bg-gray-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              {(reviewingFlags.flags ?? []).map((f) => (
                <div
                  key={f.code}
                  className={`rounded-lg border p-3 ${f.dismissed ? "border-gray-200 bg-gray-50" : "border-amber-200 bg-amber-50"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className={`text-sm font-semibold ${f.dismissed ? "text-gray-500 line-through" : "text-amber-900"}`}>
                        {FLAG_TITLE[f.code]}
                      </p>
                      <p className={`mt-1 text-xs ${f.dismissed ? "text-gray-400" : "text-amber-800"}`}>
                        {f.message}
                      </p>
                      <p className="mt-1 text-[10px] text-gray-400">
                        Detected {new Date(f.detectedAt).toLocaleString()}
                        {f.dismissed && f.dismissedAt && ` · Accepted ${new Date(f.dismissedAt).toLocaleString()}`}
                      </p>
                    </div>
                    {!f.dismissed && (
                      <button
                        onClick={() => dismissFlag(reviewingFlags.id, f.code)}
                        disabled={flagActionCode === f.code}
                        className="shrink-0 rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                      >
                        {flagActionCode === f.code ? <Loader2 className="h-3 w-3 animate-spin" /> : "Accept"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {(reviewingFlags.flags ?? []).length === 0 && (
                <p className="text-sm text-gray-500">No flags on this invoice.</p>
              )}
            </div>

            <div className="mt-4 flex flex-col gap-2 border-t pt-3 text-xs text-gray-500 sm:flex-row sm:items-center sm:justify-between">
              <span>"Accept" dismisses the flag — keep evidence in the invoice notes if needed.</span>
              <button onClick={() => setReviewingFlags(null)} className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
