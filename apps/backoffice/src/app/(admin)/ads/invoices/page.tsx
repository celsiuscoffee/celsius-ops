"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Card } from "@/components/ui/card";
import { Loader2, Download, FileText, ShieldCheck } from "lucide-react";

type Invoice = {
  id: string;
  invoiceId: string;
  accountName: string;
  issueDate: string;
  periodStart: string;
  periodEnd: string;
  subtotalMYR: number;
  taxMYR: number;
  totalMYR: number;
  currency: string;
  status: string;
  hasPdf: boolean;
  pdfSizeBytes: number | null;
  pdfHash: string | null;
};

function fmtMYR(n: number): string {
  return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR", maximumFractionDigits: 2 }).format(n);
}

export default function InvoicesPage() {
  const year = new Date().getUTCFullYear();
  const [selectedYear, setSelectedYear] = useState(year);
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading } = useFetch<{ invoices: Invoice[]; summary: { totalMYR: number; taxMYR: number; count: number } }>(
    `/api/ads/invoices?year=${selectedYear}`
  );

  async function downloadPdf(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/ads/invoices/${id}/download`);
      if (!res.ok) {
        alert("Failed to get signed URL");
        return;
      }
      const { url } = await res.json();
      window.open(url, "_blank");
    } finally {
      setBusy(null);
    }
  }

  if (isLoading || !data) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-neutral-400" /></div>;
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Ads Invoices</h1>
        <select
          value={selectedYear}
          onChange={(e) => setSelectedYear(Number(e.target.value))}
          className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm"
        >
          {[year, year - 1, year - 2].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-xs text-neutral-500">Total {selectedYear}</div>
          <div className="mt-1 text-xl font-semibold">{fmtMYR(data.summary.totalMYR)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-neutral-500">Tax (SST)</div>
          <div className="mt-1 text-xl font-semibold">{fmtMYR(data.summary.taxMYR)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-neutral-500">Invoices</div>
          <div className="mt-1 text-xl font-semibold">{data.summary.count}</div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-2 text-[11px] text-neutral-500">
          <ShieldCheck className="h-3.5 w-3.5" />
          Invoices stored in Supabase with SHA256 integrity checksums. Retain for 7 years per LHDN requirements.
        </div>
        {data.invoices.length === 0 ? (
          <p className="p-8 text-center text-sm text-neutral-500">No invoices yet. Run an invoice sync from Settings.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2 text-left font-normal">Invoice #</th>
                  <th className="px-3 py-2 text-left font-normal">Account</th>
                  <th className="px-3 py-2 text-left font-normal">Issued</th>
                  <th className="px-3 py-2 text-left font-normal">Period</th>
                  <th className="px-3 py-2 text-right font-normal">Subtotal</th>
                  <th className="px-3 py-2 text-right font-normal">Tax</th>
                  <th className="px-3 py-2 text-right font-normal">Total</th>
                  <th className="px-3 py-2 text-left font-normal">Status</th>
                  <th className="px-3 py-2 text-right font-normal">PDF</th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((i) => (
                  <tr key={i.id} className="border-t border-neutral-100 hover:bg-neutral-50">
                    <td className="px-3 py-2 font-mono text-xs">{i.invoiceId}</td>
                    <td className="px-3 py-2">{i.accountName}</td>
                    <td className="px-3 py-2">{i.issueDate}</td>
                    <td className="px-3 py-2 text-xs text-neutral-500">{i.periodStart} → {i.periodEnd}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMYR(i.subtotalMYR)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMYR(i.taxMYR)}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{fmtMYR(i.totalMYR)}</td>
                    <td className="px-3 py-2 text-xs">{i.status}</td>
                    <td className="px-3 py-2 text-right">
                      {i.hasPdf ? (
                        <button
                          onClick={() => downloadPdf(i.id)}
                          disabled={busy === i.id}
                          className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
                          title={i.pdfHash ? `SHA256: ${i.pdfHash.slice(0, 16)}...` : undefined}
                        >
                          {busy === i.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                          PDF
                        </button>
                      ) : (
                        <span className="text-neutral-300"><FileText className="inline h-3.5 w-3.5" /></span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
