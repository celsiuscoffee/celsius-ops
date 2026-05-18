"use client";

import { useState } from "react";
import Link from "next/link";
import { useFetch } from "@/lib/use-fetch";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Receipt, ExternalLink, Plus, Loader2, Trash2, CheckCircle2, Circle } from "lucide-react";

type Invoice = {
  id:            string;
  invoiceNumber: string | null;
  issueDate:     string;
  periodStart:   string;
  periodEnd:     string;
  amountUsd:     string;
  amountMyr:     string | null;
  status:        string;
  pdfUrl:        string | null;
  notes:         string | null;
  createdAt:     string;
};

function fmtUSD(n: number | string): string {
  const v = typeof n === "string" ? Number(n) : n;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
}
function fmtMYR(n: number | string | null): string {
  if (n == null) return "—";
  const v = typeof n === "string" ? Number(n) : n;
  return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(v);
}
function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString("en-MY", { year: "numeric", month: "short", day: "2-digit" });
}

export default function RecruitmentInvoicesPage() {
  const { data, mutate, isLoading } = useFetch<{ invoices: Invoice[] }>("/api/ads/indeed/invoices");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const [form, setForm] = useState({
    invoiceNumber: "",
    issueDate:     today,
    periodStart:   monthStart,
    periodEnd:     today,
    amountUsd:     "",
    amountMyr:     "",
    pdfUrl:        "",
    notes:         "",
  });

  async function createInvoice(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/ads/indeed/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceNumber: form.invoiceNumber || undefined,
          issueDate:     form.issueDate,
          periodStart:   form.periodStart,
          periodEnd:     form.periodEnd,
          amountUsd:     form.amountUsd,
          amountMyr:     form.amountMyr || undefined,
          pdfUrl:        form.pdfUrl || undefined,
          notes:         form.notes || undefined,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        alert(json.error ?? "Failed to save");
        return;
      }
      mutate();
      setShowForm(false);
      setForm({ ...form, invoiceNumber: "", amountUsd: "", amountMyr: "", pdfUrl: "", notes: "" });
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(inv: Invoice) {
    setTogglingId(inv.id);
    try {
      const next = inv.status === "paid" ? "unpaid" : "paid";
      await fetch(`/api/ads/indeed/invoices/${inv.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      mutate();
    } finally {
      setTogglingId(null);
    }
  }

  async function deleteInvoice(id: string) {
    if (!confirm("Delete this invoice record? Cannot be undone.")) return;
    await fetch(`/api/ads/indeed/invoices/${id}`, { method: "DELETE" });
    mutate();
  }

  const invoices = data?.invoices ?? [];
  const totalUsd = invoices.reduce((s, i) => s + Number(i.amountUsd), 0);
  const unpaidUsd = invoices.filter(i => i.status !== "paid").reduce((s, i) => s + Number(i.amountUsd), 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Link href="/ads/recruitment" className="hover:underline">Recruitment</Link>
            <span>/</span>
            <span>Invoices</span>
          </div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Receipt className="h-6 w-6 text-terracotta" /> Indeed Invoices
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Bills from Indeed for sponsored job spend. Entered manually since the Sponsored Jobs API doesn&apos;t expose invoices to direct employers.
            <a href="https://employers.indeed.com/billing" target="_blank" rel="noopener noreferrer" className="ml-1 text-terracotta hover:underline inline-flex items-center gap-0.5">
              billing portal <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>
        <Button onClick={() => setShowForm(v => !v)} className="gap-2">
          <Plus className="h-4 w-4" /> {showForm ? "Cancel" : "Add invoice"}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Invoices on file</div>
          <div className="text-2xl font-semibold mt-1">{invoices.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Total billed</div>
          <div className="text-2xl font-semibold mt-1">{fmtUSD(totalUsd)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Outstanding</div>
          <div className="text-2xl font-semibold mt-1">{fmtUSD(unpaidUsd)}</div>
        </Card>
      </div>

      {showForm && (
        <Card className="p-4">
          <form onSubmit={createInvoice} className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <label>Invoice number
              <input value={form.invoiceNumber} onChange={e => setForm(f => ({ ...f, invoiceNumber: e.target.value }))} placeholder="Optional" className="mt-1 w-full border rounded px-2 py-1.5 bg-background" />
            </label>
            <label>Issue date *
              <input type="date" required value={form.issueDate} onChange={e => setForm(f => ({ ...f, issueDate: e.target.value }))} className="mt-1 w-full border rounded px-2 py-1.5 bg-background" />
            </label>
            <label>Period start *
              <input type="date" required value={form.periodStart} onChange={e => setForm(f => ({ ...f, periodStart: e.target.value }))} className="mt-1 w-full border rounded px-2 py-1.5 bg-background" />
            </label>
            <label>Period end *
              <input type="date" required value={form.periodEnd} onChange={e => setForm(f => ({ ...f, periodEnd: e.target.value }))} className="mt-1 w-full border rounded px-2 py-1.5 bg-background" />
            </label>
            <label>Amount (USD) *
              <input type="number" step="0.01" required value={form.amountUsd} onChange={e => setForm(f => ({ ...f, amountUsd: e.target.value }))} className="mt-1 w-full border rounded px-2 py-1.5 bg-background" />
            </label>
            <label>Amount (MYR)
              <input type="number" step="0.01" value={form.amountMyr} onChange={e => setForm(f => ({ ...f, amountMyr: e.target.value }))} placeholder="Optional FX conversion" className="mt-1 w-full border rounded px-2 py-1.5 bg-background" />
            </label>
            <label className="md:col-span-2">PDF URL
              <input type="url" value={form.pdfUrl} onChange={e => setForm(f => ({ ...f, pdfUrl: e.target.value }))} placeholder="Drive/Supabase storage link" className="mt-1 w-full border rounded px-2 py-1.5 bg-background" />
            </label>
            <label className="md:col-span-2">Notes
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="mt-1 w-full border rounded px-2 py-1.5 bg-background" />
            </label>
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" disabled={saving} className="gap-2">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save invoice
              </Button>
            </div>
          </form>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : invoices.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          No invoices logged yet. Click <span className="font-medium">Add invoice</span> after downloading a bill from <a href="https://employers.indeed.com/billing" target="_blank" rel="noopener noreferrer" className="text-terracotta hover:underline">employers.indeed.com/billing</a>.
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-900 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-normal">Invoice #</th>
                <th className="px-4 py-2 text-left font-normal">Issue date</th>
                <th className="px-4 py-2 text-left font-normal">Period</th>
                <th className="px-4 py-2 text-right font-normal">USD</th>
                <th className="px-4 py-2 text-right font-normal">MYR</th>
                <th className="px-4 py-2 text-left font-normal">Status</th>
                <th className="px-4 py-2 text-left font-normal">PDF</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} className="border-t">
                  <td className="px-4 py-2 font-mono text-xs">{inv.invoiceNumber ?? "—"}</td>
                  <td className="px-4 py-2">{fmtDate(inv.issueDate)}</td>
                  <td className="px-4 py-2 text-muted-foreground text-xs">{fmtDate(inv.periodStart)} → {fmtDate(inv.periodEnd)}</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">{fmtUSD(inv.amountUsd)}</td>
                  <td className="px-4 py-2 text-right text-muted-foreground tabular-nums">{fmtMYR(inv.amountMyr)}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => toggleStatus(inv)}
                      disabled={togglingId === inv.id}
                      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
                        inv.status === "paid"
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                          : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                      }`}
                    >
                      {togglingId === inv.id ? <Loader2 className="h-3 w-3 animate-spin" /> :
                       inv.status === "paid" ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                      {inv.status}
                    </button>
                  </td>
                  <td className="px-4 py-2">
                    {inv.pdfUrl ? (
                      <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-terracotta hover:underline inline-flex items-center gap-0.5 text-xs">
                        Open <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : <span className="text-muted-foreground text-xs">—</span>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => deleteInvoice(inv.id)} className="text-muted-foreground hover:text-rose-600">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
