"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FileText, Search, Download, Eye, Image as ImageIcon, Loader2 } from "lucide-react";

type Invoice = {
  id: string;
  invoiceNumber: string;
  poNumber: string;
  branch: string;
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
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/invoices")
      .then((res) => res.json())
      .then((data) => { setInvoices(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = invoices.filter((i) => {
    const matchFilter = filter === "all" || i.status === filter.toUpperCase();
    const matchSearch = i.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
      i.supplier.toLowerCase().includes(search.toLowerCase()) ||
      i.poNumber.toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  const totalPending = invoices.filter((i) => i.status === "PENDING").reduce((a, i) => a + i.amount, 0);
  const totalOverdue = invoices.filter((i) => i.status === "OVERDUE").reduce((a, i) => a + i.amount, 0);
  const totalPaid = invoices.filter((i) => i.status === "PAID").reduce((a, i) => a + i.amount, 0);
  const totalAll = invoices.reduce((a, i) => a + i.amount, 0);

  const statusColor = (status: string) => {
    switch (status) {
      case "PAID": return "bg-green-500";
      case "PENDING": return "bg-terracotta";
      case "OVERDUE": return "bg-red-500";
      default: return "bg-gray-400";
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
        <Button className="bg-terracotta hover:bg-terracotta-dark"><FileText className="mr-1.5 h-4 w-4" />Generate Invoice</Button>
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
          {["all", "draft", "pending", "paid", "overdue"].map((s) => (
            <button key={s} onClick={() => setFilter(s)} className={`rounded-full border px-3 py-1 text-xs capitalize ${filter === s ? "border-terracotta bg-terracotta/5 text-terracotta-dark" : "border-gray-200 text-gray-500"}`}>{s}</button>
          ))}
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-gray-50/50">
            <th className="px-4 py-3 text-left font-medium text-gray-500">Invoice ID</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">PO Ref</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Supplier</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Branch</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Issue Date</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Due Date</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Amount (RM)</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Photo</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center">
                  <FileText className="mx-auto h-8 w-8 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">
                    {invoices.length === 0
                      ? "No invoices yet. Invoices will be created from receivings."
                      : "No invoices match your filter."}
                  </p>
                </td>
              </tr>
            )}
            {filtered.map((inv) => (
              <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3 font-medium text-gray-900">{inv.invoiceNumber}</td>
                <td className="px-4 py-3"><code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{inv.poNumber}</code></td>
                <td className="px-4 py-3 text-gray-600">{inv.supplier}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{inv.branch}</td>
                <td className="px-4 py-3">
                  <Badge className={`text-[10px] ${statusColor(inv.status)}`}>{inv.status.toLowerCase()}</Badge>
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">{inv.issueDate}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{inv.dueDate ?? "—"}</td>
                <td className="px-4 py-3 text-right font-medium">{inv.amount.toFixed(2)}</td>
                <td className="px-4 py-3">{inv.hasPhoto ? <ImageIcon className="h-4 w-4 text-green-500" /> : <span className="text-xs text-gray-300">—</span>}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    <button className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100"><Eye className="h-3.5 w-3.5" /></button>
                    <button className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100"><Download className="h-3.5 w-3.5" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
