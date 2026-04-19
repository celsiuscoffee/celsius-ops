"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Card } from "@/components/ui/card";
import { Loader2, ChevronDown, ChevronRight, ShieldCheck, Download } from "lucide-react";

type StatementItem = {
  campaignId: string;
  campaignName: string;
  outletId: string | null;
  outletName: string | null;
  subtotalMYR: number;
  taxMYR: number;
  totalMYR: number;
};

type MonthStatement = {
  yearMonth: string;
  items: StatementItem[];
  subtotalMYR: number;
  taxMYR: number;
  totalMYR: number;
};

type Data = {
  year: number;
  sstRate: number;
  statements: MonthStatement[];
  summary: { subtotalMYR: number; taxMYR: number; totalMYR: number; monthCount: number };
};

function fmtMYR(n: number): string {
  return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR", maximumFractionDigits: 2 }).format(n);
}

function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-MY", { month: "long", year: "numeric", timeZone: "UTC" });
}

function downloadCsv(data: Data) {
  const rows: string[] = ["Month,Campaign,Outlet,Subtotal (MYR),SST 8% (MYR),Total (MYR)"];
  for (const m of data.statements) {
    for (const i of m.items) {
      rows.push([
        m.yearMonth,
        `"${i.campaignName.replace(/"/g, '""')}"`,
        i.outletName ?? "",
        i.subtotalMYR.toFixed(2),
        i.taxMYR.toFixed(2),
        i.totalMYR.toFixed(2),
      ].join(","));
    }
  }
  rows.push([`Total ${data.year}`, "", "", data.summary.subtotalMYR.toFixed(2), data.summary.taxMYR.toFixed(2), data.summary.totalMYR.toFixed(2)].join(","));
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ads-statement-${data.year}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function InvoicesPage() {
  const currentYear = new Date().getUTCFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { data, isLoading } = useFetch<Data>(`/api/ads/invoices?year=${selectedYear}`);

  if (isLoading || !data) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-neutral-400" /></div>;
  }

  function toggle(ym: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ym)) next.delete(ym); else next.add(ym);
      return next;
    });
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Ads Statements</h1>
          <p className="text-xs text-neutral-500">Per-campaign monthly spend with 8% SST (Service Tax on digital services, MY)</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm"
          >
            {[currentYear, currentYear - 1, currentYear - 2].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button
            onClick={() => downloadCsv(data)}
            className="flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* YTD summary */}
      <div className="grid grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-xs text-neutral-500">Subtotal {selectedYear}</div>
          <div className="mt-1 text-xl font-semibold">{fmtMYR(data.summary.subtotalMYR)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-neutral-500">SST (8%)</div>
          <div className="mt-1 text-xl font-semibold">{fmtMYR(data.summary.taxMYR)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-neutral-500">Total w/ Tax</div>
          <div className="mt-1 text-xl font-semibold">{fmtMYR(data.summary.totalMYR)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-neutral-500">Months</div>
          <div className="mt-1 text-xl font-semibold">{data.summary.monthCount}</div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-2 text-[11px] text-neutral-500">
          <ShieldCheck className="h-3.5 w-3.5" />
          Generated from actual spend data synced daily from Google Ads API. Retain CSV + this report for 7 years per LHDN requirements.
        </div>

        {data.statements.length === 0 ? (
          <p className="p-8 text-center text-sm text-neutral-500">
            No spend data for {selectedYear}. Run a sync from Settings to pull historical metrics.
          </p>
        ) : (
          <div>
            {data.statements.map((m) => {
              const isOpen = expanded.has(m.yearMonth);
              return (
                <div key={m.yearMonth} className="border-b border-neutral-100 last:border-0">
                  <button
                    onClick={() => toggle(m.yearMonth)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-neutral-50"
                  >
                    <div className="flex items-center gap-2">
                      {isOpen ? <ChevronDown className="h-4 w-4 text-neutral-400" /> : <ChevronRight className="h-4 w-4 text-neutral-400" />}
                      <span className="font-medium">{fmtMonth(m.yearMonth)}</span>
                      <span className="text-xs text-neutral-400">({m.items.length} campaigns)</span>
                    </div>
                    <div className="flex items-center gap-6 text-sm tabular-nums">
                      <span className="text-neutral-500">{fmtMYR(m.subtotalMYR)}</span>
                      <span className="text-neutral-500">+{fmtMYR(m.taxMYR)} SST</span>
                      <span className="font-semibold min-w-[90px] text-right">{fmtMYR(m.totalMYR)}</span>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="border-t border-neutral-100 bg-neutral-50/50">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-neutral-500">
                            <th className="px-4 py-2 text-left font-normal">Campaign</th>
                            <th className="px-4 py-2 text-left font-normal">Outlet</th>
                            <th className="px-4 py-2 text-right font-normal">Subtotal</th>
                            <th className="px-4 py-2 text-right font-normal">SST 8%</th>
                            <th className="px-4 py-2 text-right font-normal">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {m.items.map((i) => (
                            <tr key={i.campaignId} className="border-t border-neutral-100">
                              <td className="px-4 py-2">{i.campaignName}</td>
                              <td className="px-4 py-2 text-xs text-neutral-500">{i.outletName ?? "—"}</td>
                              <td className="px-4 py-2 text-right tabular-nums">{fmtMYR(i.subtotalMYR)}</td>
                              <td className="px-4 py-2 text-right tabular-nums">{fmtMYR(i.taxMYR)}</td>
                              <td className="px-4 py-2 text-right font-medium tabular-nums">{fmtMYR(i.totalMYR)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
