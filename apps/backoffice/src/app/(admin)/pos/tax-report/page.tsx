"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Download, Filter } from "lucide-react";
import { adminFetch } from "@/lib/pickup/admin-fetch";
import { toast } from "@celsius/ui";
import { ReportsTabs } from "../_ReportsTabs";

/**
 * POS → Tax Report
 *
 * Monthly tax-filing view. Groups completed orders by outlet + tax rate
 * so the totals reconcile straight to the SST return. Defaults to MTD
 * (Asia/Kuala_Lumpur). Money is exchanged with the API in sen and only
 * converted to RM at display + export time.
 */

type TaxRow = {
  outlet_id: string;
  outlet_name: string;
  tax_rate: number;
  taxable_sales: number;
  tax_collected: number;
  transactions: number;
};

type Outlet = { id: string; name: string };

type Response = {
  rows: TaxRow[];
  outlets: Outlet[];
  total: { taxable_sales: number; tax_collected: number; transactions: number };
};

// Build a YYYY-MM-DD string for "today" / "first-of-month" in
// Asia/Kuala_Lumpur regardless of the browser's local timezone. Using
// toLocaleDateString lets us avoid pulling in a date library.
function klDate(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

function defaultRange(): { from: string; to: string } {
  const today = klDate(new Date());
  const firstOfMonth = today.slice(0, 7) + "-01";
  return { from: firstOfMonth, to: today };
}

const formatRM = (sen: number) =>
  `RM ${(sen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatRate = (r: number) => `${r.toFixed(r % 1 === 0 ? 0 : 2)}%`;

export default function TaxReportPage() {
  const [{ from, to }, setRange] = useState(defaultRange);
  const [selectedOutlets, setSelectedOutlets] = useState<string[]>([]); // empty = all
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ from, to });
        if (selectedOutlets.length > 0) params.set("outlet_ids", selectedOutlets.join(","));
        const res = await adminFetch(`/api/pos/tax-report?${params.toString()}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Load failed");
        }
        const json = (await res.json()) as Response;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Failed to load tax report");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [from, to, selectedOutlets]);

  const outlets = data?.outlets ?? [];
  const rows = data?.rows ?? [];
  const total = data?.total ?? { taxable_sales: 0, tax_collected: 0, transactions: 0 };

  const toggleOutlet = (id: string) => {
    setSelectedOutlets((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleExport = () => {
    // Build CSV with the same column set + a total row. Quote fields so
    // outlet names containing commas don't break the format.
    const q = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
    const lines: string[] = [];
    lines.push([
      q("Outlet"),
      q("Tax Rate"),
      q("Taxable Sales (RM)"),
      q("Tax Collected (RM)"),
      q("Transactions"),
    ].join(","));
    for (const r of rows) {
      lines.push([
        q(r.outlet_name),
        q(formatRate(r.tax_rate)),
        q((r.taxable_sales / 100).toFixed(2)),
        q((r.tax_collected / 100).toFixed(2)),
        q(r.transactions),
      ].join(","));
    }
    lines.push([
      q("TOTAL"),
      q(""),
      q((total.taxable_sales / 100).toFixed(2)),
      q((total.tax_collected / 100).toFixed(2)),
      q(total.transactions),
    ].join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tax-report-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Pretty header subtitle e.g. "May 2026 — MTD".
  const subtitle = useMemo(() => {
    const today = defaultRange();
    if (from === today.from && to === today.to) {
      const month = new Date(`${from}-01T00:00:00+08:00`).toLocaleString("en-MY", {
        month: "long", year: "numeric",
      });
      return `${month} — month-to-date`;
    }
    return `${from} → ${to}`;
  }, [from, to]);

  return (
    <div className="p-3 sm:p-6 space-y-5 max-w-6xl">
      <ReportsTabs />
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[#160800]">Tax Report</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Completed POS sales grouped by outlet and tax rate. {subtitle}
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={rows.length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-[#160800] px-3 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="rounded-2xl bg-white p-4 border border-gray-100 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-500">
          <Filter className="h-3.5 w-3.5" />
          Filters
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-600 mb-1 block">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              max={to}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#A2492C]"
            />
          </div>
          <div>
            <label className="text-xs text-gray-600 mb-1 block">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              min={from}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#A2492C]"
            />
          </div>
        </div>
        {/* Outlet multi-select — chip toggles so 4 outlets fit in one
            row without needing a dropdown component. */}
        <div>
          <label className="text-xs text-gray-600 mb-1.5 block">
            Outlets {selectedOutlets.length === 0 ? "(all)" : `(${selectedOutlets.length} selected)`}
          </label>
          <div className="flex flex-wrap gap-2">
            {outlets.map((o) => {
              const active = selectedOutlets.includes(o.id);
              return (
                <button
                  key={o.id}
                  onClick={() => toggleOutlet(o.id)}
                  className={`rounded-full px-3 py-1 text-xs border transition-colors ${
                    active
                      ? "bg-[#160800] text-white border-[#160800]"
                      : "bg-white text-gray-700 border-gray-200 hover:border-[#A2492C]"
                  }`}
                >
                  {o.name}
                </button>
              );
            })}
            {selectedOutlets.length > 0 && (
              <button
                onClick={() => setSelectedOutlets([])}
                className="rounded-full px-3 py-1 text-xs text-[#A2492C] hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KpiCard label="Taxable Sales"  value={formatRM(total.taxable_sales)} />
        <KpiCard label="Tax Collected"  value={formatRM(total.tax_collected)} />
        <KpiCard label="Transactions"   value={String(total.transactions)} />
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      )}

      {!loading && (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-700">
                <th className="px-4 py-3">Outlet</th>
                <th className="px-4 py-3 text-right">Tax Rate</th>
                <th className="px-4 py-3 text-right">Taxable Sales</th>
                <th className="px-4 py-3 text-right">Tax Collected</th>
                <th className="px-4 py-3 text-right">Transactions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500">
                    No completed sales in this range.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={`${r.outlet_id}|${r.tax_rate}`} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-[#160800]">{r.outlet_name}</td>
                    <td className="px-4 py-3 text-sm text-[#160800] text-right">{formatRate(r.tax_rate)}</td>
                    <td className="px-4 py-3 text-sm text-[#160800] text-right">{formatRM(r.taxable_sales)}</td>
                    <td className="px-4 py-3 text-sm font-medium text-[#160800] text-right">{formatRM(r.tax_collected)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 text-right">{r.transactions}</td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold text-[#160800]">
                  <td className="px-4 py-3 text-sm">Total</td>
                  <td className="px-4 py-3 text-sm text-right">—</td>
                  <td className="px-4 py-3 text-sm text-right">{formatRM(total.taxable_sales)}</td>
                  <td className="px-4 py-3 text-sm text-right">{formatRM(total.tax_collected)}</td>
                  <td className="px-4 py-3 text-sm text-right">{total.transactions}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 border border-gray-100">
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-[#160800]">{value}</p>
    </div>
  );
}
