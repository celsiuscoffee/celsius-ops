"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useFetch } from "@/lib/use-fetch";
import { FileText, Search, Download, Eye, Image as ImageIcon, Loader2, CheckCircle2, Clock, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";

type PaginatedResponse<T> = { items: T[]; total: number; page: number; limit: number };
const PAGE_SIZE = 50;

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
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
  notes: string | null;
};

export default function InvoicesPage() {
  const [filter, setFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search, 300);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const apiUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (filter) params.set("status", filter);
    params.set("page", String(page));
    params.set("limit", String(PAGE_SIZE));
    return `/api/invoices?${params}`;
  }, [debouncedSearch, filter, page]);

  const { data, isLoading: loading, mutate: reloadInvoices } = useFetch<PaginatedResponse<Invoice>>(apiUrl);
  const invoices = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Reset to page 1 when search/filter changes
  const prevSearch = useRef(debouncedSearch);
  const prevFilter = useRef(filter);
  useEffect(() => {
    if (prevSearch.current !== debouncedSearch || prevFilter.current !== filter) {
      setPage(1);
      prevSearch.current = debouncedSearch;
      prevFilter.current = filter;
    }
  }, [debouncedSearch, filter]);

  const loadInvoices = () => reloadInvoices();

  const updateStatus = async (invoiceId: string, newStatus: string) => {
    setUpdatingId(invoiceId);
    try {
      await fetch(`/api/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      loadInvoices();
    } finally {
      setUpdatingId(null);
    }
  };

  const totalPending = useMemo(() => invoices.filter((i) => i.status === "PENDING").reduce((a, i) => a + i.amount, 0), [invoices]);
  const totalOverdue = useMemo(() => invoices.filter((i) => i.status === "OVERDUE").reduce((a, i) => a + i.amount, 0), [invoices]);
  const totalPaid = useMemo(() => invoices.filter((i) => i.status === "PAID").reduce((a, i) => a + i.amount, 0), [invoices]);
  const totalAll = useMemo(() => invoices.reduce((a, i) => a + i.amount, 0), [invoices]);

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

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Invoices</h2>
          <p className="mt-0.5 text-sm text-gray-500">{total} invoices &middot; Track and reconcile supplier invoices</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="mt-4 grid grid-cols-4 gap-3">
        <div className="rounded-lg border bg-white px-3 py-2.5"><p className="text-xs text-gray-500">Total</p><p className="text-lg font-bold">RM {totalAll.toFixed(2)}</p></div>
        <div className="rounded-lg border bg-white px-3 py-2.5"><p className="text-xs text-gray-500">Pending</p><p className="text-lg font-bold text-terracotta">RM {totalPending.toFixed(2)}</p></div>
        <div className="rounded-lg border bg-white px-3 py-2.5"><p className="text-xs text-gray-500">Overdue</p><p className="text-lg font-bold text-red-600">RM {totalOverdue.toFixed(2)}</p></div>
        <div className="rounded-lg border bg-white px-3 py-2.5"><p className="text-xs text-gray-500">Paid</p><p className="text-lg font-bold text-green-600">RM {totalPaid.toFixed(2)}</p></div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Search invoices..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1.5">
          {[{ value: "", label: "all" }, { value: "DRAFT", label: "draft" }, { value: "PENDING", label: "pending" }, { value: "PAID", label: "paid" }, { value: "OVERDUE", label: "overdue" }].map((s) => (
            <button key={s.value} onClick={() => setFilter(s.value)} className={`rounded-full border px-3 py-1 text-xs capitalize ${filter === s.value ? "border-terracotta bg-terracotta/5 text-terracotta-dark" : "border-gray-200 text-gray-500"}`}>{s.label}</button>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-gray-50/50">
            <th className="px-4 py-3 text-left font-medium text-gray-500">Invoice ID</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">PO Ref</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Supplier</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Outlet</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Issue Date</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Due Date</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Amount (RM)</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Photo</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
          </tr></thead>
          <tbody>
            {!loading && invoices.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center">
                  <FileText className="mx-auto h-8 w-8 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">
                    {total === 0 && !debouncedSearch && !filter
                      ? "No invoices yet. Invoices will be created from receivings."
                      : "No invoices match your filter."}
                  </p>
                </td>
              </tr>
            )}
            {loading && invoices.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-terracotta" />
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm">
          <p className="text-gray-500">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </p>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-md border px-2 py-1 text-gray-500 hover:bg-gray-50 disabled:opacity-30">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-3 text-gray-700">Page {page} of {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="rounded-md border px-2 py-1 text-gray-500 hover:bg-gray-50 disabled:opacity-30">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
