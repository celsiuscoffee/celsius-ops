"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useFetch } from "@/lib/use-fetch";
import { FileText, Search, Download, Eye, Image as ImageIcon, Loader2, CheckCircle2, Clock, AlertTriangle, Filter, X, CalendarDays, Building2 } from "lucide-react";

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
      await fetch(`/api/inventory/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      loadInvoices();
    } finally {
      setUpdatingId(null);
    }
  };

  const totalPending = invoices.filter((i) => i.status === "PENDING").reduce((a, i) => a + i.amount, 0);
  const totalOverdue = invoices.filter((i) => i.status === "OVERDUE").reduce((a, i) => a + i.amount, 0);
  const totalPaid = invoices.filter((i) => i.status === "PAID").reduce((a, i) => a + i.amount, 0);
  const totalAll = invoices.reduce((a, i) => a + i.amount, 0);

  const statusColor = (status: string) => {
    switch (status) {
      case "PAID": return "bg-green-500";
      case "PENDING": return "bg-terracotta";
      case "OVERDUE": return "bg-red-500";
      case "DRAFT": return "bg-gray-400";
      default: return "bg-gray-400";
    }
  };

  const getActions = (status: string) => {
    switch (status) {
      case "DRAFT": return [
        { status: "PENDING", label: "Send", color: "bg-terracotta hover:bg-terracotta-dark" },
      ];
      case "PENDING": return [
        { status: "PAID", label: "Mark Paid", color: "bg-green-500 hover:bg-green-600" },
        { status: "OVERDUE", label: "Mark Overdue", color: "bg-red-500 hover:bg-red-600" },
      ];
      case "OVERDUE": return [
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
                  <td className="px-4 py-3">{inv.hasPhoto ? <ImageIcon className="h-4 w-4 text-green-500" /> : <span className="text-xs text-gray-300">—</span>}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
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
    </div>
  );
}
