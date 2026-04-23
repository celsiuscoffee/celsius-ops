"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Card } from "@/components/ui/card";
import { Loader2, ChevronDown, ChevronRight, ShieldCheck, Download, CheckCircle2, Upload, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type CampaignItem = {
  campaignId: string;
  campaignName: string;
  subtotalMYR: number;
  taxMYR: number;
  totalMYR: number;
};

type Payment = {
  id: string;
  status: string;
  paidAt: string | null;
  paymentMethod: string | null;
  referenceNumber: string | null;
  popPhotos: string[];
  notes: string | null;
};

type OutletRow = {
  outletId: string | null;
  outletName: string;
  campaigns: CampaignItem[];
  subtotalMYR: number;
  taxMYR: number;
  totalMYR: number;
  payment: Payment | null;
};

type MonthStatement = {
  yearMonth: string;
  outlets: OutletRow[];
  subtotalMYR: number;
  taxMYR: number;
  totalMYR: number;
};

type Data = {
  year: number;
  sstRate: number;
  statements: MonthStatement[];
  summary: { subtotalMYR: number; taxMYR: number; totalMYR: number; monthCount: number; claimedMYR: number; paidMYR: number; outstandingMYR: number };
};

function fmtMYR(n: number): string {
  return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR", maximumFractionDigits: 2 }).format(n);
}

function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-MY", { month: "long", year: "numeric", timeZone: "UTC" });
}

function downloadCsv(data: Data) {
  const rows: string[] = ["Month,Outlet,Subtotal (MYR),SST 8% (MYR),Total (MYR),Status,Paid date,Method,Reference"];
  for (const m of data.statements) {
    for (const o of m.outlets) {
      rows.push([
        m.yearMonth,
        `"${o.outletName.replace(/"/g, '""')}"`,
        o.subtotalMYR.toFixed(2),
        o.taxMYR.toFixed(2),
        o.totalMYR.toFixed(2),
        o.payment?.status ?? "OUTSTANDING",
        o.payment?.paidAt ? o.payment.paidAt.slice(0, 10) : "",
        o.payment?.paymentMethod ?? "",
        o.payment?.referenceNumber ?? "",
      ].join(","));
    }
  }
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ads-claims-${data.year}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function isReimbursed(p: Payment | null): boolean {
  return p?.status === "PAID" || p?.status === "VERIFIED";
}

function StatusPill({ p }: { p: Payment | null }) {
  if (isReimbursed(p)) return <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-700"><CheckCircle2 className="h-3 w-3" />Reimbursed</span>;
  return <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-neutral-500">Outstanding</span>;
}

export default function StatementsPage() {
  const currentYear = new Date().getUTCFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [outletId, setOutletId] = useState<string>("all");
  const [campaignId, setCampaignId] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<"all" | "reimbursed" | "outstanding">("all");

  const qs = new URLSearchParams({ year: String(selectedYear) });
  if (outletId !== "all") qs.set("outletId", outletId);
  if (campaignId !== "all") qs.set("campaignId", campaignId);

  const { data, isLoading, mutate } = useFetch<Data>(`/api/ads/invoices?${qs.toString()}`);
  const { data: outletList } = useFetch<Array<{ id: string; name: string }>>("/api/ops/outlets");
  const { data: campaignData } = useFetch<{ campaigns: Array<{ id: string; name: string; outletId: string | null }> }>("/api/ads/campaigns?days=365");

  const campaignOptions = (campaignData?.campaigns ?? []).filter((c) => {
    if (outletId === "all") return true;
    if (outletId === "unlinked") return c.outletId == null;
    return c.outletId === outletId;
  });

  // Dialog state for claim/payment
  const [dlg, setDlg] = useState<{ yearMonth: string; row: OutletRow } | null>(null);
  const [saving, setSaving] = useState(false);
  const [dlgPaidAt, setDlgPaidAt] = useState<string>(new Date().toISOString().slice(0, 10));
  const [dlgMethod, setDlgMethod] = useState<string>("PERSONAL_CARD");
  const [dlgRef, setDlgRef] = useState<string>("");
  const [dlgNotes, setDlgNotes] = useState<string>("");
  const [popBusy, setPopBusy] = useState<string | null>(null);

  function openDialog(yearMonth: string, row: OutletRow) {
    setDlg({ yearMonth, row });
    const p = row.payment;
    setDlgPaidAt(p?.paidAt ? p.paidAt.slice(0, 10) : new Date().toISOString().slice(0, 10));
    setDlgMethod(p?.paymentMethod ?? "PERSONAL_CARD");
    setDlgRef(p?.referenceNumber ?? "");
    setDlgNotes(p?.notes ?? "");
  }

  async function ensurePayment(ym: string, row: OutletRow): Promise<string> {
    if (row.payment) return row.payment.id;
    const res = await fetch("/api/ads/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        yearMonth: ym,
        outletId: row.outletId,
        campaignId: null,
        subtotalMYR: row.subtotalMYR,
        taxMYR: row.taxMYR,
        totalMYR: row.totalMYR,
      }),
    });
    if (!res.ok) throw new Error("Failed to create claim");
    return (await res.json()).id;
  }

  async function saveClaim() {
    if (!dlg) return;
    setSaving(true);
    try {
      const paymentId = await ensurePayment(dlg.yearMonth, dlg.row);
      await fetch(`/api/ads/payments/${paymentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mark_paid",
          paidAt: dlgPaidAt,
          paymentMethod: dlgMethod,
          referenceNumber: dlgRef,
          notes: dlgNotes,
        }),
      });
      await mutate();
      setDlg(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  async function uploadPop(ym: string, row: OutletRow, file: File) {
    const busyKey = `${ym}|${row.outletId ?? "unlinked"}`;
    setPopBusy(busyKey);
    try {
      const paymentId = await ensurePayment(ym, row);
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/ads/payments/${paymentId}/pop`, { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      await mutate();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload error");
    } finally {
      setPopBusy(null);
    }
  }

  async function viewPop(paymentId: string, path: string) {
    const res = await fetch(`/api/ads/payments/${paymentId}/pop?path=${encodeURIComponent(path)}`);
    if (!res.ok) { alert("Cannot load POP"); return; }
    const { url } = await res.json();
    window.open(url, "_blank");
  }

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  if (isLoading || !data) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-neutral-400" /></div>;
  }

  return (
    <div className="space-y-4 p-3 sm:p-4 lg:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-2">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold">Ads Claims</h1>
          <p className="text-xs text-neutral-500">Pay-and-claim tracking per outlet per month (8% SST on digital services)</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <select
            value={outletId}
            onChange={(e) => { setOutletId(e.target.value); setCampaignId("all"); }}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm"
          >
            <option value="all">All outlets</option>
            <option value="unlinked">Unlinked</option>
            {outletList?.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <select
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm"
          >
            <option value="all">All campaigns</option>
            {campaignOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
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
            className="flex items-center justify-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* YTD summary — click to filter */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <button
          onClick={() => setStatusFilter("all")}
          className={`min-w-0 rounded-lg border p-2.5 sm:p-4 text-left transition-colors ${statusFilter === "all" ? "border-neutral-900 bg-white" : "border-neutral-200 bg-white hover:border-neutral-400"}`}
        >
          <div className="truncate text-[10px] sm:text-xs text-neutral-500">Total {selectedYear}<span className="hidden sm:inline"> (incl. SST)</span></div>
          <div className="mt-1 truncate text-sm font-semibold tabular-nums sm:text-xl">{fmtMYR(data.summary.totalMYR)}</div>
        </button>
        <button
          onClick={() => setStatusFilter(statusFilter === "reimbursed" ? "all" : "reimbursed")}
          className={`min-w-0 rounded-lg border p-2.5 sm:p-4 text-left transition-colors ${statusFilter === "reimbursed" ? "border-emerald-500 bg-emerald-50" : "border-neutral-200 bg-white hover:border-emerald-300"}`}
        >
          <div className="truncate text-[10px] sm:text-xs text-emerald-600">Reimbursed</div>
          <div className="mt-1 truncate text-sm font-semibold tabular-nums text-emerald-700 sm:text-xl">{fmtMYR(data.summary.paidMYR)}</div>
        </button>
        <button
          onClick={() => setStatusFilter(statusFilter === "outstanding" ? "all" : "outstanding")}
          className={`min-w-0 rounded-lg border p-2.5 sm:p-4 text-left transition-colors ${statusFilter === "outstanding" ? "border-neutral-900 bg-neutral-100" : "border-neutral-200 bg-white hover:border-neutral-400"}`}
        >
          <div className="truncate text-[10px] sm:text-xs text-neutral-500">Outstanding</div>
          <div className="mt-1 truncate text-sm font-semibold tabular-nums sm:text-xl">{fmtMYR(data.summary.outstandingMYR + data.summary.claimedMYR)}</div>
        </button>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-2 text-[11px] text-neutral-500">
          <ShieldCheck className="h-3.5 w-3.5" />
          Each outlet × month is a separate claim. File claim → mark reimbursed → attach POP. Retain CSV for 7 years per LHDN.
        </div>

        {data.statements.length === 0 ? (
          <p className="p-8 text-center text-sm text-neutral-500">No spend data for {selectedYear}.</p>
        ) : (
          <div>
            {data.statements.map((m) => {
              const monthKey = m.yearMonth;
              const isMonthOpen = expanded.has(monthKey);
              const filteredOutlets = m.outlets.filter((o) => {
                if (statusFilter === "all") return true;
                if (statusFilter === "reimbursed") return isReimbursed(o.payment);
                return !isReimbursed(o.payment); // outstanding
              });
              if (filteredOutlets.length === 0) return null;
              const filteredSubtotal = filteredOutlets.reduce((s, o) => s + o.subtotalMYR, 0);
              const filteredTax = filteredOutlets.reduce((s, o) => s + o.taxMYR, 0);
              const filteredTotal = filteredOutlets.reduce((s, o) => s + o.totalMYR, 0);
              return (
                <div key={monthKey} className="border-b border-neutral-100 last:border-0">
                  <button
                    onClick={() => toggle(monthKey)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-3 text-left hover:bg-neutral-50 sm:px-4"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {isMonthOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-neutral-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-neutral-400" />}
                      <span className="truncate text-sm font-medium sm:text-base">{fmtMonth(m.yearMonth)}</span>
                      <span className="hidden text-xs text-neutral-400 sm:inline">({filteredOutlets.length} {filteredOutlets.length === 1 ? "outlet" : "outlets"})</span>
                      <span className="text-xs text-neutral-400 sm:hidden">({filteredOutlets.length})</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-sm tabular-nums sm:gap-6">
                      <span className="hidden text-neutral-500 sm:inline">{fmtMYR(filteredSubtotal)}</span>
                      <span className="hidden text-neutral-500 sm:inline">+{fmtMYR(filteredTax)} SST</span>
                      <span className="min-w-[90px] text-right font-semibold sm:min-w-[100px]">{fmtMYR(filteredTotal)}</span>
                    </div>
                  </button>
                  {isMonthOpen && (
                    <div className="overflow-x-auto bg-neutral-50/40">
                      <table className="w-full min-w-[640px] text-sm">
                        <thead>
                          <tr className="text-xs text-neutral-500">
                            <th className="px-4 py-2 text-left font-normal">Outlet</th>
                            <th className="px-4 py-2 text-left font-normal">Status</th>
                            <th className="px-4 py-2 text-right font-normal">Subtotal</th>
                            <th className="px-4 py-2 text-right font-normal">SST 8%</th>
                            <th className="px-4 py-2 text-right font-normal">Total</th>
                            <th className="px-4 py-2 text-right font-normal">POP</th>
                            <th className="px-4 py-2 text-right font-normal">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredOutlets.map((o) => {
                            const busyKey = `${m.yearMonth}|${o.outletId ?? "unlinked"}`;
                            return (
                              <tr key={busyKey} className="border-t border-neutral-100 bg-white">
                                <td className="px-4 py-2">
                                  <div>{o.outletName}</div>
                                  <div className="text-[11px] text-neutral-400">{o.campaigns.length} campaign{o.campaigns.length === 1 ? "" : "s"}: {o.campaigns.map((c) => c.campaignName).join(", ")}</div>
                                </td>
                                <td className="px-4 py-2"><StatusPill p={o.payment} /></td>
                                <td className="px-4 py-2 text-right tabular-nums">{fmtMYR(o.subtotalMYR)}</td>
                                <td className="px-4 py-2 text-right tabular-nums">{fmtMYR(o.taxMYR)}</td>
                                <td className="px-4 py-2 text-right font-medium tabular-nums">{fmtMYR(o.totalMYR)}</td>
                                <td className="px-4 py-2 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    {o.payment?.popPhotos.map((path, idx) => (
                                      <button
                                        key={path}
                                        onClick={() => viewPop(o.payment!.id, path)}
                                        className="inline-flex items-center gap-0.5 rounded border border-neutral-200 px-1.5 py-0.5 text-[11px] hover:bg-neutral-50"
                                      >
                                        <FileText className="h-3 w-3" />#{idx + 1}
                                      </button>
                                    ))}
                                    <label className="inline-flex cursor-pointer items-center gap-0.5 rounded border border-neutral-200 px-1.5 py-0.5 text-[11px] hover:bg-neutral-50">
                                      {popBusy === busyKey ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                                      <input
                                        type="file"
                                        accept="image/*,application/pdf"
                                        className="hidden"
                                        onChange={(e) => {
                                          const f = e.target.files?.[0];
                                          if (f) uploadPop(m.yearMonth, o, f);
                                          e.target.value = "";
                                        }}
                                      />
                                    </label>
                                  </div>
                                </td>
                                <td className="px-4 py-2 text-right">
                                  <button
                                    onClick={() => openDialog(m.yearMonth, o)}
                                    className="rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-xs hover:bg-neutral-50"
                                  >
                                    {isReimbursed(o.payment) ? "Edit" : "Mark Reimbursed"}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
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

      {/* Claim dialog */}
      <Dialog open={!!dlg} onOpenChange={(v) => !v && setDlg(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dlg && isReimbursed(dlg.row.payment) ? "Edit Reimbursement" : "Mark as Reimbursed"}
              {dlg && <span className="block text-xs font-normal text-neutral-500">{dlg.row.outletName} · {fmtMonth(dlg.yearMonth)} · {fmtMYR(dlg.row.totalMYR)}</span>}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Reimbursed on</label>
              <input
                type="date"
                value={dlgPaidAt}
                onChange={(e) => setDlgPaidAt(e.target.value)}
                className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Paid via</label>
              <select
                value={dlgMethod}
                onChange={(e) => setDlgMethod(e.target.value)}
                className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
              >
                <option value="PERSONAL_CARD">Personal card (I paid Google)</option>
                <option value="COMPANY_CARD">Company card (direct expense)</option>
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="GOOGLE_CREDIT">Google credit</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Reference</label>
              <input
                type="text"
                value={dlgRef}
                onChange={(e) => setDlgRef(e.target.value)}
                placeholder="Google receipt ID / bank ref"
                className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Notes</label>
              <textarea
                value={dlgNotes}
                onChange={(e) => setDlgNotes(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={saveClaim}
              disabled={saving}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-terracotta py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Save
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
