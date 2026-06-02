"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Printer, ChevronLeft } from "lucide-react";
import { adminFetch } from "@/lib/pickup/admin-fetch";
import { toast } from "@celsius/ui";
import { ReportsTabs } from "../_ReportsTabs";

/**
 * POS → Z-Report
 *
 * List of shifts (default last 30d) with the per-shift cash-up totals.
 * Clicking a row loads the detail panel inline — no separate route, so
 * the back button just clears the selected shift state.
 *
 * The print slip is 80mm-formatted using the same print-zone pattern
 * the KDS uses (apps/order/src/app/staff/kds/page.tsx) — a hidden
 * <div> + an injected <style> tag that nukes everything else under
 * @media print. We bake the slip HTML in JS rather than building a
 * separate route because the BO doesn't need an embedded print preview
 * — operators print directly from the receipt printer.
 */

type ShiftRow = {
  id: string;
  outlet_id: string;
  outlet_name: string;
  register_id: string;
  register_name: string;
  opened_by: string | null;
  opened_by_name: string;
  closed_by: string | null;
  closed_by_name: string | null;
  opened_at: string;
  closed_at: string | null;
  status: "open" | "closed";
  gross_sales: number;
  net_sales: number;
  discounts: number;
  tax: number;
  tendered_cash: number;
  tendered_card: number;
  tendered_ewallet: number;
  variance: number | null;
};

type ShiftDetail = {
  shift: {
    id: string;
    outlet_id: string;
    outlet_name: string;
    register_id: string;
    register_name: string;
    opened_at: string;
    closed_at: string | null;
    opened_by_name: string;
    closed_by_name: string | null;
    status: "open" | "closed";
    opening_cash: number | null;
    closing_cash: number | null;
    paid_in: number | null;
    paid_out: number | null;
    cash_refunds: number;
    expected_close: number | null;
    variance: number | null;
  };
  summary: {
    gross_sales: number;
    net_sales: number;
    discounts: number;
    tax: number;
    refunds_total: number;
    voids_count: number;
    voids_total: number;
    transactions: number;
    cash_total: number;
    card_total: number;
    ewallet_total: number;
  };
  payments: { method: string; count: number; total: number }[];
  categories: { category: string; qty: number; revenue: number }[];
  top_products: { name: string; qty: number; revenue: number }[];
};

const formatRM = (sen: number | null) =>
  sen == null
    ? "—"
    : `RM ${(sen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Asia/Kuala_Lumpur display helpers — UTC timestamps in DB need
// conversion for the operator. Using Intl avoids a date library.
function klDateOnly(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}
function klDateTime(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(d);
}

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const to = klDateOnly(now);
  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - 30);
  return { from: klDateOnly(fromDate), to };
}

export default function ZReportPage() {
  const [{ from, to }, setRange] = useState(defaultRange);
  const [outletFilter, setOutletFilter] = useState<string>(""); // "" = all
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingList(true);
      try {
        const params = new URLSearchParams({ from, to });
        if (outletFilter) params.set("outlet_id", outletFilter);
        const res = await adminFetch(`/api/pos/z-report?${params.toString()}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Load failed");
        }
        const json = (await res.json()) as { shifts: ShiftRow[] };
        if (!cancelled) setShifts(json.shifts);
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Failed to load shifts");
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    })();
    return () => { cancelled = true; };
  }, [from, to, outletFilter]);

  // Distinct outlets in the current result — feeds the filter dropdown.
  const outletOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of shifts) seen.set(s.outlet_id, s.outlet_name);
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [shifts]);

  if (selectedShiftId) {
    return (
      <ShiftDetailView
        shiftId={selectedShiftId}
        onBack={() => setSelectedShiftId(null)}
      />
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-5 max-w-7xl">
      <ReportsTabs />
      <div>
        <h1 className="text-2xl font-bold text-[#160800]">Z-Report (Shift Close)</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Per-shift sales totals. Click any row to view detail and print the Z-slip.
        </p>
      </div>

      {/* Filters */}
      <div className="rounded-2xl bg-white p-4 border border-gray-100 grid grid-cols-1 sm:grid-cols-3 gap-3">
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
        <div>
          <label className="text-xs text-gray-600 mb-1 block">Outlet</label>
          <select
            value={outletFilter}
            onChange={(e) => setOutletFilter(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#A2492C] bg-white"
          >
            <option value="">All outlets</option>
            {outletOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
      </div>

      {loadingList && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      )}

      {!loadingList && (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px]">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-700">
                  <th className="px-4 py-3">Outlet</th>
                  <th className="px-4 py-3">Register</th>
                  <th className="px-4 py-3">Cashier</th>
                  <th className="px-4 py-3">Opened</th>
                  <th className="px-4 py-3">Closed</th>
                  <th className="px-4 py-3 text-right">Gross</th>
                  <th className="px-4 py-3 text-right">Net</th>
                  <th className="px-4 py-3 text-right">Discounts</th>
                  <th className="px-4 py-3 text-right">Tax</th>
                  <th className="px-4 py-3 text-right">Card</th>
                  <th className="px-4 py-3 text-right">E-wallet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {shifts.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-10 text-center text-sm text-gray-500">
                      No shifts in this range.
                    </td>
                  </tr>
                ) : (
                  shifts.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => setSelectedShiftId(s.id)}
                      className="hover:bg-[#FBEBE8]/40 cursor-pointer"
                    >
                      <td className="px-4 py-3 text-sm text-[#160800]">{s.outlet_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{s.register_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{s.opened_by_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{klDateTime(s.opened_at)}</td>
                      <td className="px-4 py-3 text-sm">
                        {s.closed_at ? (
                          <span className="text-gray-600">{klDateTime(s.closed_at)}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#A2492C]">
                            <span className="h-1.5 w-1.5 rounded-full bg-[#A2492C] animate-pulse" />
                            Open
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-right">{formatRM(s.gross_sales)}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium">{formatRM(s.net_sales)}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-500">{formatRM(s.discounts)}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-500">{formatRM(s.tax)}</td>
                      <td className="px-4 py-3 text-sm text-right">{formatRM(s.tendered_card)}</td>
                      <td className="px-4 py-3 text-sm text-right">{formatRM(s.tendered_ewallet)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Detail view ──────────────────────────────────────────────────────────────

function ShiftDetailView({ shiftId, onBack }: { shiftId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<ShiftDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await adminFetch(`/api/pos/z-report?shift_id=${encodeURIComponent(shiftId)}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Load failed");
        }
        const json = (await res.json()) as ShiftDetail;
        if (!cancelled) setDetail(json);
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Failed to load shift");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [shiftId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="p-6">
        <button onClick={onBack} className="text-sm text-[#A2492C] hover:underline">
          ← Back
        </button>
        <p className="mt-3 text-sm text-gray-600">Shift not found.</p>
      </div>
    );
  }

  const { shift, summary, payments, categories, top_products } = detail;

  return (
    <div className="p-3 sm:p-6 space-y-5 max-w-5xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="rounded-lg p-2 hover:bg-gray-100"
            aria-label="Back"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[#160800]">Z-Report</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {shift.outlet_name} · {shift.register_name} · Shift {shift.id.slice(0, 8)}
            </p>
          </div>
        </div>
        <button
          onClick={() => printZReport(detail)}
          className="inline-flex items-center gap-2 rounded-lg bg-[#160800] px-3 py-2 text-sm font-medium text-white hover:bg-black"
        >
          <Printer className="h-4 w-4" />
          Print Z-Report
        </button>
      </div>

      {/* Shift header */}
      <Section title="Shift">
        <Grid cols={4}>
          <Field label="Status">
            <span className={`text-sm font-medium ${shift.status === "open" ? "text-[#A2492C]" : "text-[#160800]"}`}>
              {shift.status === "open" ? "Open" : "Closed"}
            </span>
          </Field>
          <Field label="Cashier">{shift.opened_by_name}</Field>
          <Field label="Opened">{klDateTime(shift.opened_at)}</Field>
          <Field label="Closed">{shift.closed_at ? klDateTime(shift.closed_at) : "—"}</Field>
        </Grid>
      </Section>

      {/* Sales summary */}
      <Section title="Sales">
        <Grid cols={4}>
          <Field label="Gross Sales">{formatRM(summary.gross_sales)}</Field>
          <Field label="Discounts">−{formatRM(summary.discounts)}</Field>
          <Field label="Tax">{formatRM(summary.tax)}</Field>
          <Field label="Net Sales" bold>{formatRM(summary.net_sales)}</Field>
          <Field label="Transactions">{String(summary.transactions)}</Field>
          <Field label="Refunds">−{formatRM(summary.refunds_total)}</Field>
          <Field label="Voids">
            {summary.voids_count > 0 ? `${summary.voids_count} (${formatRM(summary.voids_total)})` : "0"}
          </Field>
        </Grid>
      </Section>

      {/* Payment-method breakdown */}
      <Section title="Payment Methods">
        {payments.length === 0 ? (
          <p className="text-sm text-gray-500">No payments recorded.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-100">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 text-left text-xs font-medium text-gray-700 border-b border-gray-100">
                  <th className="px-3 py-2">Method</th>
                  <th className="px-3 py-2 text-right">Transactions</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {payments.map((p) => (
                  <tr key={p.method}>
                    <td className="px-3 py-2 text-sm text-[#160800]">{p.method}</td>
                    <td className="px-3 py-2 text-sm text-right">{p.count}</td>
                    <td className="px-3 py-2 text-sm text-right font-medium">{formatRM(p.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Cashless register — no cash drawer / variance section. */}

      {/* Sales by category */}
      <Section title="By Category">
        {categories.length === 0 ? (
          <p className="text-sm text-gray-500">No items recorded.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-100">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 text-left text-xs font-medium text-gray-700 border-b border-gray-100">
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {categories.map((c) => (
                  <tr key={c.category}>
                    <td className="px-3 py-2 text-sm text-[#160800]">{c.category}</td>
                    <td className="px-3 py-2 text-sm text-right">{c.qty}</td>
                    <td className="px-3 py-2 text-sm text-right font-medium">{formatRM(c.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Top 5 products */}
      <Section title="Top 5 Products">
        {top_products.length === 0 ? (
          <p className="text-sm text-gray-500">No products recorded.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-100">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 text-left text-xs font-medium text-gray-700 border-b border-gray-100">
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {top_products.map((p) => (
                  <tr key={p.name}>
                    <td className="px-3 py-2 text-sm text-[#160800]">{p.name}</td>
                    <td className="px-3 py-2 text-sm text-right">{p.qty}</td>
                    <td className="px-3 py-2 text-sm text-right font-medium">{formatRM(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

// ── Layout atoms ─────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">{title}</h2>
      <div className="rounded-2xl bg-white p-4 border border-gray-100">{children}</div>
    </div>
  );
}

function Grid({ cols, children }: { cols: 3 | 4; children: React.ReactNode }) {
  return (
    <div className={`grid gap-3 grid-cols-2 ${cols === 4 ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
      {children}
    </div>
  );
}

function Field({ label, children, bold }: { label: string; children: React.ReactNode; bold?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`mt-0.5 text-sm text-[#160800] ${bold ? "font-bold" : ""}`}>{children}</p>
    </div>
  );
}

function Line({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: "warn" }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className={`text-sm ${bold ? "font-bold text-[#160800]" : "text-gray-600"}`}>{label}</span>
      <span className={`text-sm tabular-nums ${bold ? "font-bold" : ""} ${tone === "warn" ? "text-red-600" : "text-[#160800]"}`}>
        {value}
      </span>
    </div>
  );
}

// ── Print helper ─────────────────────────────────────────────────────────────

function printZReport(detail: ShiftDetail) {
  // 80mm thermal slip. We render into a hidden #z-print-zone and let
  // @media print swap the visible DOM. Pattern mirrors the KDS print
  // helper in apps/order/src/app/staff/kds/page.tsx.
  const html = buildZSlipHtml(detail);
  let zone = document.getElementById("z-print-zone");
  if (!zone) {
    zone = document.createElement("div");
    zone.id = "z-print-zone";
    document.body.appendChild(zone);
  }
  zone.innerHTML = html;

  if (!document.getElementById("z-print-styles")) {
    const style = document.createElement("style");
    style.id = "z-print-styles";
    style.textContent = `
      #z-print-zone { display: none; }
      @media print {
        body > *:not(#z-print-zone) {
          display: none !important;
          visibility: hidden !important;
          height: 0 !important;
          overflow: hidden !important;
        }
        #z-print-zone {
          display: block !important;
          position: fixed; top: 0; left: 0; width: 80mm;
          padding: 2mm 4mm; background: #fff; color: #000;
          font-family: 'Courier New', Courier, monospace;
          font-size: 12px; z-index: 999999;
        }
        @page { size: 80mm auto; margin: 0; }
      }
    `;
    document.head.appendChild(style);
  }
  setTimeout(() => window.print(), 100);
}

function buildZSlipHtml(d: ShiftDetail): string {
  const { shift, summary, payments, top_products } = d;
  const rm = (sen: number | null) => sen == null ? "—" : (sen / 100).toFixed(2);
  const line = (left: string, right: string) =>
    `<div style="display:flex;justify-content:space-between;"><span>${left}</span><span>${right}</span></div>`;
  const hr = `<div style="border-top:1px dashed #000;margin:2mm 0;"></div>`;
  const center = (s: string, big = false) =>
    `<div style="text-align:center;${big ? "font-size:14px;font-weight:bold;" : ""}">${s}</div>`;

  return `
    ${center("CELSIUS COFFEE", true)}
    ${center(shift.outlet_name)}
    ${center(`Z-REPORT · ${shift.register_name}`)}
    ${hr}
    ${line("Shift", shift.id.slice(0, 8))}
    ${line("Cashier", shift.opened_by_name)}
    ${line("Opened", new Date(shift.opened_at).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" }))}
    ${line("Closed", shift.closed_at ? new Date(shift.closed_at).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" }) : "(open)")}
    ${hr}
    ${center("SALES")}
    ${line("Gross", rm(summary.gross_sales))}
    ${line("Discounts", `-${rm(summary.discounts)}`)}
    ${line("Tax", rm(summary.tax))}
    ${line("Refunds", `-${rm(summary.refunds_total)}`)}
    ${line("Net", rm(summary.net_sales))}
    ${line("Txns", String(summary.transactions))}
    ${hr}
    ${center("PAYMENTS")}
    ${payments.map((p) => line(`${p.method} x${p.count}`, rm(p.total))).join("")}
    ${hr}
    ${center("TOP PRODUCTS")}
    ${top_products.map((p) => line(`${p.name} x${p.qty}`, rm(p.revenue))).join("")}
    ${hr}
    ${center("End of Z-Report")}
    <div style="height:8mm;"></div>
  `;
}
