"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useFetch } from "@/lib/use-fetch";
import { FileText, Search, Download, Eye, Image as ImageIcon, Loader2, CheckCircle2, Clock, AlertTriangle, Filter, X, CalendarDays, Building2, ZoomIn, Pencil, Upload, Trash2 } from "lucide-react";

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
};

type OutletOption = { id: string; name: string };
type InvoicesResponse = { invoices: Invoice[]; outlets: OutletOption[] };

export default function InvoicesPage() {
  const [tab, setTab] = useState("unpaid");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [outletFilter, setOutletFilter] = useState("");
  const [dueDateFrom, setDueDateFrom] = useState("");
  const [dueDateTo, setDueDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [viewingPhotos, setViewingPhotos] = useState<{ invoiceNumber: string; photos: string[] } | null>(null);

  // Edit invoice dialog
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [editForm, setEditForm] = useState({ invoiceNumber: "", dueDate: "", notes: "", amount: "" });
  const [editPhotos, setEditPhotos] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [editUploading, setEditUploading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams({ tab, type: typeFilter });
  if (debouncedSearch) params.set("search", debouncedSearch);
  if (outletFilter) params.set("outlet", outletFilter);
  if (dueDateFrom) params.set("dueDateFrom", dueDateFrom);
  if (dueDateTo) params.set("dueDateTo", dueDateTo);

  const url = `/api/inventory/invoices?${params.toString()}`;
  const { data, isLoading: loading, mutate: loadInvoices } = useFetch<InvoicesResponse>(url);
  const invoices = data?.invoices ?? [];
  const outletOptions = data?.outlets ?? [];

  const activeFilterCount = [outletFilter, dueDateFrom, dueDateTo].filter(Boolean).length;

  const updateStatus = async (invoiceId: string, newStatus: string) => {
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

  const totalPending = invoices.filter((i) => i.status === "PENDING").reduce((a, i) => a + i.amount, 0);
  const totalOverdue = invoices.filter((i) => i.status === "OVERDUE").reduce((a, i) => a + i.amount, 0);
  const totalPaid = invoices.filter((i) => i.status === "PAID").reduce((a, i) => a + i.amount, 0);
  const totalAll = invoices.reduce((a, i) => a + i.amount, 0);

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

  const getActions = (status: string) => {
    switch (status) {
      case "PENDING": return [
        { status: "INITIATED", label: "Initiate Payment", color: "bg-blue-500 hover:bg-blue-600" },
        { status: "OVERDUE", label: "Mark Overdue", color: "bg-red-500 hover:bg-red-600" },
      ];
      case "INITIATED": return [
        { status: "PAID", label: "Approve / Paid", color: "bg-green-500 hover:bg-green-600" },
        { status: "OVERDUE", label: "Mark Overdue", color: "bg-red-500 hover:bg-red-600" },
      ];
      case "OVERDUE": return [
        { status: "INITIATED", label: "Initiate Payment", color: "bg-blue-500 hover:bg-blue-600" },
        { status: "PAID", label: "Mark Paid", color: "bg-green-500 hover:bg-green-600" },
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

      {/* Summary cards */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border bg-white px-3 py-2.5"><p className="text-xs text-gray-500">Total</p><p className="text-lg font-bold">RM {totalAll.toFixed(2)}</p></div>
        <div className="rounded-lg border bg-white px-3 py-2.5"><p className="text-xs text-gray-500">Pending</p><p className="text-lg font-bold text-terracotta">RM {totalPending.toFixed(2)}</p></div>
        <div className="rounded-lg border bg-white px-3 py-2.5"><p className="text-xs text-gray-500">Overdue</p><p className="text-lg font-bold text-red-600">RM {totalOverdue.toFixed(2)}</p></div>
        <div className="rounded-lg border bg-white px-3 py-2.5"><p className="text-xs text-gray-500">Paid</p><p className="text-lg font-bold text-green-600">RM {totalPaid.toFixed(2)}</p></div>
      </div>

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
          {([["all", "All Types"], ["supplier", "Supplier"], ["staff_claim", "Staff Claims"]] as const).map(([value, label]) => (
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
        <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/30 p-3">
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[180px]">
              <label className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-600">
                <Building2 className="h-3 w-3" /> Outlet
              </label>
              <select
                value={outletFilter}
                onChange={(e) => setOutletFilter(e.target.value)}
                className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value="">All Outlets</option>
                {outletOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            <div className="min-w-[150px]">
              <label className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-600">
                <CalendarDays className="h-3 w-3" /> Due From
              </label>
              <input
                type="date"
                value={dueDateFrom}
                onChange={(e) => setDueDateFrom(e.target.value)}
                className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <div className="min-w-[150px]">
              <label className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-600">
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
              const actions = getActions(inv.status);
              return (
                <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-medium text-gray-900">{inv.invoiceNumber}</td>
                  <td className="px-4 py-3"><code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{inv.poNumber}</code></td>
                  <td className="px-4 py-3 text-gray-600">{inv.supplier}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{inv.outlet}</td>
                  {typeFilter !== "supplier" && <td className="px-4 py-3 text-xs text-gray-500">{inv.claimedBy ?? "—"}</td>}
                  <td className="px-4 py-3">
                    <Badge className={`text-[10px] ${statusColor(inv.status)}`}>{inv.status.toLowerCase()}</Badge>
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
                          onClick={() => updateStatus(inv.id, a.status)}
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
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
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

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Due Date</label>
                <input
                  type="date"
                  value={editForm.dueDate}
                  onChange={(e) => setEditForm({ ...editForm, dueDate: e.target.value })}
                  className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
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
                        <img src={url} alt={`Photo ${i + 1}`} className="h-24 w-full object-cover" />
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {viewingPhotos.photos.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="group relative block overflow-hidden rounded-lg border border-gray-200 hover:border-blue-300">
                  <img src={url} alt={`Invoice photo ${i + 1}`} className="h-auto w-full object-contain" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/10 group-hover:opacity-100">
                    <ZoomIn className="h-6 w-6 text-white drop-shadow-md" />
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
