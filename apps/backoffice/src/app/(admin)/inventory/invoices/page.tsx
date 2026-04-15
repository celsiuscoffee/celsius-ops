"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useFetch } from "@/lib/use-fetch";
import { FileText, Search, Download, Eye, Image as ImageIcon, Loader2, CheckCircle2, Clock, AlertTriangle, Filter, X, CalendarDays, Building2, ZoomIn, Pencil, Upload, Trash2, FileDown, DollarSign, Landmark, Copy, Check } from "lucide-react";

const isPdf = (url: string) => /\.pdf($|\?)/i.test(url);
// Fix Cloudinary raw URLs to image URLs so they render as images
const fixImageUrl = (url: string) => isPdf(url) ? url : url.replace("/raw/upload/", "/image/upload/");

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
  transfer: { fromOutlet: string; toOutlet: string; items: { product: string; quantity: number }[] } | null;
};

type OutletOption = { id: string; name: string };
type InvoicesResponse = { invoices: Invoice[]; outlets: OutletOption[]; dueTodayCount: number; dueTodayAmount: number };

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
  const [showFilters, setShowFilters] = useState(false);
  const [viewingPhotos, setViewingPhotos] = useState<{ invoiceNumber: string; photos: string[] } | null>(null);
  const [cardFilter, setCardFilter] = useState<"all" | "pending" | "overdue" | "paid" | "due_today" | "payable" | null>(null);
  const [batchInitiating, setBatchInitiating] = useState(false);

  // Payment dialog
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
  const [payingTargetStatus, setPayingTargetStatus] = useState<string>("");
  const [payForm, setPayForm] = useState({ paidVia: "", paymentRef: "" });
  const [paySaving, setPaySaving] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [payReceipts, setPayReceipts] = useState<string[]>([]);
  const [payUploading, setPayUploading] = useState(false);

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

  const url = `/api/inventory/invoices?${params.toString()}`;
  const { data, isLoading: loading, mutate: loadInvoices } = useFetch<InvoicesResponse>(url);
  const allInvoices = data?.invoices ?? [];
  const outletOptions = data?.outlets ?? [];
  const dueTodayCount = data?.dueTodayCount ?? 0;
  const dueTodayAmount = data?.dueTodayAmount ?? 0;

  const today = new Date().toISOString().split("T")[0];

  // Apply card filter + bank filter on top of API results
  const invoices = allInvoices.filter((inv) => {
    if (cardFilter) {
      if (cardFilter === "pending" && inv.status !== "PENDING") return false;
      if (cardFilter === "overdue" && inv.status !== "OVERDUE") return false;
      if (cardFilter === "paid" && inv.status !== "PAID") return false;
      if (cardFilter === "payable" && inv.status === "PAID") return false;
      if (cardFilter === "due_today" && (inv.dueDate !== today || inv.status === "PAID")) return false;
    }
    if (bankFilter === "maybank" && !inv.supplierBank?.bankName?.toLowerCase().includes("maybank")) return false;
    if (bankFilter === "non-maybank" && inv.supplierBank?.bankName?.toLowerCase().includes("maybank")) return false;
    return true;
  });

  const activeFilterCount = [outletFilter.length > 0, bankFilter !== "all", dueDateFrom, dueDateTo].filter(Boolean).length;

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
          ...(payForm.paymentRef ? { paymentRef: payForm.paymentRef } : {}),
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

  const totalOverdue = allInvoices.filter((i) => i.status === "OVERDUE").reduce((a, i) => a + i.amount, 0);
  const totalPaid = allInvoices.filter((i) => i.status === "PAID").reduce((a, i) => a + i.amount, 0);
  const totalAll = allInvoices.reduce((a, i) => a + i.amount, 0);
  const totalPayable = allInvoices.filter((i) => i.status !== "PAID").reduce((a, i) => a + i.amount, 0);
  const payableCount = allInvoices.filter((i) => i.status !== "PAID").length;

  const statusLabel = (status: string, paymentType: string) => {
    if (paymentType === "STAFF_CLAIM") {
      if (status === "INITIATED") return "approved";
      if (status === "PAID") return "reimbursed";
    }
    if (paymentType === "INTERNAL_TRANSFER") {
      if (status === "PAID") return "settled";
    }
    return status.toLowerCase();
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "PAID": return "bg-green-500";
      case "INITIATED": return "bg-blue-500";
      case "PENDING": return "bg-terracotta";
      case "OVERDUE": return "bg-red-500";
      case "DRAFT": return "bg-gray-400";
      default: return "bg-gray-400";
    }
  };

  const getActions = (status: string, paymentType: string) => {
    const isStaffClaim = paymentType === "STAFF_CLAIM";
    const isTransfer = paymentType === "INTERNAL_TRANSFER";
    switch (status) {
      case "PENDING": return [
        { status: "INITIATED", label: isStaffClaim ? "Approve Claim" : isTransfer ? "Initiate Settlement" : "Initiate Payment", color: "bg-blue-500 hover:bg-blue-600" },
      ];
      case "INITIATED": return [
        { status: "PAID", label: isStaffClaim ? "Mark Reimbursed" : isTransfer ? "Mark Settled" : "Mark Paid", color: "bg-green-500 hover:bg-green-600" },
      ];
      case "OVERDUE": return [
        { status: "INITIATED", label: isStaffClaim ? "Approve Claim" : isTransfer ? "Initiate Settlement" : "Initiate Payment", color: "bg-blue-500 hover:bg-blue-600" },
        { status: "PAID", label: isStaffClaim ? "Mark Reimbursed" : isTransfer ? "Mark Settled" : "Mark Paid", color: "bg-green-500 hover:bg-green-600" },
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
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Invoices</h2>
          <p className="mt-0.5 text-sm text-gray-500">{invoices.length} invoices &middot; Track and reconcile supplier invoices</p>
        </div>
      </div>

      {/* Summary cards — clickable to filter */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
        {([
          { key: "all" as const, label: "Total", amount: totalAll, count: allInvoices.length, color: "text-gray-900", border: "border-gray-300", ring: "ring-gray-200" },
          { key: "payable" as const, label: "Payable", amount: totalPayable, count: payableCount, color: payableCount > 0 ? "text-orange-600" : "text-gray-400", border: "border-orange-400", ring: "ring-orange-100" },
          { key: "due_today" as const, label: "Due Today", amount: dueTodayAmount, count: dueTodayCount, color: dueTodayCount > 0 ? "text-blue-600" : "text-gray-400", border: "border-blue-400", ring: "ring-blue-100" },
          { key: "overdue" as const, label: "Overdue", amount: totalOverdue, count: allInvoices.filter((i) => i.status === "OVERDUE").length, color: "text-red-600", border: "border-red-400", ring: "ring-red-100" },
          { key: "paid" as const, label: "Paid", amount: totalPaid, count: allInvoices.filter((i) => i.status === "PAID").length, color: "text-green-600", border: "border-green-400", ring: "ring-green-100" },
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
                  card.key === "payable" ? "bg-orange-500" : card.key === "due_today" ? "bg-blue-500" : card.key === "overdue" ? "bg-red-500" : "bg-green-500"
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

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Search invoices..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1.5">
          {([["unpaid", "Unpaid"], ["paid", "Paid"], ["all", "All"]] as const).map(([value, label]) => (
            <button key={value} onClick={() => setTab(value)} className={`rounded-full border px-3 py-1 text-xs transition-colors ${tab === value ? "border-terracotta bg-terracotta/5 text-terracotta-dark" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>{label}</button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {([["all", "All Types"], ["supplier", "Supplier"], ["staff_claim", "Staff Claims"], ["transfer", "Transfers"]] as const).map(([value, label]) => (
            <button key={value} onClick={() => setTypeFilter(value)} className={`rounded-full border px-3 py-1 text-xs transition-colors ${typeFilter === value ? "border-purple-400 bg-purple-50 text-purple-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>{label}</button>
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
            onClick={() => { setOutletFilter(""); setDueDateFrom(""); setDueDateTo(""); }}
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

            {/* Clear all */}
            <div className="flex items-end">
              {activeFilterCount > 0 && (
                <button
                  onClick={() => { setOutletFilter([]); setBankFilter("all"); setDueDateFrom(""); setDueDateTo(""); }}
                  className="flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 transition-colors"
                >
                  <X className="h-3 w-3" /> Clear All Filters
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-gray-50/50">
            <th className="px-4 py-3 text-left font-medium text-gray-500">Invoice ID</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">PO Ref</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Supplier</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Outlet</th>
            {typeFilter !== "supplier" && <th className="px-4 py-3 text-left font-medium text-gray-500">Claimed By</th>}
            <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Issue Date</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Due Date</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Amount (RM)</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Photo</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
          </tr></thead>
          <tbody>
            {invoices.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-12 text-center">
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
              const actions = getActions(inv.status, inv.paymentType);
              return (
                <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {inv.invoiceNumber}
                    {inv.paymentType === "STAFF_CLAIM" && <span className="ml-1.5 rounded bg-purple-100 px-1 py-0.5 text-[9px] font-medium text-purple-600">CLAIM</span>}
                    {inv.paymentType === "INTERNAL_TRANSFER" && <span className="ml-1.5 rounded bg-orange-100 px-1 py-0.5 text-[9px] font-medium text-orange-600">TRANSFER</span>}
                  </td>
                  <td className="px-4 py-3"><code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{inv.poNumber}</code></td>
                  <td className="px-4 py-3 text-gray-600">{inv.supplier}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{inv.outlet}</td>
                  {typeFilter !== "supplier" && <td className="px-4 py-3 text-xs text-gray-500">{inv.claimedBy ?? "—"}</td>}
                  <td className="px-4 py-3">
                    <Badge className={`text-[10px] ${statusColor(inv.status)}`}>{statusLabel(inv.status, inv.paymentType)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{inv.issueDate}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{inv.dueDate ?? "—"}</td>
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
                            <a
                              href={`https://wa.me/${inv.supplierPhone.replace(/\D/g, "")}?text=${encodeURIComponent(`Hi, payment has been made for invoice ${inv.invoiceNumber} — RM ${inv.amount.toFixed(2)}.\nRef: ${inv.paymentRef ?? "N/A"}\n\nReceipt: ${inv.popShortLink ?? inv.photos[inv.photos.length - 1] ?? ""}\n\nThank you.`)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded-md bg-green-50 px-2 py-1 text-[10px] font-medium text-green-700 hover:bg-green-100 border border-green-200 transition-colors"
                              title={`WhatsApp ${inv.supplier}`}
                            >
                              Send POP
                            </a>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setEditingInvoice(null)}>
          <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Invoice Number</label>
                  <Input value={editForm.invoiceNumber} onChange={(e) => setEditForm({ ...editForm, invoiceNumber: e.target.value })} placeholder="e.g. INV-0001" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Amount (RM)</label>
                  <Input type="number" step="0.01" value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setPayingInvoice(null)}>
          <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">
                {payingInvoice.paymentType === "STAFF_CLAIM"
                  ? payingTargetStatus === "INITIATED" ? "Approve Claim" : "Mark Reimbursed"
                  : payingInvoice.paymentType === "INTERNAL_TRANSFER"
                  ? payingTargetStatus === "INITIATED" ? "Initiate Settlement" : "Mark Settled"
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

            {/* Bank details */}
            {payingInvoice.supplierBank && (
              <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5">
                <div className="flex items-center gap-1.5 mb-2">
                  <Landmark className="h-3.5 w-3.5 text-blue-600" />
                  <p className="text-xs font-medium text-blue-700">Bank Details</p>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-blue-600">Bank</span>
                    <span className="text-sm font-medium text-blue-900">{payingInvoice.supplierBank.bankName}</span>
                  </div>
                  {payingInvoice.supplierBank.accountNumber && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-blue-600">Account No.</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-sm font-medium text-blue-900">{payingInvoice.supplierBank.accountNumber}</span>
                        <button
                          onClick={() => copyToClipboard(payingInvoice.supplierBank!.accountNumber!, "accNo")}
                          className="rounded p-0.5 text-blue-400 hover:bg-blue-100 hover:text-blue-600"
                        >
                          {copiedField === "accNo" ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                        </button>
                      </div>
                    </div>
                  )}
                  {payingInvoice.supplierBank.accountName && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-blue-600">Account Name</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-blue-900">{payingInvoice.supplierBank.accountName}</span>
                        <button
                          onClick={() => copyToClipboard(payingInvoice.supplierBank!.accountName!, "accName")}
                          className="rounded p-0.5 text-blue-400 hover:bg-blue-100 hover:text-blue-600"
                        >
                          {copiedField === "accName" ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

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
                  payingInvoice.paymentType === "STAFF_CLAIM"
                    ? payingTargetStatus === "INITIATED" ? "Approve Claim" : "Mark Reimbursed"
                    : payingInvoice.paymentType === "INTERNAL_TRANSFER"
                    ? payingTargetStatus === "INITIATED" ? "Initiate Settlement" : "Confirm Settled"
                    : payingTargetStatus === "INITIATED" ? "Confirm Initiate" : "Confirm Paid"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Photo viewer modal */}
      {viewingPhotos && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setViewingPhotos(null)}>
          <div className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">
                Photos — {viewingPhotos.invoiceNumber}
                <span className="ml-2 text-xs font-normal text-gray-400">{viewingPhotos.photos.length} photo{viewingPhotos.photos.length > 1 ? "s" : ""}</span>
              </h3>
              <button onClick={() => setViewingPhotos(null)} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {viewingPhotos.photos.map((url, i) =>
                isPdf(url) ? (
                  <div key={i} className="overflow-hidden rounded-lg border border-gray-200">
                    <iframe src={url} className="h-[70vh] w-full" title={`PDF ${i + 1}`} />
                    <div className="flex items-center justify-between border-t bg-gray-50 px-3 py-1.5">
                      <span className="flex items-center gap-1.5 text-xs text-gray-500"><FileDown className="h-3.5 w-3.5" />PDF Document</span>
                      <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-blue-600 hover:text-blue-700">Open in new tab &rarr;</a>
                    </div>
                  </div>
                ) : (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="group relative block overflow-hidden rounded-lg border border-gray-200 hover:border-blue-300">
                    <img src={fixImageUrl(url)} alt={`Invoice photo ${i + 1}`} className="h-auto w-full object-contain" />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/10 group-hover:opacity-100">
                      <ZoomIn className="h-6 w-6 text-white drop-shadow-md" />
                    </div>
                  </a>
                ),
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
