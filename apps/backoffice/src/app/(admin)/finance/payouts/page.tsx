"use client";

// Payouts — Revenue Monster daily settlement batches paid to our bank accounts,
// auto-synced from the RM Open API. Each payout drills into the transactions it
// settled, every one linked back to its Celsius order. Closes the loop:
// order → RM collected → payout (→ bank, phase 2). Mirrors the Ledger page:
// server-windowed date range, client-side filter/sort, row-click detail drawer.

import { useState, useMemo, useEffect } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Sheet, SheetContent, SheetHeader, SheetTitle, Badge, Button } from "@celsius/ui";
import { Loader2, Search, X, ArrowUp, ArrowDown, ChevronsUpDown, Building2, Download, CheckCircle2, AlertTriangle } from "lucide-react";

type Payout = {
  id: string;
  settlementDate: string;
  method: string;
  sequence: number;
  storeId: string;
  entityName: string | null;
  txnCount: number;
  gross: number;
  mdrFee: number;
  net: number;
  status: string;
  linkedCount: number;
};

type PayoutLine = {
  id: string;
  rmTransactionId: string;
  rmOrderId: string | null;
  orderId: string | null;
  orderNumber: string | null;
  gross: number;
  mdrFee: number;
  net: number;
  method: string | null;
  txnTime: string | null;
};

const RM = (n: number) =>
  new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(n);

// RM method code → friendly label (FPX_MY → FPX, CARD → Card).
function method(m: string | null): string {
  if (!m) return "—";
  return m.replace(/_MY$/, "").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/pay/i, "Pay");
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
function monthRange(year: number, month0: number): { from: string; to: string } {
  return { from: ymd(new Date(Date.UTC(year, month0, 1))), to: ymd(new Date(Date.UTC(year, month0 + 1, 0))) };
}
function presetRange(key: string): { from: string; to: string } {
  const now = new Date(); const y = now.getFullYear(); const m = now.getMonth();
  const end = monthRange(y, m).to;
  switch (key) {
    case "thisMonth": return monthRange(y, m);
    case "lastMonth": return monthRange(y, m - 1);
    case "last3": return { from: monthRange(y, m - 2).from, to: end };
    case "last6": return { from: monthRange(y, m - 5).from, to: end };
    case "ytd": return { from: `${y}-01-01`, to: ymd(now) };
    default: return { from: monthRange(y, m - 2).from, to: end };
  }
}

type SortKey = "settlementDate" | "entityName" | "method" | "txnCount" | "gross" | "net";
const SELECT_CLASS = "h-8 rounded-md border bg-background px-2 text-xs sm:text-sm shrink-0 max-w-[40vw]";

function SortTh({ label, sortField, sortKey, sortDir, onSort, className = "", align = "left" }: {
  label: string; sortField: SortKey; sortKey: SortKey; sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void; className?: string; align?: "left" | "right";
}) {
  const active = sortKey === sortField;
  return (
    <th className={`px-3 py-2 ${className}`}>
      <button type="button" onClick={() => onSort(sortField)}
        className={`inline-flex items-center gap-1 font-medium uppercase tracking-wide hover:text-foreground ${align === "right" ? "flex-row-reverse" : ""}`}>
        {label}
        {active ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </th>
  );
}

export default function FinancePayoutsPage() {
  const [periodSel, setPeriodSel] = useState("last3");
  const [dateFrom, setDateFrom] = useState(() => presetRange("last3").from);
  const [dateTo, setDateTo] = useState(() => presetRange("last3").to);
  const [search, setSearch] = useState("");
  const [entityF, setEntityF] = useState("");
  const [methodF, setMethodF] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("settlementDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [openId, setOpenId] = useState<string | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (dateFrom) p.set("from", dateFrom);
    if (dateTo) p.set("to", dateTo);
    return p.toString();
  }, [dateFrom, dateTo]);

  const { data, error, isLoading } = useFetch<{ from: string; to: string | null; payouts: Payout[] }>(
    `/api/finance/payouts${qs ? `?${qs}` : ""}`
  );
  const payouts = useMemo(() => data?.payouts ?? [], [data]);

  const entityOptions = useMemo(() => Array.from(new Set(payouts.map((p) => p.entityName ?? "—"))).sort(), [payouts]);
  const methodOptions = useMemo(() => Array.from(new Set(payouts.map((p) => p.method))).sort(), [payouts]);

  function onSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "settlementDate" || k === "gross" || k === "net" || k === "txnCount" ? "desc" : "asc"); }
  }
  function applyPeriod(v: string) {
    setPeriodSel(v);
    if (v === "custom") return;
    const r = presetRange(v);
    setDateFrom(r.from); setDateTo(r.to);
  }

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    let rows = payouts.filter((p) => {
      if (s && !`${p.entityName ?? ""} ${method(p.method)} ${p.id}`.toLowerCase().includes(s)) return false;
      if (entityF && (p.entityName ?? "—") !== entityF) return false;
      if (methodF && p.method !== methodF) return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      let av: string | number, bv: string | number;
      switch (sortKey) {
        case "gross": av = a.gross; bv = b.gross; break;
        case "net": av = a.net; bv = b.net; break;
        case "txnCount": av = a.txnCount; bv = b.txnCount; break;
        case "method": av = method(a.method); bv = method(b.method); break;
        case "entityName": av = a.entityName ?? ""; bv = b.entityName ?? ""; break;
        default: av = a.settlementDate; bv = b.settlementDate;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return rows;
  }, [payouts, search, entityF, methodF, sortKey, sortDir]);

  const totals = useMemo(() => {
    let gross = 0, fee = 0, net = 0;
    for (const p of filtered) { gross += p.gross; fee += p.mdrFee; net += p.net; }
    return { gross, fee, net };
  }, [filtered]);

  const anyFilter = !!(search || entityF || methodF);
  function clearFilters() { setSearch(""); setEntityF(""); setMethodF(""); }

  function exportCsv() {
    const headers = ["Settlement date", "Entity", "Method", "Seq", "Transactions", "Linked", "Gross (RM)", "MDR fee (RM)", "Net (RM)", "Status"];
    const esc = (v: string | number) => { const s = String(v ?? ""); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = filtered.map((p) => [
      p.settlementDate, p.entityName ?? "", method(p.method), p.sequence,
      p.txnCount, p.linkedCount, p.gross.toFixed(2), p.mdrFee.toFixed(2), p.net.toFixed(2), p.status,
    ]);
    const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `celsius-payouts_${dateFrom || data?.from || "start"}_to_${dateTo || "latest"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 p-3 sm:p-6">
      <header className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-semibold">Payouts</h1>
        <p className="mt-0.5 text-xs sm:text-sm text-muted-foreground">
          Revenue Monster settlements paid to your bank accounts — open one to see every transaction it settled, linked to its order.
          {data && <span className="ml-1">Showing from {data.from}{data.to ? ` to ${data.to}` : ""}.</span>}
        </p>
      </header>

      <div className="space-y-2 rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search entity, method…"
              className="h-8 w-full rounded-md border bg-background pl-7 pr-2 text-sm" />
          </div>
          <select value={entityF} onChange={(e) => setEntityF(e.target.value)} className={SELECT_CLASS} title="Entity">
            <option value="">All entities</option>
            {entityOptions.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
          <select value={methodF} onChange={(e) => setMethodF(e.target.value)} className={SELECT_CLASS} title="Method">
            <option value="">All methods</option>
            {methodOptions.map((m) => <option key={m} value={m}>{method(m)}</option>)}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <label className="flex items-center gap-1">Period
            <select value={periodSel} onChange={(e) => applyPeriod(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs sm:text-sm" title="Period">
              <option value="thisMonth">This month</option>
              <option value="lastMonth">Last month</option>
              <option value="last3">Last 3 months</option>
              <option value="last6">Last 6 months</option>
              <option value="ytd">Year to date</option>
              <option value="custom">Custom range…</option>
            </select>
          </label>
          <label className="flex items-center gap-1">From
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPeriodSel("custom"); }} className="h-8 rounded-md border bg-background px-2 text-xs" />
          </label>
          <label className="flex items-center gap-1">To
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPeriodSel("custom"); }} className="h-8 rounded-md border bg-background px-2 text-xs" />
          </label>
          <Button variant="outline" size="sm" className="h-8" onClick={exportCsv} disabled={filtered.length === 0} title="Export the filtered payouts to CSV">
            <Download className="mr-1 h-3 w-3" /> Export
          </Button>
          {anyFilter && <Button variant="outline" size="sm" className="h-8" onClick={clearFilters}><X className="mr-1 h-3 w-3" /> Clear</Button>}
          <span className="ml-auto flex flex-wrap items-center gap-x-3 tabular-nums">
            <span>{filtered.length} {filtered.length === 1 ? "payout" : "payouts"}</span>
            <span>Gross {RM(totals.gross)}</span>
            <span className="text-red-700">Fees {RM(totals.fee)}</span>
            <span className="font-semibold text-green-700">Net {RM(totals.net)}</span>
          </span>
        </div>
      </div>

      {isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">Failed to load: {String(error)}</div>}

      {data && payouts.length === 0 && (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          No payouts in this range yet. They sync daily from Revenue Monster after settlement — widen the date range, or check back after the next run.
        </div>
      )}

      {data && payouts.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <SortTh label="Date" sortField="settlementDate" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="whitespace-nowrap" />
                <SortTh label="Entity" sortField="entityName" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Method" sortField="method" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="whitespace-nowrap hidden sm:table-cell" />
                <SortTh label="Txns" sortField="txnCount" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="whitespace-nowrap text-right hidden md:table-cell" align="right" />
                <SortTh label="Gross" sortField="gross" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="whitespace-nowrap text-right hidden lg:table-cell" align="right" />
                <SortTh label="Net" sortField="net" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="whitespace-nowrap text-right" align="right" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const allLinked = p.linkedCount >= p.txnCount && p.txnCount > 0;
                return (
                  <tr key={p.id} className="cursor-pointer border-t transition hover:bg-muted/30" onClick={() => setOpenId(p.id)}>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums align-top">{p.settlementDate}</td>
                    <td className="max-w-[260px] px-3 py-2">
                      <div className="truncate">{p.entityName ?? "—"}</div>
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <span className="sm:hidden">{method(p.method)} ·</span>
                        <span className={`inline-flex items-center gap-0.5 ${allLinked ? "text-green-700" : "text-amber-700"}`}>
                          {allLinked ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                          {p.linkedCount}/{p.txnCount} linked
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 hidden sm:table-cell align-top">
                      <Badge variant="outline" className="font-normal">{method(p.method)}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums align-top hidden md:table-cell">{p.txnCount}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums align-top hidden lg:table-cell text-muted-foreground">{RM(p.gross)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums align-top font-medium text-green-700">{RM(p.net)}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">No payouts match your filters.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <PayoutDrawer id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function PayoutDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [state, setState] = useState<{ loading: boolean; error: string | null; payout: Payout | null; lines: PayoutLine[] }>(
    { loading: false, error: null, payout: null, lines: [] }
  );

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setState({ loading: true, error: null, payout: null, lines: [] });
    fetch(`/api/finance/payouts/${id}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d) => { if (!cancelled) setState({ loading: false, error: null, payout: d.payout, lines: d.lines }); })
      .catch((e) => { if (!cancelled) setState({ loading: false, error: String(e), payout: null, lines: [] }); });
    return () => { cancelled = true; };
  }, [id]);

  const { payout, lines } = state;
  const linked = lines.filter((l) => l.orderId).length;
  const lineNetSum = lines.reduce((s, l) => s + l.net, 0);
  const reconciles = payout ? Math.abs(lineNetSum - payout.net) < 0.01 : false;

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-hidden flex flex-col gap-0 p-0">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>Payout</SheetTitle>
        </SheetHeader>
        {state.loading && <div className="p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
        {state.error && <div className="p-6 text-sm text-destructive">Failed to load: {state.error}</div>}
        {payout && (
          <div className="space-y-5 overflow-y-auto p-6 text-sm">
            <section className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Settlement date</div>
                <div className="tabular-nums">{payout.settlementDate}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Method</div>
                <Badge variant="outline" className="font-normal">{method(payout.method)}</Badge>
              </div>
              <div className="col-span-2">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Entity</div>
                <div className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5 shrink-0" />{payout.entityName ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Gross</div>
                <div className="tabular-nums">{RM(payout.gross)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">MDR fee</div>
                <div className="tabular-nums text-red-700">−{RM(payout.mdrFee)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Net to bank</div>
                <div className="font-semibold tabular-nums text-green-700">{RM(payout.net)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Reconciles</div>
                <div className={reconciles ? "text-green-700 inline-flex items-center gap-1" : "text-amber-700 inline-flex items-center gap-1"}>
                  {reconciles ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                  {reconciles ? "Lines = net" : `Δ ${RM(Math.abs(lineNetSum - payout.net))}`}
                </div>
              </div>
            </section>

            <section className="rounded-md border bg-muted/20 p-3 text-xs">
              <span className={linked >= lines.length ? "text-green-700" : "text-amber-700"}>
                {linked}/{lines.length} transactions linked to a Celsius order
              </span>
              {linked < lines.length && <span className="text-muted-foreground"> · unlinked are typically POS-terminal sales</span>}
            </section>

            <section>
              <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Transactions</div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-left uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5">Order</th>
                      <th className="px-2 py-1.5 text-right">Gross</th>
                      <th className="px-2 py-1.5 text-right">Fee</th>
                      <th className="px-2 py-1.5 text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id} className="border-t">
                        <td className="px-2 py-1.5">
                          {l.orderNumber
                            ? <span className="font-medium">{l.orderNumber}</span>
                            : <span className="text-muted-foreground">{l.rmOrderId ?? "unlinked"}</span>}
                          <div className="font-mono text-[10px] text-muted-foreground truncate max-w-[180px]">{l.rmTransactionId}</div>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{RM(l.gross)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-red-700">−{RM(l.mdrFee)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-green-700">{RM(l.net)}</td>
                      </tr>
                    ))}
                    {lines.length === 0 && <tr><td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">No transaction lines.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
